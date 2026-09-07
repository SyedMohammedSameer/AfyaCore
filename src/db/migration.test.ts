/**
 * Schema upgrades, from a database that already has a facility's data in it.
 *
 * Every other test in this suite starts from an empty database at the current
 * version, which is the one case that can never go wrong. The case that
 * matters is the phone that has been in a health post for a year: it opens the
 * app after an update and Dexie runs v1→v3 against real consultations. If that
 * path drops a row, nothing tells anyone — the app opens, the roster is just
 * shorter, and the records are gone.
 *
 * A PWA makes this sharper than an app store would. There is no review queue
 * and no staged rollout: a push reaches every device at the facility on the
 * next load, all at once.
 *
 * So these open an *old* database, put data in it, and then open the current
 * schema over the top, which is exactly what an upgrading device does.
 */
import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from './db'
import { deidentify } from '../lib/deidentify'
import { setCurrentActor } from '../lib/audit'
import { encryptExistingRows } from './encryption'
import { livePatientCount } from './repo'
import { lockVault, openTestVault } from '../test/vault'

/**
 * A stored row exactly as it sits on disk, bypassing Dexie's middleware.
 *
 * The whole claim of encryption at rest is about what is in the file, and a
 * read through Dexie cannot see it: the middleware decrypts on the way out, so
 * every assertion would pass whether anything was encrypted or not.
 */
async function rawRow(store: string, key: string): Promise<Record<string, unknown>> {
  const raw = new Dexie('afyacore')
  raw.version(db.verno).stores({})
  await raw.open()
  try {
    return await new Promise((resolve, reject) => {
      const tx = raw.backendDB().transaction(store, 'readonly')
      const request = tx.objectStore(store).get(key)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
  } finally {
    raw.close()
  }
}

const V1_STORES = {
  patients: 'id, familyName, givenName, registerNo, updatedAt, syncedAt, searchKey',
  encounters: 'id, patientId, occurredAt, status, updatedAt, syncedAt',
  attachments: 'id, encounterId, createdAt',
  settings: 'key',
}

const V2_STORES = {
  patients: 'id, familyName, givenName, registerNo, updatedAt, syncedAt, searchKey, deletedAt',
  encounters: 'id, patientId, occurredAt, status, updatedAt, syncedAt, deletedAt',
  attachments: 'id, encounterId, createdAt',
  settings: 'key',
}

/** A patient row exactly as v1 wrote it: no deletedAt, no consent. */
const legacyPatient = (id: string, familyName: string) => ({
  id,
  givenName: 'Voahirana',
  familyName,
  sex: 'female',
  approximateAge: 34,
  address: 'Ambohimanga',
  registerNo: '2041',
  preferredLang: 'mg',
  searchKey: `${familyName.toLowerCase()} voahirana`,
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_000,
})

const legacyEncounter = (id: string, patientId: string) => ({
  id,
  patientId,
  occurredAt: 1_700_000_000_000,
  chiefComplaint: 'fièvre depuis trois jours',
  diagnosis: 'paludisme simple',
  vitals: { temperature: 38.9 },
  prescriptions: [{ id: 'rx-legacy', drug: 'artéméther luméfantrine' }],
  provenance: {},
  attachmentIds: [],
  status: 'final',
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_000,
})

/** Write a database at an older version, then close it so Dexie can upgrade. */
async function seedLegacy(version: number, stores: Record<string, string>) {
  const old = new Dexie('afyacore')
  old.version(version).stores(stores)
  await old.open()
  await old.table('patients').bulkAdd([
    legacyPatient('p1', 'RAKOTOARISOA'),
    legacyPatient('p2', 'ANDRIANJAFY'),
  ])
  await old.table('encounters').add(legacyEncounter('e1', 'p1'))
  await old.table('settings').put({ key: 'facility.country', value: 'MG' })
  old.close()
}

beforeEach(async () => {
  if (db.isOpen()) db.close()
  await Dexie.delete('afyacore')
  setCurrentActor('test-admin', 'admin')
})

afterEach(() => {
  if (db.isOpen()) db.close()
})

describe('upgrading a device that has real data on it', () => {
  it('keeps every record across v1 to v3', async () => {
    await seedLegacy(1, V1_STORES)
    await db.open()

    expect(db.verno).toBe(4)
    expect(await db.patients.count()).toBe(2)
    expect(await db.encounters.count()).toBe(1)
    expect((await db.settings.get('facility.country'))!.value).toBe('MG')
  })

  it('keeps every record across v2 to v3', async () => {
    await seedLegacy(2, V2_STORES)
    await db.open()

    expect(await db.patients.count()).toBe(2)
    expect((await db.encounters.get('e1'))!.diagnosis).toBe('paludisme simple')
  })

  it('leaves the clinical payload byte-identical', async () => {
    // A migration that keeps the row count and loses a field is the worse
    // failure, because the roster still looks right.
    await seedLegacy(1, V1_STORES)
    await db.open()

    const e = (await db.encounters.get('e1'))!
    expect(e.chiefComplaint).toBe('fièvre depuis trois jours')
    expect(e.vitals.temperature).toBe(38.9)
    expect(e.prescriptions[0]!.drug).toBe('artéméther luméfantrine')
    expect(e.occurredAt).toBe(1_700_000_000_000)
  })

  it('creates the stores v3 added, empty rather than missing', async () => {
    // clinicians and audit do not exist at v1. A device that upgrades and then
    // cannot write an audit entry has lost its accountability trail silently.
    await seedLegacy(1, V1_STORES)
    await db.open()

    expect(await db.clinicians.count()).toBe(0)
    expect(await db.audit.count()).toBe(0)
    // The audit table is encrypted, so writing to it needs an open vault —
    // which is the state a device is in whenever anything is auditable.
    await openTestVault()
    await db.audit.add({
      id: 'a1',
      seq: 1,
      action: 'signin',
      at: Date.now(),
      prevHash: 'GENESIS',
      hash: 'x',
    })
    expect(await db.audit.count()).toBe(1)
  })

  it('counts live records when legacy rows have no deletedAt at all', async () => {
    // v1 rows have no `deletedAt` key, and Dexie indexes only rows where a key
    // is present, so every legacy record is absent from that index. The live
    // count is computed as a subtraction against it — precisely so that
    // absence means "not deleted", which is what it means.
    await seedLegacy(1, V1_STORES)
    await db.open()
    await openTestVault()

    expect(await livePatientCount()).toBe(2)

    await db.patients.update('p1', { deletedAt: Date.now() })
    expect(await livePatientCount()).toBe(1)
  })
})

/**
 * The upgrade that turns a facility's plaintext database into an encrypted one.
 *
 * This is the migration with the most to lose. It runs against a phone that
 * has a year of consultations on it, it rewrites every clinical row, and a
 * device whose battery dies halfway through must open again afterwards rather
 * than presenting a half-readable database.
 */
describe('switching an existing device to encrypted storage', () => {
  it('reads plaintext rows before the switch, and ciphertext after', async () => {
    await seedLegacy(1, V1_STORES)
    await db.open()

    // Legacy rows are readable with no key at all: reads are lenient, which is
    // what lets the conversion be incremental rather than one transaction over
    // the whole database.
    expect((await db.patients.get('p1'))!.familyName).toBe('RAKOTOARISOA')

    await openTestVault()
    await encryptExistingRows(db)

    // Through Dexie the record is unchanged...
    const patient = (await db.patients.get('p1'))!
    expect(patient.familyName).toBe('RAKOTOARISOA')
    expect(patient.searchKey).toContain('rakotoarisoa')

    // ...and underneath it, the name is gone from the stored row.
    const raw = await rawRow('patients', 'p1')
    expect(Object.keys(raw)).toContain('__enc')
    expect(JSON.stringify(raw)).not.toContain('RAKOTOARISOA')
    expect(JSON.stringify(raw)).not.toContain('rakotoarisoa')
    // The index fields that survive are the ones PLANS declares, and no others.
    expect(Object.keys(raw).filter((k) => k !== '__enc').sort()).toEqual(['id', 'updatedAt'])
  })

  it('locks the records away when the vault closes', async () => {
    await seedLegacy(1, V1_STORES)
    await db.open()
    await openTestVault()
    await encryptExistingRows(db)

    lockVault()
    await expect(db.patients.get('p1')).rejects.toThrow(/vault is locked/)
    await expect(db.patients.toArray()).rejects.toThrow(/vault is locked/)

    await openTestVault()
    expect((await db.patients.get('p1'))!.familyName).toBe('RAKOTOARISOA')
  })

  it('resumes after an interrupted pass rather than corrupting the row', async () => {
    // The phone that dies mid-conversion. Running it again has to be safe, and
    // a row that was already converted must not be double-encrypted.
    await seedLegacy(1, V1_STORES)
    await db.open()
    await openTestVault()

    await encryptExistingRows(db)
    await encryptExistingRows(db)

    expect((await db.patients.get('p1'))!.familyName).toBe('RAKOTOARISOA')
    expect((await db.encounters.get('e1'))!.diagnosis).toBe('paludisme simple')
  })

  it('leaves the settings table readable, because the key wraps live in it', async () => {
    // A chicken-and-egg check: if settings were encrypted there would be
    // nowhere to keep the wrapped key that decrypts everything else.
    await seedLegacy(1, V1_STORES)
    await db.open()
    await openTestVault()
    await encryptExistingRows(db)

    expect((await db.settings.get('facility.country'))!.value).toBe('MG')
    expect(await rawRow('settings', 'facility.country')).not.toHaveProperty('__enc')
  })
})

describe('fields added after the records were written', () => {
  it('treats a legacy patient as not having consented', async () => {
    // The safety-critical default, checked against the rows it actually
    // protects: every patient recorded before the consent field existed. If a
    // migration ever backfilled this to `granted`, an upgrade would silently
    // enrol a year of patients into research they were never asked about.
    await seedLegacy(1, V1_STORES)
    await db.open()

    const patients = await db.patients.toArray()
    expect(patients.every((p) => p.researchConsent === undefined)).toBe(true)

    const exported = await deidentify(patients, await db.encounters.toArray(), {
      level: 'pseudonymous',
    })
    expect(exported.patients).toHaveLength(0)
    expect(exported.manifest.excludedForConsent).toBe(2)
  })

  it('keeps a legacy preferredLang valid under the widened type', async () => {
    // PatientLang widened from three codes to ten. Old rows hold 'mg', which
    // must still resolve rather than falling back and printing French at a
    // patient who does not read it.
    await seedLegacy(1, V1_STORES)
    await db.open()
    expect((await db.patients.get('p1'))!.preferredLang).toBe('mg')
  })
})

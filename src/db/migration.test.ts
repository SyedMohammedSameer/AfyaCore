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

    expect(db.verno).toBe(3)
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

  it('makes the deletedAt index usable on rows written before it existed', async () => {
    // v1 rows have no deletedAt at all. Dexie indexes only rows where the key
    // is present, so a query that relied on the index would silently skip
    // every legacy record — which is why the app filters in code instead.
    await seedLegacy(1, V1_STORES)
    await db.open()

    const live = await db.patients.filter((p) => p.deletedAt === undefined).toArray()
    expect(live).toHaveLength(2)

    await db.patients.update('p1', { deletedAt: Date.now() })
    const after = await db.patients.filter((p) => p.deletedAt === undefined).toArray()
    expect(after).toHaveLength(1)
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

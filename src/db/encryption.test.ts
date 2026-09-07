/**
 * Encryption at rest.
 *
 * The claim being tested is about **what is on the disk**, so the assertions
 * that matter read the object store directly rather than through Dexie. A read
 * through Dexie is decrypted on the way out, so every one of these would pass
 * just as happily against a database that stored plaintext — which is exactly
 * the test that would let this ship broken.
 */
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from './db'
import { PLANS, VaultLockedError, encryptExistingRows } from './encryption'
import { createPatient, patchEncounter, createDraftEncounter, searchPatients } from './repo'
import { setCurrentActor } from '../lib/audit'
import { lockVault, openTestVault } from '../test/vault'
import { createVault, isVaultEnabled, rewrapFor, revokeWrap, unlockVault } from '../lib/vault'

setCurrentActor('test-admin', 'admin')

/** The stored row, straight out of IndexedDB, with no middleware in the way. */
async function rawRow(store: string, key: string): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const tx = db.backendDB().transaction(store, 'readonly')
    const request = tx.objectStore(store).get(key)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

const PATIENT = {
  familyName: 'RAKOTOARISOA',
  givenName: 'Voahirana',
  sex: 'female' as const,
  approximateAge: 34,
  address: 'Ambohimanga',
  registerNo: '2041',
  phone: '034 12 345 67',
  preferredLang: 'mg' as const,
}

beforeEach(async () => {
  if (!db.isOpen()) await db.open()
  await openTestVault()
  await Promise.all([db.patients.clear(), db.encounters.clear(), db.attachments.clear()])
})

describe('what reaches the disk', () => {
  it('does not write a patient’s name, number, phone or village in the clear', async () => {
    const id = await createPatient(PATIENT)
    const raw = JSON.stringify(await rawRow('patients', id))

    for (const secret of [
      'RAKOTOARISOA',
      'Voahirana',
      'rakotoarisoa',
      '2041',
      '034 12 345 67',
      'Ambohimanga',
    ]) {
      expect(raw, `"${secret}" is readable on disk`).not.toContain(secret)
    }
  })

  it('does not write the clinical record in the clear either', async () => {
    const patientId = await createPatient(PATIENT)
    const encounterId = await createDraftEncounter(patientId)
    await patchEncounter(encounterId, {
      chiefComplaint: 'fièvre depuis trois jours',
      diagnosis: 'paludisme simple',
      vitals: { temperature: 38.9 },
    })

    const raw = JSON.stringify(await rawRow('encounters', encounterId))
    expect(raw).not.toContain('paludisme')
    expect(raw).not.toContain('fièvre')
    expect(raw).not.toContain('38.9')
  })

  it('keeps in the clear only the fields its plan declares', async () => {
    const id = await createPatient(PATIENT)
    const raw = await rawRow('patients', id)
    const clear = Object.keys(raw).filter((k) => k !== '__enc')

    // Every plaintext key is one the plan names. The reverse is not asserted:
    // a field the row does not have (`syncedAt` on a record that has never
    // synced) is legitimately absent.
    for (const field of clear) expect(PLANS.patients!.keep).toContain(field)
  })

  it('returns the record intact through Dexie, which is the whole point', async () => {
    const id = await createPatient(PATIENT)
    const back = (await db.patients.get(id))!
    expect(back.familyName).toBe('RAKOTOARISOA')
    expect(back.phone).toBe('034 12 345 67')
    expect(back.searchKey).toContain('rakotoarisoa')
  })
})

describe('the lock', () => {
  it('refuses to read an encrypted row without the key', async () => {
    const id = await createPatient(PATIENT)
    lockVault()

    await expect(db.patients.get(id)).rejects.toThrow(VaultLockedError)
    await expect(db.patients.toArray()).rejects.toThrow(VaultLockedError)
  })

  it('refuses to write one, rather than writing it in the clear', async () => {
    // The failure that would matter: falling back to plaintext when the key is
    // missing would put a name on the disk with nothing reporting it.
    lockVault()
    await expect(createPatient(PATIENT)).rejects.toThrow(VaultLockedError)
  })

  it('still counts and pages by index while locked, because those are metadata', async () => {
    await createPatient(PATIENT)
    lockVault()

    // No values are read, so nothing has to be decrypted. This is what lets
    // the sync badge and the live counts work the way they do.
    expect(await db.patients.count()).toBe(1)
    expect(await db.patients.orderBy('updatedAt').primaryKeys()).toHaveLength(1)
  })
})

describe('the key hierarchy', () => {
  it('opens with the right PIN and not with another', async () => {
    const id = await createPatient(PATIENT)
    lockVault()

    expect(await unlockVault('test-admin', '9999')).toBe('wrong_pin')
    await expect(db.patients.get(id)).rejects.toThrow(VaultLockedError)

    expect(await unlockVault('test-admin', '4729')).toBe('ok')
    expect((await db.patients.get(id))!.familyName).toBe('RAKOTOARISOA')
  })

  it('tells an account with no key apart from a wrong PIN', async () => {
    // These need different answers in the UI: one is "try again", the other is
    // "an administrator has to set your PIN", and no number of retries fixes
    // the second.
    expect(await unlockVault('someone-else', '4729')).toBe('no_wrap')
  })

  it('gives a second account its own copy under its own PIN', async () => {
    const id = await createPatient(PATIENT)
    await rewrapFor('midwife', '8261', 1)
    lockVault()

    expect(await unlockVault('midwife', '8261')).toBe('ok')
    expect((await db.patients.get(id))!.familyName).toBe('RAKOTOARISOA')
  })

  it('cannot hand out a copy while the vault is locked', async () => {
    // The security property behind "an administrator must set your PIN": a key
    // can only be passed on by somebody who currently holds it.
    lockVault()
    await expect(rewrapFor('midwife', '8261', 1)).rejects.toThrow(/locked/)
  })

  it('stops a revoked account opening the database', async () => {
    await rewrapFor('midwife', '8261', 1)
    await revokeWrap('midwife')
    lockVault()

    expect(await unlockVault('midwife', '8261')).toBe('no_wrap')
  })

  it('refuses to create a second vault over the first', async () => {
    // Would orphan every record already written under the old key.
    expect(await isVaultEnabled()).toBe(true)
    await expect(createVault('test-admin', '4729', 1)).rejects.toThrow(/already exists/)
  })
})

describe('ciphertext integrity', () => {
  it('will not decrypt a record moved onto another patient’s row', async () => {
    // The primary key is authenticated, so a stolen envelope pasted over
    // another row fails to open rather than impersonating that patient.
    const a = await createPatient(PATIENT)
    const b = await createPatient({ ...PATIENT, familyName: 'ANDRIANJAFY', registerNo: '2042' })

    const rowA = await rawRow('patients', a)
    await new Promise<void>((resolve, reject) => {
      const tx = db.backendDB().transaction('patients', 'readwrite')
      const request = tx.objectStore('patients').put({ ...rowA, id: b })
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })

    await expect(db.patients.get(b)).rejects.toThrow()
  })

  it('will not decrypt a tampered envelope', async () => {
    const id = await createPatient(PATIENT)
    const raw = await rawRow('patients', id)
    const envelope = raw.__enc as { ct: ArrayBuffer }
    new Uint8Array(envelope.ct)[0] ^= 0xff

    await new Promise<void>((resolve, reject) => {
      const tx = db.backendDB().transaction('patients', 'readwrite')
      const request = tx.objectStore('patients').put(raw)
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })

    // AES-GCM authenticates: a flipped bit is a failure, not a garbled record
    // that a clinician might act on.
    await expect(db.patients.get(id)).rejects.toThrow()
  })
})

describe('queries that still have to work', () => {
  it('searches by name, which now means decrypting the register', async () => {
    await createPatient(PATIENT)
    await createPatient({ ...PATIENT, familyName: 'ANDRIANJAFY', givenName: 'Naivo', registerNo: '2042' })

    expect(await searchPatients('naivo')).toHaveLength(1)
    expect((await searchPatients('rakoto'))[0]!.givenName).toBe('Voahirana')
    // Accent folding survives the round trip: the searchKey is normalised
    // before encryption and comes back out of the ciphertext already folded,
    // so a misaccented spelling off a paper card still finds the record.
    expect(await searchPatients('RAKOTOÀRISOA')).toHaveLength(1)
    expect(await searchPatients('2041')).toHaveLength(1)
  })

  it('lists the roster without decrypting patients it will not show', async () => {
    for (let i = 0; i < 5; i++) await createPatient({ ...PATIENT, registerNo: `20${i}` })
    const page = await searchPatients('', 2)
    expect(page).toHaveLength(2)
    // Newest first, and both readable.
    expect(page[0]!.updatedAt).toBeGreaterThanOrEqual(page[1]!.updatedAt)
    expect(page[0]!.familyName).toBe('RAKOTOARISOA')
  })

  it('survives concurrent reads inside one transaction', async () => {
    /*
     * This is a regression test for a hang, not for a wrong answer.
     *
     * Decryption keeps the IndexedDB transaction alive with `Dexie.waitFor`,
     * and two of those outstanding at once in the same transaction deadlock.
     * `Promise.all` over two gets is ordinary code — `mergePatients` does
     * exactly this — and the failure mode was a promise that never settled:
     * no error, no rejection, a consultation that simply never saved.
     */
    const a = await createPatient(PATIENT)
    const b = await createPatient({ ...PATIENT, familyName: 'ANDRIANJAFY' })

    const both = await db.transaction('rw', db.patients, async () =>
      Promise.all([db.patients.get(a), db.patients.get(b)]),
    )
    expect(both.map((p) => p!.familyName)).toEqual(['RAKOTOARISOA', 'ANDRIANJAFY'])
  })

  it('refuses a cursor rather than filtering ciphertext', async () => {
    // `.filter()` hands the predicate whatever is stored. Before this guard it
    // would have been handed an envelope, matched nothing, and reported an
    // empty roster as though the facility had no patients.
    await createPatient(PATIENT)
    await expect(
      db.patients.filter((p) => p.familyName === 'RAKOTOARISOA').toArray(),
    ).rejects.toThrow(/cursor/)
  })
})

describe('attachments', () => {
  it('encrypts the image bytes, not just the row around them', async () => {
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 6, 7, 8])
    const id = 'att-1'
    await db.attachments.add({
      id,
      encounterId: 'e1',
      blob: new Blob([bytes], { type: 'image/jpeg' }),
      width: 4,
      height: 3,
      byteSize: bytes.length,
      createdAt: Date.now(),
    })

    const raw = await rawRow('attachments', id)
    expect(raw).not.toHaveProperty('blob')

    const back = (await db.attachments.get(id))!
    expect(back.blob.type).toBe('image/jpeg')
    expect(new Uint8Array(await back.blob.arrayBuffer())).toEqual(bytes)
    expect(back.width).toBe(4)
  })
})

describe('converting a database that is already full', () => {
  it('reports how many rows it rewrote, and is safe to run twice', async () => {
    await createPatient(PATIENT)
    await createPatient({ ...PATIENT, familyName: 'ANDRIANJAFY' })
    const converted = await encryptExistingRows(db as unknown as Parameters<typeof encryptExistingRows>[0])
    expect(converted).toBeGreaterThanOrEqual(2)
    expect((await db.patients.toArray()).map((p) => p.familyName).sort()).toEqual([
      'ANDRIANJAFY',
      'RAKOTOARISOA',
    ])
  })

  it('will not run without the key', async () => {
    lockVault()
    await expect(
      encryptExistingRows(db as unknown as Parameters<typeof encryptExistingRows>[0]),
    ).rejects.toThrow(/locked/)
  })
})

describe('what is deliberately left readable', () => {
  it('keeps settings in the clear, because the wrapped key lives there', async () => {
    await db.settings.put({ key: 'facility.country', value: 'MG' })
    expect(await rawRow('settings', 'facility.country')).not.toHaveProperty('__enc')
  })

  it('keeps staff names in the clear, because the lock screen lists them', async () => {
    // An honest leak, not an oversight: the sign-in picker has to name the
    // accounts before anybody has typed a PIN, so there is no key yet to read
    // them with. SECURITY.md says so.
    expect(Object.keys(PLANS)).not.toContain('clinicians')
  })

  it('leaves timestamps and ids indexed, and says which', async () => {
    // These are the metadata the design accepts leaking: how many
    // consultations, on what days, how far behind sync. Pinned here so that
    // adding a field to a `keep` list is a decision somebody makes on purpose.
    expect(PLANS.patients!.keep).toEqual(['id', 'updatedAt', 'syncedAt', 'deletedAt'])
    expect(PLANS.encounters!.keep).toEqual([
      'id',
      'patientId',
      'occurredAt',
      'status',
      'updatedAt',
      'syncedAt',
      'deletedAt',
    ])
    expect(PLANS.attachments!.keep).toEqual(['id', 'encounterId', 'createdAt'])
    expect(PLANS.audit!.keep).toEqual(['id', 'seq', 'actorId', 'action', 'at'])
  })

  it('keeps every index the schema declares, or queries would find nothing', async () => {
    // A field dropped from `keep` while still indexed is indexed as undefined,
    // and Dexie silently omits the row from that index. The symptom would be a
    // roster that is missing patients rather than an error.
    for (const [name, plan] of Object.entries(PLANS)) {
      const table = db.table(name)
      const indexed = [
        table.schema.primKey.keyPath,
        ...table.schema.indexes.map((i) => i.keyPath),
      ]
      for (const keyPath of indexed) {
        // Compound indexes are arrays; every part of one has to be kept too.
        for (const part of Array.isArray(keyPath) ? keyPath : [keyPath]) {
          expect(plan.keep, `${name} indexes ${String(part)}`).toContain(part)
        }
      }
    }
  })
})

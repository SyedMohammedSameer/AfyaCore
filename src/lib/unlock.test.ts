/**
 * Signing in and opening the records, which have to happen together.
 *
 * The interesting cases are all failures: a wrong PIN that leaves no key
 * behind, a right PIN for an account that has no key, and a device that is
 * carrying a year of plaintext consultations the first time anybody signs in.
 */
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../db/db'
import { VaultLockedError } from '../db/encryption'
import { createPatient } from '../db/repo'
import { setCurrentActor } from './audit'
import { createClinician, disableClinician, setPin } from './identity'
import { enrolClinician, unlockDevice } from './unlock'
import { getDataKey, isVaultEnabled, lockVault } from './vault'

setCurrentActor('test-admin', 'admin')

/**
 * A patient row as the previous build wrote it: no envelope, no key involved.
 *
 * It cannot be written through `createPatient` any more, because writes to an
 * encrypted table fail closed rather than falling back to plaintext — which is
 * the property tested in encryption.test.ts. So the pre-upgrade state is
 * staged the only way it can honestly exist: straight into the object store.
 */
async function putPlaintextPatient(id = 'legacy-1'): Promise<string> {
  if (!db.isOpen()) await db.open()
  await new Promise<void>((resolve, reject) => {
    const tx = db.backendDB().transaction('patients', 'readwrite')
    const request = tx.objectStore('patients').put({
      ...PATIENT,
      id,
      searchKey: 'rakotoarisoa voahirana',
      createdAt: 1_700_000_000_000,
      updatedAt: 1_700_000_000_000,
    })
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
  })
  return id
}

const PATIENT = {
  familyName: 'RAKOTOARISOA',
  givenName: 'Voahirana',
  sex: 'female' as const,
  preferredLang: 'mg' as const,
}

beforeEach(async () => {
  lockVault()
  await Promise.all([
    db.patients.clear(),
    db.encounters.clear(),
    db.clinicians.clear(),
    db.settings.clear(),
    db.audit.clear(),
  ])
})

describe('the first account on a device', () => {
  it('creates the vault, so the records are encrypted from the first one', async () => {
    expect(await isVaultEnabled()).toBe(false)
    await enrolClinician({ name: 'Dr Ranaivo', role: 'admin', pin: '4729' })

    expect(await isVaultEnabled()).toBe(true)
    expect(getDataKey()).not.toBeNull()
  })
})

describe('a colleague enrolled afterwards', () => {
  it('gets their own copy of the key under their own PIN', async () => {
    await enrolClinician({ name: 'Dr Ranaivo', role: 'admin', pin: '4729' })
    const midwife = await enrolClinician({ name: 'Hanta', role: 'clinician', pin: '8261' })
    const id = await createPatient(PATIENT)

    lockVault()
    const result = await unlockDevice(midwife, '8261')
    expect(result.ok).toBe(true)
    expect((await db.patients.get(id))!.familyName).toBe('RAKOTOARISOA')
  })

  it('cannot be enrolled while the vault is locked', async () => {
    // Otherwise the account would exist, sign in, and be unable to read
    // anything — a colleague who appears to be set up and is not.
    await enrolClinician({ name: 'Dr Ranaivo', role: 'admin', pin: '4729' })
    lockVault()
    await expect(
      enrolClinician({ name: 'Hanta', role: 'clinician', pin: '8261' }),
    ).rejects.toThrow(/locked/)
  })
})

describe('a wrong PIN', () => {
  it('leaves no key open behind the lock screen', async () => {
    const admin = await enrolClinician({ name: 'Dr Ranaivo', role: 'admin', pin: '4729' })
    const id = await createPatient(PATIENT)
    lockVault()

    const result = await unlockDevice(admin, '9999')
    expect(result.ok).toBe(false)
    expect(getDataKey()).toBeNull()
    await expect(db.patients.get(id)).rejects.toThrow(VaultLockedError)
  })

  it('still counts against the lockout', async () => {
    const admin = await enrolClinician({ name: 'Dr Ranaivo', role: 'admin', pin: '4729' })
    lockVault()

    const first = await unlockDevice(admin, '9999')
    expect(first.lockout.attemptsRemaining).toBe(4)
    const second = await unlockDevice(admin, '9998')
    expect(second.lockout.attemptsRemaining).toBe(3)
  })
})

describe('an account with no copy of the key', () => {
  it('is refused, and told so rather than being called wrong', async () => {
    await enrolClinician({ name: 'Dr Ranaivo', role: 'admin', pin: '4729' })
    // Created the old way: an account that predates the device being
    // encrypted, or one whose key was revoked.
    const orphan = await createClinician({ name: 'Hanta', role: 'clinician', pin: '8261' })
    lockVault()

    const result = await unlockDevice(orphan, '8261')
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('no_key')
    expect(getDataKey()).toBeNull()
  })

  it('does not spend one of their five attempts on it', async () => {
    // The PIN is right. Locking them out for five minutes over an
    // administrator's omission would be punishing the wrong person.
    await enrolClinician({ name: 'Dr Ranaivo', role: 'admin', pin: '4729' })
    const orphan = await createClinician({ name: 'Hanta', role: 'clinician', pin: '8261' })
    lockVault()

    await unlockDevice(orphan, '8261')
    await unlockDevice(orphan, '8261')
    const result = await unlockDevice(orphan, '8261')
    expect(result.lockout.attemptsRemaining).toBe(5)
  })

  it('is fixed by somebody who holds the key setting their PIN', async () => {
    const admin = await enrolClinician({ name: 'Dr Ranaivo', role: 'admin', pin: '4729' })
    const orphan = await createClinician({ name: 'Hanta', role: 'clinician', pin: '8261' })
    const id = await createPatient(PATIENT)

    // The administrator is signed in, so the key is open and can be passed on.
    await unlockDevice(admin, '4729')
    await setPin(orphan, '5183')

    lockVault()
    const result = await unlockDevice(orphan, '5183')
    expect(result.ok).toBe(true)
    expect((await db.patients.get(id))!.familyName).toBe('RAKOTOARISOA')
  })
})

describe('a disabled account', () => {
  it('loses its copy of the key, not just its ability to sign in', async () => {
    // Disabling has to reach the ciphertext. An account that can no longer
    // sign in but whose PIN still unwraps the database is a door left open to
    // anyone who can reach the IndexedDB file.
    await enrolClinician({ name: 'Dr Ranaivo', role: 'admin', pin: '4729' })
    const leaving = await enrolClinician({ name: 'Hanta', role: 'clinician', pin: '8261' })

    await disableClinician(leaving)
    lockVault()

    const result = await unlockDevice(leaving, '8261')
    expect(result.ok).toBe(false)
    expect(getDataKey()).toBeNull()
  })
})

describe('a device that already holds plaintext records', () => {
  it('encrypts them on the first sign-in after the update', async () => {
    // The upgrade path. An account exists from before encryption, the register
    // is in the clear, and the first person to sign in creates the key and
    // converts what is there.
    const admin = await createClinician({ name: 'Dr Ranaivo', role: 'admin', pin: '4729' })
    const id = await putPlaintextPatient()
    expect(await isVaultEnabled()).toBe(false)

    const result = await unlockDevice(admin, '4729')
    expect(result.ok).toBe(true)
    expect(await isVaultEnabled()).toBe(true)

    // Readable while signed in...
    expect((await db.patients.get(id))!.familyName).toBe('RAKOTOARISOA')
    // ...and not once the session ends.
    lockVault()
    await expect(db.patients.get(id)).rejects.toThrow(VaultLockedError)
  })
})

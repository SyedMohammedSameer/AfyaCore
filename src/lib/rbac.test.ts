/**
 * Permissions at service boundaries.
 *
 * The matrix in identity.ts was previously consulted only by components, which
 * made it a description of what the UI happens to render rather than a
 * property of the system. A clinician could reach an identified export, delete
 * a patient, un-enrol the device and erase the database — every one an admin
 * permission that was declared and never enforced.
 *
 * These tests are deliberately written from the clinician's side. Asserting
 * that an admin can do admin things proves nothing; asserting that a clinician
 * cannot is the whole control.
 */
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../db/db'
import { setCurrentActor } from './audit'
import { PermissionError, can, requirePermission } from './identity'
import { deidentify } from './deidentify'
import { purgeExpired, setRetentionYears } from './retention'
import { deletePatient } from '../db/repo'
import { setSyncSettings, unenrolDevice } from './sync'
import { clearAllData } from '../db/seed'
import type { Patient } from '../db/schema'

const patient = (): Patient => ({
  id: 'p1',
  givenName: 'Voahirana',
  familyName: 'RAKOTOARISOA',
  sex: 'female',
  preferredLang: 'mg',
  researchConsent: 'granted',
  searchKey: 'rakotoarisoa voahirana',
  createdAt: 0,
  updatedAt: 0,
})

beforeEach(async () => {
  await db.delete()
  await db.open()
})

describe('a clinician is refused what the matrix reserves for admins', () => {
  beforeEach(() => setCurrentActor('clin_1', 'clinician'))

  it('cannot produce an identified export', async () => {
    // The most disclosing operation in the app: names, phone numbers and
    // villages leaving the device in a file.
    await expect(deidentify([patient()], [], { level: 'identified' })).rejects.toThrow(
      PermissionError,
    )
  })

  it('can still produce a de-identified export', async () => {
    // The gate must not block the clinician's actual job.
    const r = await deidentify([patient()], [], { level: 'pseudonymous' })
    expect(r.patients).toHaveLength(1)
  })

  it('cannot delete a patient', async () => {
    await db.patients.add(patient())
    await expect(deletePatient('p1')).rejects.toThrow(PermissionError)
    expect(await db.patients.get('p1')).toBeDefined()
  })

  it('cannot erase the database', async () => {
    await db.patients.add(patient())
    await expect(clearAllData()).rejects.toThrow(PermissionError)
    expect(await db.patients.count()).toBe(1)
  })

  it('cannot repoint the device at another sync server', async () => {
    // Repointing sync is exfiltration with extra steps.
    await expect(setSyncSettings({ serverUrl: 'https://elsewhere.example' })).rejects.toThrow(
      PermissionError,
    )
  })

  it('cannot un-enrol the device', async () => {
    await expect(unenrolDevice()).rejects.toThrow(PermissionError)
  })

  it('cannot set a retention period or purge records', async () => {
    await expect(setRetentionYears(5)).rejects.toThrow(PermissionError)
    await expect(purgeExpired()).rejects.toThrow(PermissionError)
  })
})

describe('an administrator is not blocked', () => {
  beforeEach(() => setCurrentActor('adm_1', 'admin'))

  it('can produce an identified export', async () => {
    const r = await deidentify([patient()], [], { level: 'identified' })
    expect(r.patients[0]!.familyName).toBe('RAKOTOARISOA')
  })

  it('can delete a patient', async () => {
    await db.patients.add(patient())
    await deletePatient('p1')
    expect((await db.patients.get('p1'))!.deletedAt).toBeDefined()
  })
})

describe('signed out', () => {
  it('is refused, not treated as trusted', async () => {
    // Nothing should reach a guarded operation with no session. If something
    // does, that is the bug the throw surfaces rather than hides.
    setCurrentActor(undefined)
    expect(() => requirePermission('record')).toThrow(PermissionError)
    expect(can(undefined, 'record')).toBe(false)
  })

  it('forgets the role when the actor is cleared', async () => {
    // Sign out must drop the role too, or a signed-out session keeps the
    // permissions of whoever last used the device.
    setCurrentActor('adm_1', 'admin')
    setCurrentActor(undefined)
    expect(() => requirePermission('manage.device')).toThrow(PermissionError)
  })
})

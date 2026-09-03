/**
 * Retention purge.
 *
 * The tests that matter here are the ones asserting what is *not* destroyed.
 * A purge is irreversible and runs against a facility's only copy of a year of
 * consultations, so every precondition is worth a named test.
 */
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../db/db'
import { purgeExpired, retentionCutoff, retentionStatus, setRetentionYears } from './retention'
import type { Encounter, Patient } from '../db/schema'

const YEAR = 365.2425 * 86_400_000
const NOW = Date.UTC(2026, 8, 3)

const patient = (id: string): Patient => ({
  id,
  givenName: 'Voahirana',
  familyName: 'RAKOTOARISOA',
  sex: 'female',
  preferredLang: 'mg',
  searchKey: 'rakotoarisoa voahirana',
  createdAt: 0,
  updatedAt: 0,
})

const encounter = (over: Partial<Encounter> & { id: string; patientId: string }): Encounter => ({
  occurredAt: NOW - 10 * YEAR,
  vitals: {},
  prescriptions: [],
  provenance: {},
  attachmentIds: [],
  status: 'final',
  syncedAt: NOW - 9 * YEAR,
  createdAt: 0,
  updatedAt: 0,
  ...over,
})

beforeEach(async () => {
  await db.delete()
  await db.open()
})

describe('retention period', () => {
  it('purges nothing at all when no period has been established', async () => {
    // Most country profiles carry retentionYears: null, because we could not
    // establish it from a primary source. Null means "find out", and with
    // nothing set the safe direction is also the default: no destruction.
    await db.patients.add(patient('p1'))
    await db.encounters.add(encounter({ id: 'e1', patientId: 'p1' }))

    const status = await retentionStatus(NOW)
    expect(status.years).toBeNull()
    expect(status.eligible).toBe(0)
    expect(await purgeExpired(NOW)).toEqual({ encounters: 0, attachments: 0, patients: 0 })
    expect(await db.encounters.count()).toBe(1)
  })

  it('measures from the encounter date, not from when the row was created', async () => {
    // Retention law counts from when care was given. A record back-entered
    // from a paper register last week can already be past its period.
    await setRetentionYears(5)
    await db.patients.add(patient('p1'))
    await db.encounters.add(
      encounter({ id: 'e1', patientId: 'p1', occurredAt: NOW - 6 * YEAR, createdAt: NOW }),
    )
    expect((await retentionStatus(NOW)).eligible).toBe(1)
  })

  it('leaves a record that is inside the period', async () => {
    await setRetentionYears(10)
    await db.patients.add(patient('p1'))
    await db.encounters.add(encounter({ id: 'e1', patientId: 'p1', occurredAt: NOW - 3 * YEAR }))
    await purgeExpired(NOW)
    expect(await db.encounters.count()).toBe(1)
  })
})

describe('what a purge refuses to destroy', () => {
  beforeEach(async () => {
    await setRetentionYears(5)
    await db.patients.add(patient('p1'))
  })

  it('never destroys a record the server has not got', async () => {
    // The condition that turns an irreversible operation into a survivable
    // one. A phone offline for a month is the normal case here, and purging
    // an unsynced record destroys the only copy that exists.
    await db.encounters.add(encounter({ id: 'e1', patientId: 'p1', syncedAt: undefined }))
    const status = await retentionStatus(NOW)
    expect(status.eligible).toBe(0)
    expect(status.blockedUnsynced).toBe(1)

    await purgeExpired(NOW)
    expect(await db.encounters.count()).toBe(1)
  })

  it('never destroys a draft', async () => {
    // A draft is unfinished work, not a record. Its age says nothing about
    // whether it may be destroyed.
    await db.encounters.add(encounter({ id: 'e1', patientId: 'p1', status: 'draft' }))
    await purgeExpired(NOW)
    expect(await db.encounters.count()).toBe(1)
  })

  it('reports unsynced records separately rather than counting them as kept', async () => {
    // A backup problem, not a retention one. Folding them into "kept" hides
    // that the facility has records existing on exactly one device.
    await db.encounters.add(encounter({ id: 'e1', patientId: 'p1', syncedAt: undefined }))
    await db.encounters.add(encounter({ id: 'e2', patientId: 'p1' }))
    const status = await retentionStatus(NOW)
    expect(status).toMatchObject({ eligible: 1, blockedUnsynced: 1 })
  })
})

describe('purging', () => {
  beforeEach(async () => {
    await setRetentionYears(5)
  })

  it('destroys the row rather than tombstoning it', async () => {
    // The difference from deletePatient, and the whole reason this exists.
    // A tombstone keeps the clinical content on the disk, which is not
    // erasure in the sense a regulator means.
    await db.patients.add(patient('p1'))
    await db.encounters.add(encounter({ id: 'e1', patientId: 'p1' }))
    await purgeExpired(NOW)
    expect(await db.encounters.get('e1')).toBeUndefined()
  })

  it('takes the attachments with the encounter', async () => {
    await db.patients.add(patient('p1'))
    await db.encounters.add(encounter({ id: 'e1', patientId: 'p1' }))
    await db.attachments.add({
      id: 'a1',
      encounterId: 'e1',
      blob: new Blob(['x']),
      width: 1,
      height: 1,
      byteSize: 1,
      createdAt: 0,
    })
    const result = await purgeExpired(NOW)
    expect(result.attachments).toBe(1)
    expect(await db.attachments.count()).toBe(0)
  })

  it('removes a patient once nothing of theirs is left', async () => {
    // A patient row with no encounters is a roster of names with no clinical
    // justification for holding them — the identifying half of the data
    // surviving the clinical half it was collected for.
    await db.patients.add(patient('p1'))
    await db.encounters.add(encounter({ id: 'e1', patientId: 'p1' }))
    const result = await purgeExpired(NOW)
    expect(result.patients).toBe(1)
    expect(await db.patients.get('p1')).toBeUndefined()
  })

  it('keeps a patient who still has a record inside the period', async () => {
    await db.patients.add(patient('p1'))
    await db.encounters.add(encounter({ id: 'old', patientId: 'p1' }))
    await db.encounters.add(encounter({ id: 'recent', patientId: 'p1', occurredAt: NOW - YEAR }))
    const result = await purgeExpired(NOW)
    expect(result.encounters).toBe(1)
    expect(result.patients).toBe(0)
    expect(await db.patients.get('p1')).toBeDefined()
  })

  it('writes an audit entry naming what it destroyed', async () => {
    await db.patients.add(patient('p1'))
    await db.encounters.add(encounter({ id: 'e1', patientId: 'p1' }))
    await purgeExpired(NOW)
    const entry = (await db.audit.toArray()).find((a) => a.action === 'retention.purge')
    expect(entry?.detail).toContain('encounters=1')
    expect(entry?.detail).toContain('years=5')
  })
})

describe('retentionCutoff', () => {
  it('is the retention period before now', () => {
    expect(retentionCutoff(5, NOW)).toBeCloseTo(NOW - 5 * YEAR, -3)
  })
})

/**
 * Integration tests for the repository against a real IndexedDB.
 *
 * The rest of the suite deliberately tests pure functions in Node with no DOM.
 * That convention has one blind spot, and it is exactly where this file lives:
 * Dexie's transaction scoping is a *runtime* rule, so a repository function
 * that appends an audit entry inside a transaction that does not list the audit
 * table typechecks perfectly and throws the moment a clinician deletes a
 * patient. `fake-indexeddb` is the smallest thing that catches that.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import 'fake-indexeddb/auto'
import { db } from './db'
import {
  createPatient,
  updatePatient,
  createDraftEncounter,
  finaliseEncounter,
  deleteEncounter,
  deletePatient,
  mergePatients,
  patchEncounter,
} from './repo'
import { setCurrentActor, verifyAuditChain, recentAudit } from '../lib/audit'


async function newPatient(familyName = 'Rakotoarisoa') {
  return createPatient({
    familyName,
    givenName: 'Hery',
    sex: 'male',
    preferredLang: 'mg',
  })
}

const actions = async () => (await recentAudit()).map((e) => e.action)

beforeEach(async () => {
  await db.delete()
  await db.open()
  // Admin because this suite deletes patients; the role now travels with the
  // actor and service boundaries enforce it. The gate has its own tests.
  setCurrentActor('clin_test', 'admin')
})

describe('audit entries are written for every recorded action', () => {
  it('records patient creation', async () => {
    const id = await newPatient()
    const [entry] = await recentAudit()
    expect(entry!.action).toBe('patient.create')
    expect(entry!.subjectId).toBe(id)
    expect(entry!.actorId).toBe('clin_test')
  })

  it('records which fields an edit touched, but not their values', async () => {
    const id = await newPatient()
    await updatePatient(id, { phone: '0341234567', address: 'Ambohimanga' })

    const [entry] = await recentAudit()
    expect(entry!.action).toBe('patient.update')
    expect(entry!.detail).toContain('phone')
    expect(entry!.detail).toContain('address')
    // The whole point: the log says a phone number changed, never to what.
    expect(entry!.detail).not.toContain('0341234567')
    expect(entry!.detail).not.toContain('Ambohimanga')
  })

  it('distinguishes confirming a draft from amending a final record', async () => {
    const patientId = await newPatient()
    const id = await createDraftEncounter(patientId)

    await finaliseEncounter(id)
    expect((await recentAudit())[0]!.action).toBe('encounter.finalise')

    // Correcting a confirmed record keeps it confirmed, so the only way a
    // reviewer can tell it was changed after sign-off is this entry.
    await finaliseEncounter(id)
    expect((await recentAudit())[0]!.action).toBe('encounter.amend')
  })

  it('does not log every keystroke on a draft', async () => {
    const patientId = await newPatient()
    const id = await createDraftEncounter(patientId)
    for (const temperature of [37.1, 37.4, 38.5]) {
      await patchEncounter(id, { vitals: { temperature } })
    }
    // create only; the intermediate states of a draft are working notes.
    expect(await actions()).toEqual(['encounter.create', 'patient.create'])
  })

  it('records a patient deletion with its consultation count', async () => {
    const patientId = await newPatient()
    await createDraftEncounter(patientId)
    await createDraftEncounter(patientId)

    // Would throw "Table audit not part of transaction" if the transaction
    // scope omitted db.audit.
    await deletePatient(patientId)

    const [entry] = await recentAudit()
    expect(entry!.action).toBe('patient.delete')
    expect(entry!.detail).toBe('2 encounters')
  })

  it('records an encounter deletion', async () => {
    const patientId = await newPatient()
    const id = await createDraftEncounter(patientId)
    await deleteEncounter(id)
    expect((await recentAudit())[0]!.action).toBe('encounter.delete')
  })

  it('records a merge, naming what moved and what was filled in', async () => {
    const keepId = await newPatient('Rakoto')
    const dupId = await createPatient({
      familyName: 'Rakoto',
      givenName: 'Hery',
      sex: 'male',
      preferredLang: 'mg',
      phone: '0341234567',
    })
    await createDraftEncounter(dupId)

    // Same transaction-scope hazard as deletePatient.
    const outcome = await mergePatients(keepId, dupId)
    expect(outcome.moved).toBe(1)

    const [entry] = await recentAudit()
    expect(entry!.action).toBe('patient.merge')
    expect(entry!.detail).toContain('moved=1')
    expect(entry!.detail).toContain('phone')
  })
})

describe('the audit chain', () => {
  it('stays verifiable across a realistic sequence of work', async () => {
    const patientId = await newPatient()
    await updatePatient(patientId, { phone: '0341234567' })
    const encounterId = await createDraftEncounter(patientId)
    await finaliseEncounter(encounterId)
    await deleteEncounter(encounterId)

    const result = await verifyAuditChain()
    expect(result.ok).toBe(true)
    expect(result.entries).toBe(5)
    expect(result.from).toBe(1)
  })

  it('detects an entry edited behind its back', async () => {
    const patientId = await newPatient()
    await updatePatient(patientId, { phone: '0341234567' })
    await deletePatient(patientId)

    // Somebody with devtools quietly rewrites what happened.
    await db.audit.update('3', { action: 'patient.update' })

    const result = await verifyAuditChain()
    expect(result.ok).toBe(false)
    expect(result.brokenAt).toBe(3)
    expect(result.reason).toBe('hash_mismatch')
  })

  it('detects a deleted entry', async () => {
    const patientId = await newPatient()
    await updatePatient(patientId, { phone: '0341234567' })
    await deletePatient(patientId)

    await db.audit.delete('2')

    const result = await verifyAuditChain()
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('sequence_gap')
  })

  it('verifies from the oldest retained entry after a trim, and says so', async () => {
    for (let i = 0; i < 5; i++) await newPatient(`Patient${i}`)
    await db.audit.delete('1')
    await db.audit.delete('2')

    // Honest reporting is the property under test: "verified from 3" is a
    // different claim from "verified from the beginning".
    const result = await verifyAuditChain()
    expect(result.ok).toBe(true)
    expect(result.from).toBe(3)
    expect(result.entries).toBe(3)
  })
})

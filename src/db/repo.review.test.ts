/**
 * The review gate, against a real IndexedDB.
 *
 * `pendingReviews` is pure and tested on its own. What has to be tested here
 * is that the repository actually refuses: a draft with an unticked dictated
 * value must not become final however it is asked, a tick must be bound to
 * the value the reviewer saw, and a correction to a confirmed record must go
 * back through the same gate without ever demoting the record to a draft.
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import 'fake-indexeddb/auto'
import { db } from './db'
import {
  createPatient,
  createDraftEncounter,
  finaliseEncounter,
  patchEncounter,
  reviewEncounterField,
} from './repo'
import { fieldSignature, pendingReviews } from '../lib/fieldReview'
import { recentAudit, setCurrentActor } from '../lib/audit'
import { openTestVault } from '../test/vault'

async function dictatedDraft() {
  const patientId = await createPatient({ familyName: 'Rakoto', givenName: 'Hery', sex: 'male', preferredLang: 'mg' })
  const id = await createDraftEncounter(patientId)
  await patchEncounter(id, {
    vitals: { temperature: 38.5, pulse: 92 },
    diagnosis: 'paludisme simple',
    provenance: {
      'vitals.temperature': { source: 'voice', confidence: 0.9, rawText: 'température trente-huit cinq' },
      'vitals.pulse': { source: 'manual' },
      diagnosis: { source: 'voice', confidence: 0.8, rawText: 'diagnostic paludisme simple' },
    },
  })
  return id
}

async function tickAll(id: string) {
  const e = (await db.encounters.get(id))!
  for (const key of pendingReviews(e)) await reviewEncounterField(id, key, fieldSignature(e, key))
}

// Every clinical table refuses to be written while the vault is locked, so a
// suite that writes one has to open it. See src/db/encryption.test.ts, where
// that refusal is the thing being asserted.
beforeAll(() => openTestVault())

beforeEach(async () => {
  await db.delete()
  await db.open()
  setCurrentActor('clin_test', 'clinician')
})

describe('finaliseEncounter refuses unreviewed machine values', () => {
  it('throws review-required and leaves the draft a draft', async () => {
    const id = await dictatedDraft()
    await expect(finaliseEncounter(id)).rejects.toThrow('review-required')
    expect((await db.encounters.get(id))!.status).toBe('draft')
    expect((await recentAudit()).map((e) => e.action)).not.toContain('encounter.finalise')
  })

  it('confirms once every machine value is ticked, and counts them in the audit entry', async () => {
    const id = await dictatedDraft()
    await tickAll(id)
    await finaliseEncounter(id)
    const row = (await db.encounters.get(id))!
    expect(row.status).toBe('final')
    const [entry] = await recentAudit()
    expect(entry!.action).toBe('encounter.finalise')
    // Two machine fields; the typed pulse needs no review.
    expect(entry!.detail).toBe('machineFieldsReviewed=2')
    // Names a person and a time, never a value.
    expect(row.fieldReviews!['vitals.temperature']!.by).toBe('clin_test')
    expect(JSON.stringify(entry)).not.toContain('38.5')
  })

  it('needs no review at all for a consultation typed by hand', async () => {
    const patientId = await createPatient({ familyName: 'Rakoto', givenName: 'Hery', sex: 'male', preferredLang: 'mg' })
    const id = await createDraftEncounter(patientId)
    await patchEncounter(id, { vitals: { temperature: 37 }, provenance: { 'vitals.temperature': { source: 'manual' } } })
    await finaliseEncounter(id)
    expect((await db.encounters.get(id))!.status).toBe('final')
  })
})

describe('reviewEncounterField binds the tick to the value seen', () => {
  it('refuses a tick whose signature no longer matches the row', async () => {
    const id = await dictatedDraft()
    const seen = fieldSignature((await db.encounters.get(id))!, 'vitals.temperature')
    // The value moves between the reviewer looking and the reviewer ticking.
    await patchEncounter(id, {
      vitals: { temperature: 39.5 },
      provenance: { 'vitals.temperature': { source: 'voice', confidence: 0.9, rawText: 'trente-neuf cinq' } },
    })
    await expect(reviewEncounterField(id, 'vitals.temperature', seen)).rejects.toThrow('review-field-changed')
    expect((await db.encounters.get(id))!.fieldReviews).toBeUndefined()
  })

  it('refuses a tick on a field the machine did not fill', async () => {
    const id = await dictatedDraft()
    const e = (await db.encounters.get(id))!
    await expect(reviewEncounterField(id, 'vitals.pulse', fieldSignature(e, 'vitals.pulse'))).rejects.toThrow(
      'review-field-changed',
    )
  })

  it('refuses without a signed-in reviewer', async () => {
    const id = await dictatedDraft()
    const e = (await db.encounters.get(id))!
    setCurrentActor(undefined)
    await expect(
      reviewEncounterField(id, 'vitals.temperature', fieldSignature(e, 'vitals.temperature')),
    ).rejects.toThrow('review-signin-required')
  })

  it('makes a ticked value pending again when a later dictation changes it', async () => {
    const id = await dictatedDraft()
    await tickAll(id)
    expect(pendingReviews((await db.encounters.get(id))!)).toEqual([])
    await patchEncounter(id, {
      vitals: { temperature: 39.5 },
      provenance: { 'vitals.temperature': { source: 'voice', confidence: 0.9, rawText: 'trente-neuf cinq' } },
    })
    expect(pendingReviews((await db.encounters.get(id))!)).toEqual(['vitals.temperature'])
    await expect(finaliseEncounter(id)).rejects.toThrow('review-required')
  })
})

describe('correcting a confirmed record', () => {
  it('keeps the record final while a new machine value waits for review, then audits an amendment', async () => {
    const id = await dictatedDraft()
    await tickAll(id)
    await finaliseEncounter(id)

    // A photo read during the correction adds a value nobody has ticked.
    await patchEncounter(id, {
      vitals: { weight: 54 },
      provenance: { 'vitals.weight': { source: 'photo', confidence: 0.7, rawText: 'poids 54' } },
    })
    const amended = (await db.encounters.get(id))!
    // Safety property 5: a confirmed record is never demoted.
    expect(amended.status).toBe('final')
    expect(pendingReviews(amended)).toEqual(['vitals.weight'])

    await expect(finaliseEncounter(id)).rejects.toThrow('review-required')
    await tickAll(id)
    await finaliseEncounter(id)
    const [entry] = await recentAudit()
    expect(entry!.action).toBe('encounter.amend')
  })
})

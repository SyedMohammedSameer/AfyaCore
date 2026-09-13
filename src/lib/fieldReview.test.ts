import { describe, expect, it } from 'vitest'
import {
  fieldSignature,
  fieldValue,
  isReviewed,
  isStale,
  machineFields,
  pendingReviews,
  reviewProgress,
} from './fieldReview'
import type { Encounter } from '../db/schema'

const encounter = (over: Partial<Encounter> = {}): Encounter => ({
  id: 'e1',
  patientId: 'p1',
  occurredAt: 0,
  vitals: { temperature: 38.5, pulse: 92 },
  prescriptions: [{ id: 'rx1', drug: 'paracétamol', dose: '500 mg', frequencyPerDay: 3, durationDays: 5 }],
  provenance: {
    'vitals.temperature': { source: 'voice', confidence: 0.9, rawText: 'température trente-huit cinq' },
    'vitals.pulse': { source: 'manual' },
    'prescription.rx1': { source: 'voice', confidence: 0.85, rawText: 'paracétamol 500 trois fois par jour' },
    diagnosis: { source: 'photo', confidence: 0.6, rawText: 'palu' },
  },
  attachmentIds: [],
  status: 'draft',
  createdAt: 0,
  updatedAt: 0,
  ...over,
})

describe('machineFields', () => {
  it('lists every field the machine filled and skips typed ones', () => {
    // No diagnosis value yet, so its provenance entry is not a field to review.
    expect(machineFields(encounter()).sort()).toEqual(['prescription.rx1', 'vitals.temperature'])
  })

  it('ignores provenance for a value that was since cleared', () => {
    const e = encounter({ vitals: { pulse: 92 } })
    expect(machineFields(e)).toEqual(['prescription.rx1'])
  })

  it('ignores an empty string, which is what a cleared text field holds', () => {
    const e = encounter({ diagnosis: '' })
    expect(machineFields(e)).not.toContain('diagnosis')
  })
})

describe('fieldSignature', () => {
  it('binds the value, its source and the phrase it came from', () => {
    const a = fieldSignature(encounter(), 'vitals.temperature')
    const b = fieldSignature(encounter({ vitals: { temperature: 38.6, pulse: 92 } }), 'vitals.temperature')
    const c = fieldSignature(
      encounter({
        provenance: {
          ...encounter().provenance,
          'vitals.temperature': { source: 'photo', confidence: 0.9, rawText: 'température trente-huit cinq' },
        },
      }),
      'vitals.temperature',
    )
    expect(a).not.toBe(b)
    expect(a).not.toBe(c)
  })

  it('is stable for a prescription regardless of object key order', () => {
    const reordered = encounter({
      prescriptions: [{ durationDays: 5, frequencyPerDay: 3, dose: '500 mg', drug: 'paracétamol', id: 'rx1' }],
    })
    expect(fieldSignature(encounter(), 'prescription.rx1')).toBe(fieldSignature(reordered, 'prescription.rx1'))
  })

  it('returns undefined values for keys it does not know', () => {
    expect(fieldValue(encounter(), 'attachments.0')).toBeUndefined()
  })
})

describe('pendingReviews', () => {
  it('starts with every machine field pending', () => {
    expect(pendingReviews(encounter()).sort()).toEqual(['prescription.rx1', 'vitals.temperature'])
  })

  it('clears a field whose tick matches the current value', () => {
    const e = encounter()
    e.fieldReviews = {
      'vitals.temperature': { signature: fieldSignature(e, 'vitals.temperature'), at: 1, by: 'clin_1' },
    }
    expect(isReviewed(e, 'vitals.temperature')).toBe(true)
    expect(pendingReviews(e)).toEqual(['prescription.rx1'])
  })

  it('puts a field back when the value moved under the tick', () => {
    const before = encounter()
    const signature = fieldSignature(before, 'vitals.temperature')
    const after = encounter({
      vitals: { temperature: 39.5, pulse: 92 },
      fieldReviews: { 'vitals.temperature': { signature, at: 1, by: 'clin_1' } },
    })
    expect(isReviewed(after, 'vitals.temperature')).toBe(false)
    expect(isStale(after, 'vitals.temperature')).toBe(true)
    expect(pendingReviews(after)).toContain('vitals.temperature')
  })

  it('does not count a tick with no reviewer behind it', () => {
    const e = encounter()
    e.fieldReviews = {
      'vitals.temperature': { signature: fieldSignature(e, 'vitals.temperature'), at: 1, by: '' },
    }
    expect(isReviewed(e, 'vitals.temperature')).toBe(false)
    expect(isStale(e, 'vitals.temperature')).toBe(false)
  })

  it('reports progress as a count the screen can draw', () => {
    const e = encounter()
    e.fieldReviews = {
      'prescription.rx1': { signature: fieldSignature(e, 'prescription.rx1'), at: 1, by: 'clin_1' },
    }
    expect(reviewProgress(e)).toEqual({ total: 2, done: 1, pending: ['vitals.temperature'] })
  })

  it('is empty for a consultation typed entirely by hand', () => {
    const e = encounter({
      provenance: { 'vitals.temperature': { source: 'manual' }, 'vitals.pulse': { source: 'manual' } },
      prescriptions: [],
    })
    expect(pendingReviews(e)).toEqual([])
  })
})

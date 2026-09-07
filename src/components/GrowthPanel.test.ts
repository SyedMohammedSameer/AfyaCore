/**
 * The eligibility rule is the safety-relevant part of this component: it is
 * what stops a chart being drawn for someone WHO's standards do not cover.
 */
import { describe, expect, it } from 'vitest'
import { ageDaysAt } from './GrowthPanel'
import type { Patient } from '../db/schema'

const AT = new Date('2026-09-07T00:00:00Z').getTime()

function patient(over: Partial<Patient> = {}): Patient {
  return { id: 'p', givenName: 'A', familyName: 'B', sex: 'male', preferredLang: 'fr' , searchKey: '', createdAt: 0, updatedAt: 0, ...over } as Patient
}

describe('ageDaysAt', () => {
  it('counts whole days since birth', () => {
    expect(ageDaysAt(patient({ birthDate: '2026-09-07' }), AT)).toBe(0)
    expect(ageDaysAt(patient({ birthDate: '2025-09-07' }), AT)).toBe(365)
  })

  it('has no answer without a birth date', () => {
    // `approximateAge` is deliberately not enough. A z-score needs days, and a
    // year rounded from an estimate moves weight-for-age by most of a standard
    // deviation — which is the difference between a referral and a follow-up.
    expect(ageDaysAt(patient({ approximateAge: 3 }), AT)).toBeUndefined()
    expect(ageDaysAt(patient({ birthDate: 'not a date' }), AT)).toBeUndefined()
  })

  it('is negative for a date in the future, so callers can reject it', () => {
    expect(ageDaysAt(patient({ birthDate: '2027-01-01' }), AT)).toBeLessThan(0)
  })
})

import { describe, expect, it } from 'vitest'
import { mergeFields } from './repo'
import type { Patient } from './schema'
import { setCurrentActor } from '../lib/audit'

// Service boundaries enforce the permission matrix, so a suite that never
// signs in is refused. Admin because these exercise the operation, not the
// gate; the gate has its own tests.
setCurrentActor('test-admin', 'admin')

/**
 * Merge field rules.
 *
 * The transaction around `mergeFields` only moves rows between two ids; this
 * function holds the only judgement in a merge, and getting it backwards would
 * silently overwrite a corrected phone number or claim a birth date the record
 * does not have. Those are the cases below.
 */
const patient = (over: Partial<Patient> = {}): Patient => ({
  id: 'p1',
  familyName: 'RAKOTOARISOA',
  givenName: 'Voahirana',
  sex: 'female',
  preferredLang: 'mg',
  searchKey: 'rakotoarisoa voahirana',
  createdAt: 0,
  updatedAt: 0,
  ...over,
})

describe('mergeFields', () => {
  it('never overwrites a value the surviving record already has', () => {
    const keep = patient({ phone: '034 11 111 11', address: 'Ambohimanga' })
    const duplicate = patient({ id: 'p2', phone: '032 99 999 99', address: 'Anjozorobe' })

    const { changes, filled } = mergeFields(keep, duplicate)

    expect(changes.phone).toBeUndefined()
    expect(changes.address).toBeUndefined()
    expect(filled).toEqual([])
  })

  it('fills only the fields the surviving record left blank', () => {
    const keep = patient({ phone: '034 11 111 11', address: undefined, registerNo: undefined })
    const duplicate = patient({ id: 'p2', phone: '032 99 999 99', address: 'Anjozorobe', registerNo: '2042' })

    const { changes, filled } = mergeFields(keep, duplicate)

    expect(changes.address).toBe('Anjozorobe')
    expect(changes.registerNo).toBe('2042')
    expect(changes.phone).toBeUndefined()
    expect(filled.sort()).toEqual(['address', 'registerNo'])
  })

  it('treats an empty string as blank, not as a value worth keeping', () => {
    const keep = patient({ givenName: '' })
    const duplicate = patient({ id: 'p2', givenName: 'Voahirana' })

    expect(mergeFields(keep, duplicate).changes.givenName).toBe('Voahirana')
  })

  it('does not copy a blank over a blank', () => {
    const keep = patient({ givenName: '', phone: undefined })
    const duplicate = patient({ id: 'p2', givenName: '', phone: undefined })

    expect(mergeFields(keep, duplicate).filled).toEqual([])
  })

  it('takes a known sex over unknown, but never replaces a recorded one', () => {
    const unknownKeep = patient({ sex: 'unknown' })
    expect(mergeFields(unknownKeep, patient({ id: 'p2', sex: 'male' })).changes.sex).toBe('male')

    const knownKeep = patient({ sex: 'female' })
    expect(mergeFields(knownKeep, patient({ id: 'p2', sex: 'male' })).changes.sex).toBeUndefined()
  })

  it('carries birthDatePrecision along with an inherited birth date', () => {
    const keep = patient({ birthDate: undefined })
    const duplicate = patient({ id: 'p2', birthDate: '1992-04-11', birthDatePrecision: 'estimated' })

    const { changes } = mergeFields(keep, duplicate)

    expect(changes.birthDate).toBe('1992-04-11')
    // Inheriting the date but not its precision would upgrade an estimate into
    // a date the record claims to know exactly.
    expect(changes.birthDatePrecision).toBe('estimated')
  })

  it('leaves precision alone when the birth date was not inherited', () => {
    const keep = patient({ birthDate: '1990-01-01', birthDatePrecision: 'day' })
    const duplicate = patient({ id: 'p2', birthDate: '1992-04-11', birthDatePrecision: 'estimated' })

    expect(mergeFields(keep, duplicate).changes.birthDatePrecision).toBeUndefined()
  })

  it('never proposes changing identity fields the merge has no business touching', () => {
    const keep = patient({ familyName: 'RAKOTOARISOA', preferredLang: 'mg' })
    const duplicate = patient({ id: 'p2', familyName: 'RAKOTOARISOANA', preferredLang: 'fr' })

    const { changes } = mergeFields(keep, duplicate)

    expect(changes.familyName).toBeUndefined()
    expect(changes.preferredLang).toBeUndefined()
    expect(changes.id).toBeUndefined()
  })
})

/**
 * The asymmetry drives these tests.
 *
 * A missed duplicate is recoverable — the merge flow exists. A false positive
 * tells a clinician the person in front of them is somebody else, and if it is
 * believed a consultation is appended to the wrong record. So most of what is
 * asserted here is what must *not* be flagged.
 */
import { describe, expect, it } from 'vitest'
import {
  ageOf,
  editDistance,
  findDuplicates,
  nameSimilarity,
  scoreAgainst,
  type Candidate,
} from './duplicates'
import type { Patient } from '../db/schema'

const NOW = new Date('2026-09-04T00:00:00Z').getTime()

function patient(over: Partial<Patient> = {}): Patient {
  return {
    id: over.id ?? 'p1',
    givenName: 'Voahirana',
    familyName: 'Rakotoarisoa',
    sex: 'female',
    approximateAge: 34,
    preferredLang: 'mg',
    searchKey: '',
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  } as Patient
}

const SAME: Candidate = {
  givenName: 'Voahirana',
  familyName: 'Rakotoarisoa',
  sex: 'female',
  approximateAge: 34,
}

describe('editDistance', () => {
  it('counts the edits between two spellings', () => {
    expect(editDistance('rakoto', 'rakoto')).toBe(0)
    expect(editDistance('rakoto', 'rakota')).toBe(1)
    expect(editDistance('', 'rakoto')).toBe(6)
    expect(editDistance('rakoto', '')).toBe(6)
    expect(editDistance('kitten', 'sitting')).toBe(3)
  })
})

describe('nameSimilarity', () => {
  it('ignores case and accents, which is the whole point', () => {
    expect(nameSimilarity('RAKOTOÀRISOA', 'rakotoarisoa')).toBe(1)
  })

  it('rates a one-letter misspelling close and a different name far', () => {
    expect(nameSimilarity('Rakotoarisoa', 'Rakotoarisoq')).toBeGreaterThan(0.9)
    expect(nameSimilarity('Rakotoarisoa', 'Randrianasolo')).toBeLessThan(0.6)
  })

  it('is zero when either side is missing', () => {
    expect(nameSimilarity('', 'Rakoto')).toBe(0)
    expect(nameSimilarity('Rakoto', '')).toBe(0)
  })
})

describe('ageOf', () => {
  it('prefers a real birth date and falls back to an estimate', () => {
    expect(ageOf({ birthDate: '1992-01-01' }, NOW)).toBe(34)
    expect(ageOf({ approximateAge: 7 }, NOW)).toBe(7)
    expect(ageOf({}, NOW)).toBeUndefined()
  })

  it('ignores an unparseable birth date rather than returning NaN', () => {
    expect(ageOf({ birthDate: 'not a date', approximateAge: 12 }, NOW)).toBe(12)
  })
})

describe('what must be flagged', () => {
  it('flags the identical patient as likely', () => {
    const [match] = findDuplicates(SAME, [patient()], { now: NOW })
    expect(match?.confidence).toBe('likely')
    expect(match?.reasons).toContain('same-name')
    expect(match?.reasons).toContain('same-age')
  })

  it('flags a name taken down by ear', () => {
    // One vowel wrong across a long name is what a register actually contains.
    const [match] = findDuplicates(
      { ...SAME, familyName: 'Rakotoarisao', givenName: 'Voahirane' },
      [patient()],
      { now: NOW },
    )
    expect(match).toBeDefined()
    expect(match?.reasons).toContain('similar-name')
  })

  it('flags given and family name entered in the wrong columns', () => {
    // The most common register error there is: the form's column order is not
    // the order the name is spoken in.
    const [match] = findDuplicates(
      { givenName: 'Rakotoarisoa', familyName: 'Voahirana', sex: 'female', approximateAge: 34 },
      [patient()],
      { now: NOW },
    )
    expect(match?.confidence).toBe('likely')
    expect(match?.reasons).toContain('swapped-name')
  })

  it('flags the same register number even under a different name', () => {
    // A collision here is either the same person or a clerical error, and both
    // are worth stopping for.
    const matches = findDuplicates(
      { registerNo: '2041', givenName: 'Hery', familyName: 'Razafy' },
      [patient({ registerNo: '2041' })],
      { now: NOW },
    )
    expect(matches).toHaveLength(1)
    expect(matches[0]?.reasons).toContain('same-register-no')
  })

  it('matches a phone written three different ways', () => {
    const written = ['034 12 345 67', '+261 34 12 345 67', '0341234567']
    for (const phone of written) {
      const matches = findDuplicates({ ...SAME, phone }, [patient({ phone: '034 12 345 67' })], {
        now: NOW,
      })
      expect(matches[0]?.reasons, phone).toContain('same-phone')
    }
  })
})

describe('what must not be flagged', () => {
  it('says nothing about a common family name alone', () => {
    // RAKOTO- prefixes an enormous share of Malagasy family names. A warning
    // on every registration is one nobody reads by the second day.
    const matches = findDuplicates(
      { familyName: 'Rakotoarisoa', givenName: 'Naivo', sex: 'male', approximateAge: 6 },
      [patient()],
      { now: NOW },
    )
    expect(matches).toEqual([])
  })

  it('does not flag a grandmother as her granddaughter', () => {
    // Same name, same village, same household phone, sixty years apart. This
    // is the case that makes an age contradiction worth subtracting for.
    const matches = findDuplicates(
      { ...SAME, approximateAge: 4, address: 'Ambohimanga', phone: '0341234567' },
      [patient({ approximateAge: 64, address: 'Ambohimanga', phone: '0341234567' })],
      { now: NOW },
    )
    expect(matches).toEqual([])
  })

  it('does not flag two people of different sex with the same name and age', () => {
    // Same name, same age, opposite sex. Common enough in a family, and the
    // contradiction has to outweigh everything the two records share.
    expect(findDuplicates({ ...SAME, sex: 'male' }, [patient({ sex: 'female' })], { now: NOW })).toEqual([])
  })

  it('says nothing until the form holds enough to be meaningful', () => {
    expect(findDuplicates({}, [patient()], { now: NOW })).toEqual([])
    expect(findDuplicates({ givenName: 'Voahirana' }, [patient()], { now: NOW })).toEqual([])
    expect(findDuplicates({ familyName: 'Rakotoarisoa' }, [patient()], { now: NOW })).toEqual([])
  })

  it('treats a shared phone and a close age as possible, never likely', () => {
    // Two adults of a similar age on one household number, under different
    // names. Worth showing; nowhere near enough to assert they are one person.
    //
    // Asserted as one match rather than with `.every`, which passes vacuously
    // on an empty array — the first version of this test did exactly that and
    // went on passing when every match was forced to 'likely'.
    const matches = findDuplicates(
      { givenName: 'Naivo', familyName: 'Andrianjafy', phone: '0341234567', approximateAge: 33 },
      [patient({ phone: '0341234567' })],
      { now: NOW },
    )
    expect(matches).toHaveLength(1)
    expect(matches[0]?.confidence).toBe('possible')
    expect(matches[0]?.reasons).toContain('same-phone')
  })

  it('never reports a match without a reason to show, whatever the input', () => {
    // The warning is only useful if it says why: a score with no reasons is an
    // accusation the clinician cannot check. Asserted over a spread of inputs
    // rather than one, so it tests the invariant and not a single path.
    const registry = [
      patient(),
      patient({ id: 'p2', sex: 'male', approximateAge: 6, givenName: 'Naivo' }),
      patient({ id: 'p3', phone: '0341234567', registerNo: '2041', address: 'Ambohimanga' }),
    ]
    const candidates: Candidate[] = [
      SAME,
      { ...SAME, sex: 'male' },
      { givenName: 'Naivo', familyName: 'Andrianjafy', approximateAge: 6 },
      { registerNo: '2041' },
      { phone: '0341234567', givenName: 'X', familyName: 'Y' },
      { givenName: 'Rakotoarisoa', familyName: 'Voahirana', approximateAge: 34 },
    ]
    for (const candidate of candidates) {
      for (const match of findDuplicates(candidate, registry, { now: NOW })) {
        expect(match.reasons.length, JSON.stringify(candidate)).toBeGreaterThan(0)
        expect(match.score).toBeGreaterThanOrEqual(0.45)
      }
    }
  })
})

describe('ranking and shape', () => {
  it('puts the strongest match first', () => {
    const weak = patient({ id: 'weak', givenName: 'Voahirana', familyName: 'Rakotoarisoq' })
    const strong = patient({ id: 'strong', phone: '0341234567', address: 'Ambohimanga' })
    const matches = findDuplicates(
      { ...SAME, phone: '0341234567', address: 'Ambohimanga' },
      [weak, strong],
      { now: NOW },
    )
    expect(matches[0]?.patient.id).toBe('strong')
  })

  it('caps how many it shows', () => {
    const many = Array.from({ length: 12 }, (_, i) => patient({ id: `p${i}` }))
    expect(findDuplicates(SAME, many, { now: NOW })).toHaveLength(5)
    expect(findDuplicates(SAME, many, { now: NOW, limit: 2 })).toHaveLength(2)
  })

  it('keeps the score inside its range whatever the inputs', () => {
    const everything = scoreAgainst(
      { ...SAME, phone: '0341234567', registerNo: '2041', address: 'Ambohimanga' },
      patient({ phone: '0341234567', registerNo: '2041', address: 'Ambohimanga' }),
      NOW,
    )
    expect(everything.score).toBeLessThanOrEqual(1)
    expect(everything.score).toBeGreaterThanOrEqual(0)

    const nothing = scoreAgainst(
      { givenName: 'Aaa', familyName: 'Bbb', sex: 'male', approximateAge: 90 },
      patient(),
      NOW,
    )
    expect(nothing.score).toBeGreaterThanOrEqual(0)
  })

  it('handles an empty register', () => {
    expect(findDuplicates(SAME, [], { now: NOW })).toEqual([])
  })
})

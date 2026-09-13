import { describe, expect, it } from 'vitest'
import { allowedEdits, editDistance, fuzzyDrugHits, squash } from './fuzzyDrug'

describe('editDistance', () => {
  it('is zero for equal strings and counts single edits', () => {
    expect(editDistance('paracetamol', 'paracetamol')).toBe(0)
    expect(editDistance('metranidazole', 'metronidazole')).toBe(1)
    expect(editDistance('amoxysilin', 'amoxicillin')).toBe(3)
  })

  it('gives up early past the limit', () => {
    expect(editDistance('paracetamol', 'parasitose', 3)).toBeGreaterThan(3)
  })
})

describe('squash and allowance', () => {
  it('compares letters only', () => {
    expect(squash('artémété Lume et Fantrine')).toBe('artmtlumeetfantrine')
    expect(squash('sels de rehydratation orale')).toBe('selsderehydratationorale')
  })

  it('allows about a third of the length in edits', () => {
    expect(allowedEdits(11)).toBe(4)
    expect(allowedEdits(22)).toBe(8)
  })
})

describe('fuzzyDrugHits', () => {
  const formulary = ['paracetamol', 'amoxicilline', 'artemether lumefantrine', 'quinine', 'fer', 'zinc']
  const always = () => true

  it('finds a phonetic spelling split across words', () => {
    const hits = fuzzyDrugHits('par assez tamol 500 mg', formulary, { hasPrescriptionContext: always })
    expect(hits).toHaveLength(1)
    expect(hits[0]).toMatchObject({ drug: 'paracetamol', start: 0, end: 15 })
  })

  it('refuses without prescription context', () => {
    expect(fuzzyDrugHits('par assez tamol', formulary, { hasPrescriptionContext: () => false })).toEqual([])
  })

  it('refuses a run that is a number', () => {
    const hits = fuzzyDrugHits('pendant quinze jours', formulary, {
      hasPrescriptionContext: always,
      isNumber: (run) => run === 'quinze',
    })
    expect(hits).toEqual([])
  })

  it('never matches short entries fuzzily', () => {
    // "fer" and "zinc" are too short to compare; only exact matching may find them.
    expect(fuzzyDrugHits('fera zing 20 mg', formulary, { hasPrescriptionContext: always })).toEqual([])
  })

  it('skips spans an exact match already claimed', () => {
    const hits = fuzzyDrugHits('paracetamol 500 mg', formulary, {
      hasPrescriptionContext: always,
      taken: [{ start: 0, end: 11 }],
    })
    expect(hits).toEqual([])
  })

  it('keeps the whole combination rather than a fragment of it', () => {
    const hits = fuzzyDrugHits('artemete lume et fantrine matin et soir', formulary, { hasPrescriptionContext: always })
    expect(hits).toHaveLength(1)
    expect(hits[0]!.drug).toBe('artemether lumefantrine')
    expect(hits[0]!.end).toBe('artemete lume et fantrine'.length)
  })
})

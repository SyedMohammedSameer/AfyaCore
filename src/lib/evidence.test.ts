import { describe, expect, it } from 'vitest'
import { compareEvidence, evidenceCases, evidenceSummary, wordErrorRate } from './evidence'
import { extractClinical } from './clinicalExtract'
import { CLINICAL_LOCALES } from './clinicalLocales'

describe('Evidence Studio scoring', () => {
  it('counts every expected attribute when a whole prescription is omitted', () => {
    const rows = compareEvidence({ prescriptions: [{ drug: 'paracetamol', dose: '500 mg', frequencyPerDay: 3, durationDays: 5 }] }, extractClinical(''))
    expect(evidenceSummary(rows)).toMatchObject({ total: 4, missing: 4, agreement: 0 })
  })
  it('exposes wrong values and unexpected values rather than rewarding field presence', () => {
    const result = extractClinical('Temperature 39. Pulse 90.', CLINICAL_LOCALES.en)
    const rows = compareEvidence({ vitals: { temperature: 38.5 } }, result)
    expect(evidenceSummary(rows)).toMatchObject({ matched: 0, wrong: 1, extra: 1, agreement: 0 })
    expect(rows[0]?.source).toContain('39')
  })
  it('reports no positive accuracy evidence for empty reference and output', () => {
    expect(evidenceSummary(compareEvidence({}, extractClinical(''))).agreement).toBeNull()
  })
  it('keeps original errors distinct from a corrected transcript', () => {
    const expected = { vitals: { temperature: 38.5 } }
    const original = compareEvidence(expected, extractClinical('Temperature 385.', CLINICAL_LOCALES.en))
    const corrected = compareEvidence(expected, extractClinical('Temperature 38.5.', CLINICAL_LOCALES.en))
    expect(evidenceSummary(original).missing).toBe(1)
    expect(evidenceSummary(corrected).matched).toBe(1)
    expect(evidenceSummary(original).matched).toBe(0)
  })
  it('does not silently make raw WER number-aware, or cap it at 100%', () => {
    expect(wordErrorRate('five', '5').wer).toBe(1)
    expect(wordErrorRate('one', 'two three four').wer).toBe(3)
  })
  for (const locale of ['fr', 'en'] as const) {
    it(`matches explicit reference annotations for the ${locale} audio case`, () => {
      const testCase = evidenceCases[locale][0]!
      expect(evidenceSummary(compareEvidence(testCase.expect, extractClinical(testCase.text, CLINICAL_LOCALES[locale]))).agreement).toBe(1)
    })
  }
})

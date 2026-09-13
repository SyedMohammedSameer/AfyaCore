/**
 * The uncertainty flag has to be able to fire on the fields that get things
 * wrong.
 *
 * Named after the failure, like the other regression suites here. The flag was
 * `confidence < 0.8` and `narrative()` gave every chief complaint and
 * diagnosis a confidence of exactly 0.8, so the two fields a speech recogniser
 * mangles most could not be flagged by construction. Nothing failed: the app
 * looked confident, the review screen sorted the wrong rows to the bottom, and
 * on the spoken corpus a clinician reading only the flagged rows would have
 * reached one wrong value in five.
 *
 * These pin the boundary rather than the constant. A future change to either
 * the threshold or a rule's confidence that puts a narrative field back on the
 * safe side of the line fails here, which is the thing that went unnoticed.
 *
 * `npm run eval:asr` reports what the flag actually catches; this is only the
 * structural half.
 */
import { describe, expect, it } from 'vitest'
import { extractClinical } from './clinicalExtract'
import { EN_LOCALE, FR_LOCALE } from './clinicalLocales'
import { UNCERTAIN_BELOW } from '../db/schema'

/** True when the review screen would label this value "Check this". */
const flagged = (confidence: number | undefined) => (confidence ?? 1) < UNCERTAIN_BELOW

describe('what the flag must reach', () => {
  it('flags a diagnosis and a chief complaint, which it never could before', () => {
    const r = extractClinical(
      'Motif fièvre depuis trois jours. Diagnostic paludisme simple.',
      FR_LOCALE,
    )
    expect(r.diagnosis?.value).toBe('paludisme simple')
    expect(flagged(r.diagnosis?.confidence)).toBe(true)
    expect(flagged(r.chiefComplaint?.confidence)).toBe(true)
  })

  it('flags a blood pressure the extractor converted from cmHg, which is an inference', () => {
    const r = extractClinical('tension douze sur huit', FR_LOCALE)
    expect(r.vitals.systolic?.value).toBe(120)
    expect(flagged(r.vitals.systolic?.confidence)).toBe(true)
  })

  it('flags a vital heard as words rather than read as digits', () => {
    const spoken = extractClinical('température trente-huit virgule cinq', FR_LOCALE)
    expect(flagged(spoken.vitals.temperature?.confidence)).toBe(true)
  })

  it('flags a drug name recovered from a misspelling', () => {
    const r = extractClinical('paraissait à mol 500 mg trois fois par jour', FR_LOCALE)
    expect(r.prescriptions[0]?.recovered).toBe(true)
    expect(flagged(r.prescriptions[0]?.confidence)).toBe(true)
  })
})

describe('what the flag must leave alone', () => {
  it('does not flag a vital transcribed as digits', () => {
    const r = extractClinical('Temperature 38.5, pulse 92', EN_LOCALE)
    expect(r.vitals.temperature?.value).toBe(38.5)
    expect(flagged(r.vitals.temperature?.confidence)).toBe(false)
    expect(flagged(r.vitals.pulse?.confidence)).toBe(false)
  })

  it('does not flag a prescription with a complete dose, frequency and duration', () => {
    const r = extractClinical('Paracetamol 500 mg tds for 5/7', EN_LOCALE)
    expect(r.prescriptions[0]).toMatchObject({ dose: '500 mg', frequencyPerDay: 3, durationDays: 5 })
    expect(flagged(r.prescriptions[0]?.confidence)).toBe(false)
  })

  it('leaves something on each side of the line, or the flag carries no information', () => {
    const r = extractClinical(
      'Presenting complaint fever. Temperature 38.5, pulse 92. Diagnosis malaria. Paracetamol 500 mg tds for 5/7.',
      EN_LOCALE,
    )
    const confidences = [
      r.vitals.temperature?.confidence,
      r.vitals.pulse?.confidence,
      r.diagnosis?.confidence,
      r.chiefComplaint?.confidence,
      r.prescriptions[0]?.confidence,
    ]
    expect(confidences.some(flagged)).toBe(true)
    expect(confidences.some((c) => !flagged(c))).toBe(true)
  })
})

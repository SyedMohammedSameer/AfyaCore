import type { ExtractionResult } from './clinicalExtract'
import { UNCERTAIN_BELOW } from '../db/schema'
import { normalise, wordErrorRate, type ExpectedExtraction } from '../../eval/score.mjs'
import fr from '../../eval/corpus/extraction.fr.json'
import en from '../../eval/corpus/extraction.en.json'

export { wordErrorRate }
export type EvidenceLocale = 'fr' | 'en'
export type EvidenceValue = string | number
export interface EvidenceCase {
  id: string
  text: string
  expect: ExpectedExtraction
  notes: string
}

export const evidenceCases: Record<EvidenceLocale, EvidenceCase[]> = { fr: fr.cases, en: en.cases }
export const sampleUrl = (locale: EvidenceLocale) => `/samples/studio-${locale}.wav`

function expectedFacts(expected: ExpectedExtraction): Record<string, EvidenceValue> {
  const facts: Record<string, EvidenceValue> = {}
  for (const [key, value] of Object.entries(expected.vitals ?? {})) facts[`vitals.${key}`] = value
  if (expected.chiefComplaint !== undefined) facts.chiefComplaint = expected.chiefComplaint
  if (expected.diagnosis !== undefined) facts.diagnosis = expected.diagnosis
  for (const [i, rx] of (expected.prescriptions ?? []).entries()) {
    for (const key of ['drug', 'dose', 'frequencyPerDay', 'durationDays'] as const) {
      if (rx[key] !== undefined) facts[`rx.${i}.${key}`] = rx[key]
    }
  }
  return facts
}

export type EvidenceStatus = 'match' | 'wrong' | 'missing' | 'extra'
export interface EvidenceRow {
  key: string
  expected?: EvidenceValue
  actual?: EvidenceValue
  source?: string
  status: EvidenceStatus
  /** The extractor's rule-match strength for the value it produced. */
  confidence?: number
  /**
   * Whether the app would label this value "Check this" and sort it to the top
   * of the review checklist.
   *
   * Shown beside the verdict so the two can be read against each other. It is
   * the honest way to present a flag whose calibration is itself a finding: a
   * reviewer can see for themselves, on the run in front of them, whether the
   * rows the app was unsure about are the rows it got wrong. See
   * UNCERTAIN_BELOW in db/schema.ts and `npm run eval:asr`.
   */
  flagged: boolean
}

/** Explicit atomic fields, including every attribute of a missing prescription.
 * No assertion is made about narrative completeness or clinical correctness.
 */
export function compareEvidence(expected: ExpectedExtraction, actual: ExtractionResult): EvidenceRow[] {
  const wants = expectedFacts(expected)
  const got = expectedFacts({
    vitals: Object.fromEntries(Object.entries(actual.vitals).map(([key, field]) => [key, field.value])),
    chiefComplaint: actual.chiefComplaint?.value,
    diagnosis: actual.diagnosis?.value,
    prescriptions: actual.prescriptions,
  })
  return [...new Set([...Object.keys(wants), ...Object.keys(got)])].map((key) => {
    const want = wants[key]
    const value = got[key]
    const matches = typeof want === 'number'
      ? typeof value === 'number' && Math.abs(want - value) < 1e-6
      : value !== undefined && normalise(want) === normalise(value)
    const field = key.startsWith('vitals.')
      ? actual.vitals[key.slice(7) as keyof typeof actual.vitals]
      : key.startsWith('rx.') ? actual.prescriptions[Number(key.split('.')[1])]
        : key === 'diagnosis' ? actual.diagnosis : actual.chiefComplaint
    const status: EvidenceStatus =
      want === undefined ? 'extra' : value === undefined ? 'missing' : matches ? 'match' : 'wrong'
    return {
      key, expected: want, actual: value, source: field?.rawText,
      confidence: field?.confidence,
      // A field the extractor never produced has no row in the app and so no
      // flag; saying it was "not flagged" would count a recall failure against
      // a control that was never asked about it.
      flagged: status !== 'missing' && (field?.confidence ?? 1) < UNCERTAIN_BELOW,
      status,
    }
  })
}

export function evidenceSummary(rows: EvidenceRow[]) {
  const count = (status: EvidenceStatus) => rows.filter((r) => r.status === status).length
  const matched = count('match')
  return {
    matched, total: rows.length, wrong: count('wrong'), missing: count('missing'), extra: count('extra'),
    // An empty reference and output give no evidence of positive extraction.
    agreement: rows.length ? matched / rows.length : null,
  }
}

import type { ExtractionResult } from '../src/lib/clinicalExtract'
import type { Vitals } from '../src/db/schema'
export interface ExpectedExtraction {
  vitals?: Vitals
  chiefComplaint?: string
  diagnosis?: string
  prescriptions?: { drug: string; dose?: string; frequencyPerDay?: number; durationDays?: number }[]
}
export function normalise(value: unknown): string
export function scoreExtraction(expected: ExpectedExtraction, actual: ExtractionResult): {
  tp: number; fp: number; fn: number; misses: string[]
}
export function prf(tp: number, fp: number, fn: number): {
  tp: number; fp: number; fn: number; precision: number; recall: number; f1: number
}
export function wordErrorRate(reference: string, hypothesis: string): { errors: number; words: number; wer: number }
export interface ReviewUnit {
  key: string
  confidence?: number
  correct: boolean
  got?: unknown
  want?: unknown
}
export function reviewUnits(expected: ExpectedExtraction, actual: ExtractionResult): ReviewUnit[]
export function flagAnalysis(units: ReviewUnit[], threshold: number): {
  threshold: number
  units: number
  wrong: number
  flagged: number
  unflagged: number
  errorRateFlagged: number | null
  errorRateUnflagged: number | null
  catchRate: number | null
  burden: number | null
  unflaggedErrors: string[]
}
export function confidenceBuckets(units: ReviewUnit[]): {
  confidence: number
  total: number
  wrong: number
  errorRate: number
}[]

/**
 * WHO z-scores, and what they mean.
 *
 * ## Why this is here
 *
 * Weight and height are already recorded at every consultation. On their own
 * they say almost nothing: 8 kg is unremarkable at one year and an emergency
 * at three. A z-score is what turns two numbers a clinician already wrote down
 * into a referral decision, and it is the most-used clinical decision aid at
 * this level of care anywhere in the world.
 *
 * ## The arithmetic
 *
 * WHO publishes each standard as LMS coefficients — a Box-Cox power, a median
 * and a coefficient of variation, per day of age or per centimetre of length.
 * A measurement becomes a z-score by
 *
 *     z = ((X / M)^L - 1) / (L * S)        for L != 0
 *     z = ln(X / M) / S                    for L = 0
 *
 * and beyond three standard deviations WHO replaces the tail of the
 * distribution with a linear extrapolation, because the Box-Cox curve fits
 * badly out there and a severely wasted child would otherwise be assigned a
 * z-score of implausible magnitude. That adjustment applies to the
 * weight-based indicators only; height-for-age is left alone, since a very
 * short child is still on the curve.
 *
 * ## What this file will not do
 *
 * Interpolate beyond the tables. WHO's standards cover 0 to 5 years and a
 * bounded range of lengths, and outside that there is no answer to give — the
 * 5-19 growth *reference* is a different set of curves this does not carry.
 * `zScore` returns null rather than extending a curve past where WHO fitted
 * it, because a plausible-looking number is worse than a blank here.
 */
import type { Sex } from '../db/schema'
import type { GrowthIndicator, GrowthStandard, LmsTable } from '../data/whoGrowth'

export type { GrowthIndicator }

/** The three indicators a health post acts on. */
export const INDICATORS = {
  weightForAge: 'underweight',
  lengthForAge: 'stunting',
  weightForLength: 'wasting',
  weightForHeight: 'wasting',
} as const

/**
 * WHO's cut-offs, and the words that go with them.
 *
 * `severe` is a referral in every national protocol built on these standards.
 * `moderate` is a follow-up. `watch` has no WHO status and is deliberately
 * named as an observation rather than a finding.
 */
export type GrowthFlag = 'severe-low' | 'moderate-low' | 'watch-low' | 'normal' | 'high'

export function classify(z: number): GrowthFlag {
  if (z < -3) return 'severe-low'
  if (z < -2) return 'moderate-low'
  if (z < -1) return 'watch-low'
  if (z > 2) return 'high'
  return 'normal'
}

/** Oldest age WHO's child standards cover, in days. */
export const MAX_AGE_DAYS = 1826

/**
 * The LMS triplet at a point, interpolated between table rows.
 *
 * The -for-age tables are per day, so a whole-day lookup is exact. The
 * weight-for-length tables step every 0.1 cm and a real measurement lands
 * between two rows, so those are interpolated linearly — which is what WHO's
 * own software does rather than rounding a child to the nearest centimetre.
 *
 * Returns null outside the table. Extrapolating an LMS curve past its fitted
 * range produces numbers that look like z-scores and are not.
 */
export function lookupLms(
  table: LmsTable,
  at: number,
): { l: number; m: number; s: number } | null {
  const { x } = table
  if (!Number.isFinite(at) || x.length === 0) return null
  if (at < x[0]! || at > x[x.length - 1]!) return null

  // Binary search for the row at or before `at`.
  let low = 0
  let high = x.length - 1
  while (low < high) {
    const mid = Math.ceil((low + high) / 2)
    if (x[mid]! <= at) low = mid
    else high = mid - 1
  }

  const l0 = table.l[low]!
  const m0 = table.m[low]!
  const s0 = table.s[low]!
  if (x[low] === at || low === x.length - 1) return { l: l0, m: m0, s: s0 }

  const span = x[low + 1]! - x[low]!
  const t = span === 0 ? 0 : (at - x[low]!) / span
  return {
    l: l0 + t * (table.l[low + 1]! - l0),
    m: m0 + t * (table.m[low + 1]! - m0),
    s: s0 + t * (table.s[low + 1]! - s0),
  }
}

/** The measurement that sits exactly `n` standard deviations from the median. */
export function valueAtZ(lms: { l: number; m: number; s: number }, z: number): number {
  const { l, m, s } = lms
  return l === 0 ? m * Math.exp(s * z) : m * Math.pow(1 + l * s * z, 1 / l)
}

export interface ZScoreOptions {
  /**
   * Whether to apply WHO's linear extrapolation beyond |z| = 3.
   *
   * On for the weight-based indicators, off for height-for-age. Defaults to
   * the right answer per indicator in `zScoreFor`; exposed here so the raw
   * maths can be tested on its own.
   */
  adjustTails?: boolean
}

/**
 * A measurement's z-score against one LMS triplet.
 *
 * Separate from the table lookup so the arithmetic can be checked against
 * values whose answer is known exactly — a child on the median scores zero
 * whatever the coefficients, and one at `valueAtZ(lms, 2)` scores two.
 */
export function zScore(
  value: number,
  lms: { l: number; m: number; s: number },
  options: ZScoreOptions = {},
): number | null {
  if (!Number.isFinite(value) || value <= 0) return null
  const { l, m, s } = lms
  const raw = l === 0 ? Math.log(value / m) / s : (Math.pow(value / m, l) - 1) / (l * s)
  if (!Number.isFinite(raw)) return null
  if (options.adjustTails === false) return raw

  /*
   * WHO's tail adjustment.
   *
   * Past three SDs the fitted Box-Cox curve stops describing real children,
   * and a severely wasted one would be given a z-score of -8 or worse. WHO
   * replaces the tail with a straight line whose unit is the width of the
   * third SD band, so the number stays interpretable and the cut-offs keep
   * meaning what the protocols say they mean.
   */
  if (raw > 3) {
    const sd3 = valueAtZ(lms, 3)
    const sd2 = valueAtZ(lms, 2)
    return 3 + (value - sd3) / (sd3 - sd2)
  }
  if (raw < -3) {
    const sd3 = valueAtZ(lms, -3)
    const sd2 = valueAtZ(lms, -2)
    return -3 + (value - sd3) / (sd2 - sd3)
  }
  return raw
}

export interface Measurement {
  sex: Sex
  /** Days since birth. */
  ageDays?: number
  weightKg?: number
  /** Length lying down under 2 years, height standing over. */
  heightCm?: number
}

export interface GrowthResult {
  indicator: GrowthIndicator
  z: number
  flag: GrowthFlag
}

/** Height-for-age is the one indicator WHO does not clip. */
const CLIPPED: Record<GrowthIndicator, boolean> = {
  weightForAge: true,
  lengthForAge: false,
  weightForLength: true,
  weightForHeight: true,
}

/**
 * Every z-score the measurements support.
 *
 * Silently omits an indicator whose inputs are missing or out of range rather
 * than guessing: a child with no recorded height simply has no wasting score,
 * and saying so by absence is the honest form.
 *
 * `standards` is injected so the 247 kB of tables can be loaded on demand by
 * the screen that draws the chart, and so tests can use a fixture.
 */
export function assess(
  measurement: Measurement,
  standards: Record<GrowthIndicator, GrowthStandard>,
): GrowthResult[] {
  const { sex, ageDays, weightKg, heightCm } = measurement
  if (sex !== 'male' && sex !== 'female') return []

  const results: GrowthResult[] = []
  const add = (indicator: GrowthIndicator, value: number | undefined, at: number | undefined) => {
    if (value === undefined || at === undefined) return
    const table = standards[indicator]?.[sex]
    if (!table) return
    const lms = lookupLms(table, at)
    if (!lms) return
    const z = zScore(value, lms, { adjustTails: CLIPPED[indicator] })
    if (z === null) return
    results.push({ indicator, z, flag: classify(z) })
  }

  const inRange = ageDays !== undefined && ageDays >= 0 && ageDays <= MAX_AGE_DAYS
  add('weightForAge', weightKg, inRange ? ageDays : undefined)
  add('lengthForAge', heightCm, inRange ? ageDays : undefined)

  /*
   * Which wasting table applies is a question about how the child was
   * measured, not about the number.
   *
   * WHO measures children under two lying down and over two standing, and
   * publishes a separate table for each because the two differ by about
   * 0.7 cm in the same child. Following age is what WHO's own software does
   * when the position was not recorded, which in a health post is always.
   */
  if (inRange && weightKg !== undefined && heightCm !== undefined) {
    add(ageDays! < 730 ? 'weightForLength' : 'weightForHeight', weightKg, heightCm)
  }

  return results
}

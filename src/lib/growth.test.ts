/**
 * Growth standards are a clinical decision aid: a child is referred for severe
 * acute malnutrition on the strength of a z-score. So these tests check the
 * arithmetic against answers that are exact by construction — a child on the
 * median scores zero whatever the coefficients, one at the two-SD value scores
 * two — and check the shipped tables against medians WHO published.
 */
import { describe, expect, it } from 'vitest'
import {
  assess,
  classify,
  lookupLms,
  MAX_AGE_DAYS,
  valueAtZ,
  zScore,
  type GrowthIndicator,
} from './growth'
import { WHO_GROWTH } from '../data/whoGrowth'
import type { GrowthStandard } from '../data/whoGrowth'

const STANDARDS = WHO_GROWTH as unknown as Record<GrowthIndicator, GrowthStandard>

describe('the shipped tables are WHO’s', () => {
  it('carries both sexes across the full nought-to-five range', () => {
    for (const key of ['weightForAge', 'lengthForAge'] as const) {
      for (const sex of ['male', 'female'] as const) {
        const table = STANDARDS[key][sex]
        expect(table.x[0], `${key} ${sex}`).toBe(0)
        expect(table.x[table.x.length - 1], `${key} ${sex}`).toBe(MAX_AGE_DAYS)
        expect(table.x).toHaveLength(1827)
        expect(table.l).toHaveLength(1827)
      }
    }
  })

  it('matches medians WHO published', () => {
    // The same figures the vendoring script refuses to write without. Repeated
    // here so a hand edit to the generated file fails the suite rather than
    // shipping.
    const checks: [GrowthIndicator, 'male' | 'female', number, number][] = [
      ['weightForAge', 'male', 0, 3.3464],
      ['weightForAge', 'female', 0, 3.2322],
      ['weightForAge', 'male', 365, 9.646],
      ['weightForAge', 'female', 365, 8.9462],
      ['lengthForAge', 'male', 0, 49.8842],
      ['lengthForAge', 'female', 0, 49.1477],
    ]
    for (const [key, sex, x, median] of checks) {
      const table = STANDARDS[key][sex]
      expect(table.m[table.x.indexOf(x)], `${key} ${sex} at ${x}`).toBeCloseTo(median, 4)
    }
  })

  it('rises monotonically in age and stays positive', () => {
    // A transposed or truncated table would still parse; a median weight that
    // goes down over the first five years would not.
    for (const sex of ['male', 'female'] as const) {
      const { x, m } = STANDARDS.weightForAge[sex]
      for (let i = 1; i < x.length; i++) {
        expect(x[i]!, `${sex} age order`).toBeGreaterThan(x[i - 1]!)
        expect(m[i]!, `${sex} median at ${x[i]}`).toBeGreaterThan(0)
      }
      expect(m[m.length - 1]!).toBeGreaterThan(m[0]! * 4)
    }
  })
})

describe('zScore', () => {
  // Deliberately not WHO's numbers: the arithmetic is being checked, and these
  // answers are exact for any coefficients.
  const lms = { l: 0.3487, m: 3.3464, s: 0.14602 }
  const logNormal = { l: 0, m: 10, s: 0.1 }

  it('scores a child on the median at zero', () => {
    expect(zScore(lms.m, lms)!).toBeCloseTo(0, 12)
    expect(zScore(logNormal.m, logNormal)!).toBeCloseTo(0, 12)
  })

  it('inverts valueAtZ, which is the definition of both', () => {
    for (const z of [-2.5, -2, -1, -0.5, 0, 0.5, 1, 2, 2.5]) {
      expect(zScore(valueAtZ(lms, z), lms, { adjustTails: false })!, `z=${z}`).toBeCloseTo(z, 10)
      expect(zScore(valueAtZ(logNormal, z), logNormal)!, `log z=${z}`).toBeCloseTo(z, 10)
    }
  })

  it('handles the L = 0 branch rather than dividing by zero', () => {
    expect(zScore(logNormal.m * Math.E ** 0.1, logNormal)!).toBeCloseTo(1, 10)
  })

  it('rejects impossible measurements instead of returning NaN', () => {
    expect(zScore(0, lms)).toBeNull()
    expect(zScore(-5, lms)).toBeNull()
    expect(zScore(Number.NaN, lms)).toBeNull()
  })
})

describe('WHO’s tail adjustment', () => {
  const lms = { l: 0.3487, m: 3.3464, s: 0.14602 }

  it('leaves everything inside three SDs untouched', () => {
    for (const z of [-3, -2, 0, 2, 3]) {
      const value = valueAtZ(lms, z)
      expect(zScore(value, lms)!, `z=${z}`).toBeCloseTo(
        zScore(value, lms, { adjustTails: false })!,
        9,
      )
    }
  })

  it('measures the far tail in third-band widths', () => {
    // A child exactly one band below the third SD scores -4 by construction,
    // where the unclipped curve would give a much larger magnitude.
    const sd3 = valueAtZ(lms, -3)
    const sd2 = valueAtZ(lms, -2)
    const oneBandLower = sd3 - (sd2 - sd3)
    expect(zScore(oneBandLower, lms)!).toBeCloseTo(-4, 9)

    const raw = zScore(oneBandLower, lms, { adjustTails: false })!
    expect(raw).toBeLessThan(-4)
  })

  it('does the same above the median', () => {
    const sd3 = valueAtZ(lms, 3)
    const sd2 = valueAtZ(lms, 2)
    expect(zScore(sd3 + (sd3 - sd2), lms)!).toBeCloseTo(4, 9)
  })
})

describe('lookupLms', () => {
  const table = { x: [0, 10, 20], l: [1, 2, 3], m: [10, 20, 30], s: [0.1, 0.2, 0.3] }

  it('is exact on a row', () => {
    expect(lookupLms(table, 10)).toEqual({ l: 2, m: 20, s: 0.2 })
  })

  it('interpolates between rows', () => {
    // Weight-for-length steps every 0.1 cm and a real child lands between two
    // rows; rounding them to the nearest row would quantise the z-score.
    expect(lookupLms(table, 15)).toEqual({ l: 2.5, m: 25, s: 0.25 })
  })

  it('refuses to extrapolate past the fitted range', () => {
    // Outside WHO's tables there is no answer. A plausible-looking number is
    // worse than a blank: this is what a referral is read off.
    expect(lookupLms(table, -1)).toBeNull()
    expect(lookupLms(table, 21)).toBeNull()
    expect(lookupLms(table, Number.NaN)).toBeNull()
  })

  it('handles both ends exactly', () => {
    expect(lookupLms(table, 0)).toEqual({ l: 1, m: 10, s: 0.1 })
    expect(lookupLms(table, 20)).toEqual({ l: 3, m: 30, s: 0.3 })
  })
})

describe('classify', () => {
  it('places the WHO cut-offs where the protocols expect them', () => {
    expect(classify(-3.01)).toBe('severe-low')
    expect(classify(-3)).toBe('moderate-low')
    expect(classify(-2.01)).toBe('moderate-low')
    expect(classify(-2)).toBe('watch-low')
    expect(classify(-1)).toBe('normal')
    expect(classify(0)).toBe('normal')
    expect(classify(2)).toBe('normal')
    expect(classify(2.01)).toBe('high')
  })
})

describe('assess', () => {
  const oneYearOldBoy = { sex: 'male' as const, ageDays: 365, weightKg: 9.646, heightCm: 75.7 }

  it('scores a median child at zero on every indicator', () => {
    const results = assess(oneYearOldBoy, STANDARDS)
    expect(results.map((r) => r.indicator)).toContain('weightForAge')
    expect(results.find((r) => r.indicator === 'weightForAge')!.z).toBeCloseTo(0, 3)
    for (const result of results) expect(result.flag).toBe('normal')
  })

  it('flags a severely wasted child', () => {
    // Same age and height, well under the weight for it.
    const results = assess({ ...oneYearOldBoy, weightKg: 6.2 }, STANDARDS)
    const wasting = results.find((r) => r.indicator === 'weightForLength')
    expect(wasting).toBeDefined()
    expect(wasting!.z).toBeLessThan(-3)
    expect(wasting!.flag).toBe('severe-low')
  })

  it('flags a stunted child on height and not on weight-for-height', () => {
    // Short for their age but proportionate: stunting without wasting, which
    // is the distinction the two indicators exist to make.
    const results = assess({ sex: 'male', ageDays: 365, weightKg: 7.6, heightCm: 68 }, STANDARDS)
    expect(results.find((r) => r.indicator === 'lengthForAge')!.flag).toBe('severe-low')
    expect(results.find((r) => r.indicator === 'weightForLength')!.flag).toBe('normal')
  })

  it('uses length under two years and height over', () => {
    const infant = assess({ sex: 'male', ageDays: 700, weightKg: 11, heightCm: 82 }, STANDARDS)
    expect(infant.map((r) => r.indicator)).toContain('weightForLength')

    const toddler = assess({ sex: 'male', ageDays: 800, weightKg: 11, heightCm: 82 }, STANDARDS)
    expect(toddler.map((r) => r.indicator)).toContain('weightForHeight')
  })

  it('omits what it cannot compute rather than guessing', () => {
    expect(assess({ sex: 'male', ageDays: 365 }, STANDARDS).map((r) => r.indicator)).toEqual([])
    expect(assess({ sex: 'male', weightKg: 9 }, STANDARDS).map((r) => r.indicator)).toEqual([])

    // Past five years WHO's child standards stop. The 5-19 reference is a
    // different set of curves this does not carry, so there is no answer.
    expect(assess({ sex: 'male', ageDays: 2200, weightKg: 20, heightCm: 110 }, STANDARDS)).toEqual([])

    // Sex is required and 'unknown' is a real value in this schema.
    expect(assess({ sex: 'unknown', ageDays: 365, weightKg: 9.6 }, STANDARDS)).toEqual([])
  })

  it('still scores weight-for-age when height is missing', () => {
    // The common case in a health post: a scale but no height board.
    //
    // The thresholds are where WHO put them, not where they feel like they
    // should be: a one-year-old girl at 6.5 kg is moderately underweight, and
    // the third SD for her age is 6.27 kg. This test asserted 'severe' at 6.5
    // on intuition and the arithmetic was right.
    const moderate = assess({ sex: 'female', ageDays: 365, weightKg: 6.5 }, STANDARDS)
    expect(moderate.map((r) => r.indicator)).toEqual(['weightForAge'])
    expect(moderate[0]!.flag).toBe('moderate-low')

    const severe = assess({ sex: 'female', ageDays: 365, weightKg: 6.0 }, STANDARDS)
    expect(severe[0]!.flag).toBe('severe-low')
    expect(severe[0]!.z).toBeLessThan(-3)
  })
})

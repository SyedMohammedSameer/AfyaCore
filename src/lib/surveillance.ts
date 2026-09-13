/**
 * Facility-level counts over time, and a simple excess signal.
 *
 * A health post reports monthly aggregates upward and hears back rarely. The
 * people best placed to notice a malaria week are the ones recording it, and
 * they already hold every number this needs, on the phone, offline. So the
 * home screen shows the last two weeks of confirmed consultations and, for
 * each reporting indicator, whether this week stands out against the four
 * before it.
 *
 * ## What the signal is, and is not
 *
 * The rule is the plainest aberration test in routine surveillance: this
 * week's count is compared with the mean and standard deviation of the
 * previous four weeks, and marked when it exceeds the mean by more than two
 * standard deviations. A floor on the deviation keeps a baseline of zeros
 * from marking a single case as an outbreak; a minimum count keeps one or two
 * cases from marking anything at all.
 *
 * It is a prompt to look, not an alert, and the interface says so in those
 * words. It does not know about season, catchment or a campaign that brought
 * more people through the door. It never changes a record and it never sends
 * anything anywhere. A district epidemiologist has better tools; a nurse at
 * a health post with no epidemiologist has this.
 *
 * Everything here is a pure function over encounters so it can be tested with
 * arithmetic and read without a browser.
 */
import type { Encounter } from '../db/schema'
import { classifyDiagnosis, INDICATORS, type IndicatorKey } from './dhis2'

export const DAY = 86_400_000
export const WEEK = 7 * DAY

/** Midnight at the start of the local day containing `at`. */
export function startOfDay(at: number): number {
  const d = new Date(at)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** Confirmed, live encounters only. Drafts are not yet records; tombstones never were. */
function counted(encounters: Encounter[]): Encounter[] {
  return encounters.filter((e) => e.status === 'final' && e.deletedAt === undefined)
}

export interface DailyCount {
  /** Midnight, local time. */
  day: number
  count: number
}

/**
 * Confirmed consultations per day for the last `days` days, today included,
 * oldest first. Days with nothing are present with a zero so a chart has a
 * bar per day rather than a gap it cannot explain.
 */
export function dailyCounts(encounters: Encounter[], days = 14, now = Date.now()): DailyCount[] {
  const today = startOfDay(now)
  const first = today - (days - 1) * DAY
  const buckets = new Map<number, number>()
  for (let i = 0; i < days; i++) buckets.set(first + i * DAY, 0)
  for (const e of counted(encounters)) {
    const day = startOfDay(e.occurredAt)
    if (day < first || day > today) continue
    buckets.set(day, (buckets.get(day) ?? 0) + 1)
  }
  return [...buckets.entries()].map(([day, count]) => ({ day, count }))
}

export interface IndicatorSignal {
  indicator: IndicatorKey
  /** Confirmed consultations classified under this indicator in the last 7 days. */
  thisWeek: number
  /** The same for each of the four weeks before, most recent first. */
  baseline: number[]
  baselineMean: number
  /** Threshold this week had to exceed to be marked. */
  threshold: number
  /** True when this week exceeds the threshold. A prompt to look, not an alert. */
  excess: boolean
}

export interface SignalOptions {
  /** Weeks of history behind this one. Four is the shortest a mean and deviation are worth. */
  baselineWeeks?: number
  /** How many deviations above the mean count as excess. */
  sigma?: number
  /** Smallest deviation used, so a flat baseline of zeros cannot mark one case. */
  minSigma?: number
  /** Below this many cases this week, nothing is ever marked. */
  minCount?: number
}

const DEFAULTS: Required<SignalOptions> = {
  baselineWeeks: 4,
  sigma: 2,
  minSigma: 1,
  minCount: 3,
}

/**
 * Weekly indicator counts, with the excess rule applied to the current week.
 *
 * Weeks are rolling seven-day windows ending now, not calendar weeks, so the
 * answer on a Tuesday is about the last seven days rather than about two days
 * of a week that has barely started. `other` is left out: a rise in "things
 * the keyword table does not name" is not a signal anyone can act on.
 */
export function indicatorSignals(
  encounters: Encounter[],
  now = Date.now(),
  options: SignalOptions = {},
): IndicatorSignal[] {
  const { baselineWeeks, sigma, minSigma, minCount } = { ...DEFAULTS, ...options }
  const weeks = baselineWeeks + 1
  const start = now - weeks * WEEK

  const perIndicator = new Map<IndicatorKey, number[]>()
  for (const { key } of INDICATORS) {
    if (key !== 'other') perIndicator.set(key, new Array<number>(weeks).fill(0))
  }

  for (const e of counted(encounters)) {
    if (e.occurredAt <= start || e.occurredAt > now) continue
    const key = classifyDiagnosis(e.diagnosis)
    const series = perIndicator.get(key)
    if (!series) continue
    // 0 is the current week, 1 the week before, and so on.
    const index = Math.min(weeks - 1, Math.floor((now - e.occurredAt) / WEEK))
    series[index]!++
  }

  return [...perIndicator.entries()].map(([indicator, series]) => {
    const [thisWeek = 0, ...baseline] = series
    const mean = baseline.reduce((a, b) => a + b, 0) / baseline.length
    const variance = baseline.reduce((a, b) => a + (b - mean) ** 2, 0) / baseline.length
    const deviation = Math.max(minSigma, Math.sqrt(variance))
    const threshold = mean + sigma * deviation
    return {
      indicator,
      thisWeek,
      baseline,
      baselineMean: Number(mean.toFixed(2)),
      threshold: Number(threshold.toFixed(2)),
      excess: thisWeek >= minCount && thisWeek > threshold,
    }
  })
}

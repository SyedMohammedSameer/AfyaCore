import { useEffect, useMemo, useState } from 'react'
import { Activity } from 'lucide-react'
import { Card, SectionTitle, cx } from './ui'
import { GrowthChart, type GrowthPoint } from './GrowthChart'
import { useI18n } from '../i18n'
import {
  assess,
  MAX_AGE_DAYS,
  type GrowthFlag,
  type GrowthIndicator,
  type GrowthResult,
} from '../lib/growth'
import type { GrowthStandard } from '../data/whoGrowth'
import type { Encounter, Patient } from '../db/schema'

/**
 * Growth, for a child young enough for WHO to have a standard.
 *
 * ## Why the tables load late
 *
 * They are 247 kB. Most consultations are not paediatric, and the whole
 * premise of this app is a shell that opens over 2G, so the import happens
 * when a chart is actually going to be drawn and the service worker keeps it
 * afterwards. Until it resolves the panel shows nothing rather than a spinner:
 * a skeleton for a section that may turn out to be empty is worse than the
 * section arriving a moment late.
 *
 * ## Why it renders nothing outside the standards
 *
 * WHO's child standards stop at five years. The 5-19 growth *reference* is a
 * different set of curves this app does not carry, so for an older child there
 * is no chart to draw and no z-score to quote. It says nothing rather than
 * something approximate.
 */
const FLAG_TONE: Record<GrowthFlag, string> = {
  'severe-low': 'bg-danger-50 text-danger-700 ring-danger-200',
  'moderate-low': 'bg-warn-50 text-warn-700 ring-warn-200',
  'watch-low': 'bg-sunken text-ink-2 ring-line',
  normal: 'bg-ok-50 text-ok-700 ring-ok-200',
  high: 'bg-warn-50 text-warn-700 ring-warn-200',
}

const CHART_UNIT: Record<GrowthIndicator, 'kg' | 'cm'> = {
  weightForAge: 'kg',
  lengthForAge: 'cm',
  weightForLength: 'kg',
  weightForHeight: 'kg',
}

/** Days between a birth date and a moment, or undefined if unknown. */
export function ageDaysAt(patient: Patient, at: number): number | undefined {
  if (!patient.birthDate) return undefined
  const born = new Date(patient.birthDate).getTime()
  if (!Number.isFinite(born)) return undefined
  return Math.floor((at - born) / 86_400_000)
}

export function GrowthPanel({
  patient,
  encounters,
}: {
  patient: Patient
  encounters: Encounter[]
}) {
  const { t } = useI18n()
  const [standards, setStandards] = useState<Record<GrowthIndicator, GrowthStandard> | null>(null)

  /*
   * A child within the standards, judged from the most recent visit.
   *
   * `approximateAge` is not enough: a z-score needs the age in days and an
   * estimate in whole years would move a child's weight-for-age by most of a
   * standard deviation. A patient without a birth date gets no chart, which is
   * the honest outcome rather than a curve drawn against a guess.
   */
  const eligible =
    patient.birthDate !== undefined &&
    (ageDaysAt(patient, Date.now()) ?? Number.POSITIVE_INFINITY) <= MAX_AGE_DAYS

  useEffect(() => {
    if (!eligible) return
    let live = true
    void import('../data/whoGrowth').then((module) => {
      if (live) setStandards(module.WHO_GROWTH as unknown as Record<GrowthIndicator, GrowthStandard>)
    })
    return () => {
      live = false
    }
  }, [eligible])

  const { latest, series } = useMemo(() => {
    if (!standards || !eligible) return { latest: [] as GrowthResult[], series: [] }

    const measured: { ageDays: number; weightKg?: number; heightCm?: number }[] = []
    for (const encounter of encounters) {
      const ageDays = ageDaysAt(patient, encounter.occurredAt)
      if (ageDays === undefined || ageDays < 0 || ageDays > MAX_AGE_DAYS) continue
      measured.push({
        ageDays,
        weightKg: encounter.vitals?.weight,
        heightCm: encounter.vitals?.height,
      })
    }
    measured.sort((a, b) => a.ageDays - b.ageDays)

    const newest = measured[measured.length - 1]
    const results = newest
      ? assess({ sex: patient.sex, ...newest }, standards)
      : ([] as GrowthResult[])

    /*
     * One chart, not three.
     *
     * Three curves on a phone is a scroll nobody makes at the end of a
     * consultation, so the chart shows weight-for-age, which is what a health
     * post weighs for, and gives way to height-for-age only when the child is
     * stunted and their weight is not the finding. Wasting is deliberately not
     * charted: weight-for-length is plotted against length rather than age, so
     * it is a different picture with a different x-axis, and the z-score in
     * the list above already carries it.
     */
    const stunted = results.find((r) => r.indicator === 'lengthForAge' && r.z < -2)
    const underweight = results.find((r) => r.indicator === 'weightForAge')
    const shown: 'weightForAge' | 'lengthForAge' =
      stunted && (!underweight || stunted.z < underweight.z) ? 'lengthForAge' : 'weightForAge'

    const points: GrowthPoint[] = []
    for (const m of measured) {
      const value = shown === 'lengthForAge' ? m.heightCm : m.weightKg
      if (value !== undefined) points.push({ ageDays: m.ageDays, value })
    }

    return {
      latest: results,
      series: points.length > 0 ? [{ indicator: shown as GrowthIndicator, points }] : [],
    }
  }, [standards, eligible, encounters, patient])

  if (!eligible) return null
  if (!standards) return null

  const sex = patient.sex === 'male' || patient.sex === 'female' ? patient.sex : null
  if (!sex) return null

  const label: Record<GrowthIndicator, string> = {
    weightForAge: t.growthWeightForAge,
    lengthForAge: t.growthHeightForAge,
    weightForLength: t.growthWeightForHeight,
    weightForHeight: t.growthWeightForHeight,
  }
  const flagLabel: Record<GrowthFlag, string> = {
    'severe-low': t.growthSevereLow,
    'moderate-low': t.growthModerateLow,
    'watch-low': t.growthWatchLow,
    normal: t.growthNormal,
    high: t.growthHigh,
  }

  return (
    <section>
      <SectionTitle>{t.growthHeading}</SectionTitle>
      <Card className="flex flex-col gap-3">
        {latest.length === 0 ? (
          <p className="text-sm text-ink-3">{t.growthNeedsMeasurements}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {latest.map((result) => (
              <li key={result.indicator} className="flex items-center justify-between gap-3">
                <span className="text-sm font-medium text-ink">{label[result.indicator]}</span>
                <span className="flex items-center gap-2">
                  {/* A typographic minus, matching the one in the flag beside
                      it. A hyphen next to "z < −2" reads as two different
                      signs for the same thing. */}
                  <span className="numeric text-sm font-semibold text-ink-2">
                    {result.z < 0 ? '−' : '+'}
                    {Math.abs(result.z).toFixed(1)}
                  </span>
                  <span
                    className={cx(
                      'rounded-full px-2 py-0.5 text-[0.75rem] font-semibold ring-1',
                      FLAG_TONE[result.flag],
                    )}
                  >
                    {flagLabel[result.flag]}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}

        {series.map(({ indicator, points }) => (
          <div key={indicator} className="mt-1">
            <p className="mb-1 flex items-center gap-1.5 text-[0.6875rem] font-bold tracking-wider text-ink-4 uppercase">
              <Activity size={12} />
              {label[indicator]}
            </p>
            <GrowthChart
              standard={standards[indicator]}
              sex={sex}
              points={points}
              unit={CHART_UNIT[indicator]}
              label={label[indicator]}
            />
          </div>
        ))}
      </Card>
    </section>
  )
}

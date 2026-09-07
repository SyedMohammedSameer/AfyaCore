import { useMemo } from 'react'
import { useI18n } from '../i18n'
import { lookupLms, valueAtZ } from '../lib/growth'
import type { GrowthStandard } from '../data/whoGrowth'

/**
 * A WHO growth chart, drawn as SVG.
 *
 * ## Why it is drawn rather than charted
 *
 * A charting library is 40 to 100 kB for a picture that is five polylines and
 * some dots. This is a few hundred lines of arithmetic against a table the app
 * already carries, it inherits the app's own palette and type, and it costs
 * the install nothing.
 *
 * ## What the reader is meant to take from it
 *
 * Not a number — a **direction**. A single weight below the line is a child who
 * may always have been small; the same weight after a plateau or a fall is a
 * child in trouble, and the two are indistinguishable in a table of figures.
 * That is the entire argument for a chart rather than the z-score the profile
 * already shows, and it is why the plotted history is drawn as a connected
 * line rather than as points.
 *
 * The reference bands are the ones the protocols use: the median, then two and
 * three standard deviations either side. Every one of them is labelled at the
 * right-hand edge, because an unlabelled dashed line is decoration — the reader
 * has to be able to say which line the child is under.
 */
const BANDS = [
  { z: 3, key: 'outer' },
  { z: 2, key: 'inner' },
  { z: 0, key: 'median' },
  { z: -2, key: 'inner' },
  { z: -3, key: 'outer' },
] as const

export interface GrowthPoint {
  /** Age in days at the time of the measurement. */
  ageDays: number
  value: number
}

interface Props {
  standard: GrowthStandard
  sex: 'male' | 'female'
  points: GrowthPoint[]
  /** Axis label for the measured quantity, e.g. "kg". */
  unit: string
  /** Human name of the indicator, for the accessible label. */
  label: string
}

const W = 520
const H = 300
/**
 * Gutters.
 *
 * `right` is wide enough for a band label: the SD lines are named at the edge
 * they end on rather than in a legend, so the reader never has to match a dash
 * pattern to a key. `left` holds the value axis.
 */
const PAD = { top: 14, right: 30, bottom: 26, left: 34 }

/** A round step that puts three to five labels on the value axis. */
function axisStep(range: number): number {
  for (const step of [0.5, 1, 2, 5, 10, 20, 50]) if (range / step <= 5) return step
  return 100
}

export function GrowthChart({ standard, sex, points, unit, label }: Props) {
  const { t } = useI18n()
  const table = standard[sex]

  const chart = useMemo(() => {
    if (points.length === 0) return null

    /*
     * Show the child's own span, not the whole standard.
     *
     * Five years of curve for a four-month-old squeezes every visit into the
     * first eighth of the frame, which is where a trend becomes invisible. The
     * window follows the measurements and is padded by a month either side so
     * the newest point is never on the edge.
     */
    const ages = points.map((p) => p.ageDays)
    const lo = Math.max(table.x[0]!, Math.min(...ages) - 30)
    const hi = Math.min(table.x[table.x.length - 1]!, Math.max(...ages) + 30)
    const span = Math.max(hi - lo, 60)

    const samples = 60
    const curves = BANDS.map(({ z, key }) => {
      const path: string[] = []
      let end: { age: number; value: number } | null = null
      for (let i = 0; i <= samples; i++) {
        const age = lo + (span * i) / samples
        const lms = lookupLms(table, age)
        if (!lms) continue
        const value = valueAtZ(lms, z)
        path.push(`${path.length === 0 ? 'M' : 'L'}${age},${value}`)
        end = { age, value }
      }
      return { z, key, d: path.join(' '), end }
    })

    // The vertical range has to hold both the bands and the child, who may be
    // outside them — which is exactly the case the chart exists for.
    const values = [
      ...points.map((p) => p.value),
      ...[lo, hi].flatMap((age) => {
        const lms = lookupLms(table, age)
        return lms ? [valueAtZ(lms, 3), valueAtZ(lms, -3)] : []
      }),
    ]
    const min = Math.min(...values)
    const max = Math.max(...values)
    const pad = (max - min) * 0.08 || 1

    return { lo, hi, curves, min: min - pad, max: max + pad }
  }, [table, points])

  if (!chart) return null

  const x = (age: number) =>
    PAD.left + ((age - chart.lo) / (chart.hi - chart.lo)) * (W - PAD.left - PAD.right)
  const y = (value: number) =>
    H - PAD.bottom - ((value - chart.min) / (chart.max - chart.min)) * (H - PAD.top - PAD.bottom)

  /** Transform a path written in data units into screen units. */
  const project = (d: string) =>
    d.replace(/([ML])([\d.-]+),([\d.-]+)/g, (_, cmd, ax, av) => `${cmd}${x(+ax)} ${y(+av)}`)

  const months = Math.round((chart.hi - chart.lo) / 30.44)
  const tickEvery = months > 36 ? 12 : months > 12 ? 6 : months > 4 ? 3 : 1
  const ticks: number[] = []
  for (let m = 0; m * 30.44 + chart.lo <= chart.hi; m++) {
    const age = chart.lo + m * 30.44
    if (Math.round(age / 30.44) % tickEvery === 0) ticks.push(age)
  }

  // Round values on the left, so the chart can be read as well as glanced at.
  const step = axisStep(chart.max - chart.min)
  const valueTicks: number[] = []
  for (let v = Math.ceil(chart.min / step) * step; v <= chart.max; v += step) valueTicks.push(v)

  const sorted = [...points].sort((a, b) => a.ageDays - b.ageDays)
  const line = sorted.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.ageDays)} ${y(p.value)}`).join(' ')
  const newest = sorted[sorted.length - 1]!

  return (
    <figure className="m-0">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full"
        role="img"
        aria-label={`${label}: ${sorted.length} ${t.growthMeasurements}`}
      >
        {/* Value axis: hairline rules and round numbers, drawn first so every
            reference band and the child sit on top of them. */}
        {valueTicks.map((value) => (
          <g key={value}>
            <line
              x1={PAD.left}
              x2={W - PAD.right}
              y1={y(value)}
              y2={y(value)}
              className="stroke-line"
              strokeWidth={1}
            />
            <text
              x={PAD.left - 6}
              y={y(value) + 4}
              textAnchor="end"
              className="fill-ink-4 text-[11px]"
            >
              {Number.isInteger(value) ? value : value.toFixed(1)}
            </text>
          </g>
        ))}
        <text x={PAD.left - 6} y={PAD.top - 3} textAnchor="end" className="fill-ink-4 text-[11px]">
          {unit}
        </text>

        {/* Reference bands, each named where it ends. Only the third SD is
            coloured: it is the one that changes what happens to the child
            today. */}
        {chart.curves.map(({ z, key, d, end }) => {
          const stroke =
            key === 'median' ? 'stroke-ink-4' : key === 'outer' ? 'stroke-warn-500' : 'stroke-ink-4'
          return (
            <g key={z}>
              <path
                d={project(d)}
                fill="none"
                className={stroke}
                strokeWidth={key === 'median' ? 1.5 : 1}
                strokeDasharray={key === 'median' ? undefined : key === 'outer' ? '5 4' : '2 3'}
              />
              {end && (
                <text
                  x={W - PAD.right + 4}
                  y={y(end.value) + 4}
                  className={cxFill(key)}
                  fontSize={11}
                >
                  {z === 0 ? '0' : z > 0 ? `+${z}` : `−${Math.abs(z)}`}
                </text>
              )}
            </g>
          )
        })}

        {/* Age axis. */}
        {ticks.map((age) => (
          <text
            key={age}
            x={x(age)}
            y={H - 8}
            textAnchor="middle"
            className="fill-ink-4 text-[11px]"
          >
            {Math.round(age / 30.44)}
          </text>
        ))}

        {/* The child. Drawn last so it is never behind a reference band. */}
        <path d={line} fill="none" className="stroke-brand-600" strokeWidth={2} />
        {sorted.map((p) => (
          <circle
            key={p.ageDays}
            cx={x(p.ageDays)}
            cy={y(p.value)}
            r={3.5}
            className="fill-brand-600"
          />
        ))}
        {/* The most recent visit, marked. It is the one a decision hangs on. */}
        <circle
          cx={x(newest.ageDays)}
          cy={y(newest.value)}
          r={5.5}
          className="fill-surface stroke-brand-600"
          strokeWidth={2.5}
        />
      </svg>

      <figcaption className="mt-1 text-[0.75rem] text-ink-4">
        {t.growthAxisAge}. {t.growthCaption}
      </figcaption>
    </figure>
  )
}

/** Band labels take the colour of the band they name. */
function cxFill(key: 'outer' | 'inner' | 'median'): string {
  return key === 'outer' ? 'fill-warn-600' : 'fill-ink-4'
}

import { cx } from './ui'

/**
 * Two tiny charts, drawn by hand.
 *
 * A charting library would cost more bundle than every screen in this app
 * put together, for two shapes: a line over a handful of readings and a row
 * of bars over a fortnight. Both are a few dozen lines of SVG, both inherit
 * `currentColor` so the tone is set by the parent like any other text, and
 * both carry a text alternative because a screen reader cannot read a
 * polyline.
 */

export function Sparkline({
  values,
  width = 132,
  height = 36,
  className,
  label,
}: {
  values: number[]
  width?: number
  height?: number
  className?: string
  /** Read to assistive technology in place of the drawing. */
  label?: string
}) {
  if (values.length < 2) return null
  const min = Math.min(...values)
  const max = Math.max(...values)
  // A flat line sits mid-height rather than on the floor, which would read
  // as zero.
  const span = max - min || 1
  const pad = 3
  const step = (width - pad * 2) / (values.length - 1)
  const y = (v: number) => height - pad - ((v - min) / span) * (height - pad * 2)
  const points = values.map((v, i) => `${(pad + i * step).toFixed(1)},${y(v).toFixed(1)}`)
  const lastX = pad + (values.length - 1) * step
  const lastY = y(values[values.length - 1]!)

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={cx('block overflow-visible', className)}
    >
      <polyline
        points={points.join(' ')}
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {values.map((v, i) => (
        <circle key={i} cx={pad + i * step} cy={y(v)} r={i === values.length - 1 ? 0 : 2} fill="currentColor" opacity={0.55} />
      ))}
      <circle cx={lastX} cy={lastY} r={3.5} fill="currentColor" />
      <circle cx={lastX} cy={lastY} r={6} fill="currentColor" opacity={0.18} />
    </svg>
  )
}

export function BarStrip({
  values,
  className,
  label,
  emphasiseLast = 7,
}: {
  values: number[]
  className?: string
  label?: string
  /** How many bars at the right-hand end are drawn in full tone. */
  emphasiseLast?: number
}) {
  if (values.length === 0) return null
  const max = Math.max(1, ...values)

  // Boxes rather than an SVG: a bar strip has to fill whatever width the
  // card has, and an SVG stretched to fit turns each bar into a slab. Flex
  // gives every day the same share of the width and leaves the height alone.
  return (
    <div
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={cx('flex h-11 items-end gap-[3px]', className)}
    >
      {values.map((v, i) => {
        // Zero still draws a stub, so a quiet day is visibly a day and not a
        // missing one.
        const height = v === 0 ? '2px' : `${Math.max(7, (v / max) * 100)}%`
        const recent = i >= values.length - emphasiseLast
        return (
          <span
            key={i}
            className={cx(
              'block max-w-4 flex-1 rounded-sm bg-current',
              v === 0 ? 'opacity-25' : recent ? 'opacity-100' : 'opacity-45',
            )}
            style={{ height }}
          />
        )
      })}
    </div>
  )
}

import React from 'react'
import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion'
import { theme } from './theme'

/**
 * The measured results.
 *
 * Drawn in React rather than screenshotted, because these are numbers rather
 * than interface — and every one of them is reproducible by running
 * `npm run eval` against the committed corpora. The row that matters is the
 * one that is not flattering: 40% is a real improvement on 0% and nowhere near
 * a solved problem, and a demo that hid it would deserve to be caught.
 */
const ROWS: { label: string; before: string; after: string; good?: boolean }[] = [
  { label: 'Identifiers on the roster removed', before: '100%', after: '100%' },
  { label: 'Identifiers off the roster removed', before: '0%', after: '40%', good: true },
  { label: 'Clinical retention, real French (n=1,258)', before: '100%', after: '98.3%' },
  { label: 'Clinical retention, real English (n=1,014)', before: '100%', after: '99.3%' },
]

export const Numbers: React.FC = () => {
  const frame = useCurrentFrame()
  const fade = interpolate(frame, [0, 16], [0, 1], { extrapolateRight: 'clamp' })

  return (
    <AbsoluteFill
      style={{
        background: theme.ground,
        fontFamily: theme.font,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: fade,
      }}
    >
      <div style={{ width: 1440 }}>
        <div
          style={{
            fontSize: 22,
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
            fontWeight: 700,
            color: theme.brand,
            marginBottom: 18,
          }}
        >
          Measured, not asserted
        </div>
        <div style={{ fontSize: 56, fontWeight: 700, color: theme.ink, letterSpacing: '-0.022em' }}>
          De-identification, on clinical text we did not write
        </div>

        <div style={{ marginTop: 54 }}>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 220px 220px',
              fontSize: 24,
              color: theme.ink3,
              fontWeight: 700,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              paddingBottom: 16,
              borderBottom: `2px solid ${theme.line}`,
            }}
          >
            <div />
            <div style={{ textAlign: 'right' }}>Rules only</div>
            <div style={{ textAlign: 'right' }}>+ OpenMed</div>
          </div>

          {ROWS.map((row, i) => {
            const reveal = interpolate(frame, [14 + i * 9, 30 + i * 9], [0, 1], {
              extrapolateLeft: 'clamp',
              extrapolateRight: 'clamp',
            })
            return (
              <div
                key={row.label}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 220px 220px',
                  alignItems: 'center',
                  padding: '26px 0',
                  borderBottom: `1px solid ${theme.line}`,
                  opacity: reveal,
                  transform: `translateX(${(1 - reveal) * 18}px)`,
                }}
              >
                <div style={{ fontSize: 32, color: theme.ink }}>{row.label}</div>
                <div style={{ fontSize: 34, textAlign: 'right', color: theme.ink3, fontVariantNumeric: 'tabular-nums' }}>
                  {row.before}
                </div>
                <div
                  style={{
                    fontSize: 34,
                    textAlign: 'right',
                    fontWeight: 700,
                    fontVariantNumeric: 'tabular-nums',
                    color: row.good ? theme.brand : theme.ink,
                  }}
                >
                  {row.after}
                </div>
              </div>
            )
          })}
        </div>

        <div
          style={{
            marginTop: 40,
            fontSize: 27,
            lineHeight: 1.5,
            color: theme.ink3,
            maxWidth: 1300,
          }}
        >
          The model deleted <span style={{ color: theme.ink, fontWeight: 600 }}>lymphome hodgkinien</span>{' '}
          and <span style={{ color: theme.ink, fontWeight: 600 }}>hernie de Spiegel</span> — because
          Hodgkin and Spiegel are surnames. Found only on real text, and now guarded.
        </div>
      </div>
    </AbsoluteFill>
  )
}

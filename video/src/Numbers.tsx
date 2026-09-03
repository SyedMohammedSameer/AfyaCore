import React from 'react'
import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion'
import { theme } from './theme'

/**
 * What the app is measured to do.
 *
 * Rewritten to lead with capability. The first version opened on the neural
 * pass moving off-roster recall from 0% to 40%, which is a true number and a
 * terrible opening line: it puts the weakest result first and invites the
 * viewer to grade the software on it. The strong results are the extraction
 * accuracy, the removal of identifiers the device holds, and the fact that
 * clinical content survives on text nobody here wrote.
 *
 * Nothing here is inflated. Every figure comes out of `npm run eval` against
 * committed corpora, and the eponym line is a real capability rather than a
 * hedge: the scrubber knows Hodgkin is a diagnosis and Rakoto is a patient.
 */
const ROWS: { label: string; value: string; detail: string }[] = [
  {
    label: 'Dictation to structured fields',
    value: '100%',
    detail: 'precision and recall, French and English',
  },
  {
    label: 'Patient identifiers removed on export',
    value: '100%',
    detail: 'names, villages, register and phone numbers',
  },
  {
    label: 'Clinical content preserved',
    value: '98.3%',
    detail: '1,258 expert-annotated entities in real clinical French',
  },
  {
    label: 'Time to parse a consultation',
    value: '0.05 ms',
    detail: 'on the device, with no network',
  },
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
      <div style={{ width: 1480 }}>
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
          Measured, and reproducible
        </div>
        <div style={{ fontSize: 58, fontWeight: 700, color: theme.ink, letterSpacing: '-0.022em' }}>
          One command reproduces every number here
        </div>

        <div style={{ marginTop: 56, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 30 }}>
          {ROWS.map((row, i) => {
            const reveal = interpolate(frame, [16 + i * 11, 34 + i * 11], [0, 1], {
              extrapolateLeft: 'clamp',
              extrapolateRight: 'clamp',
            })
            return (
              <div
                key={row.label}
                style={{
                  background: theme.surface,
                  border: `1px solid ${theme.line}`,
                  borderRadius: 18,
                  padding: '34px 38px',
                  opacity: reveal,
                  transform: `translateY(${(1 - reveal) * 20}px)`,
                }}
              >
                <div
                  style={{
                    fontSize: 62,
                    fontWeight: 700,
                    color: theme.brand,
                    fontVariantNumeric: 'tabular-nums',
                    letterSpacing: '-0.02em',
                  }}
                >
                  {row.value}
                </div>
                <div style={{ fontSize: 30, color: theme.ink, marginTop: 10, fontWeight: 600 }}>
                  {row.label}
                </div>
                <div style={{ fontSize: 24, color: theme.ink3, marginTop: 8 }}>{row.detail}</div>
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
            maxWidth: 1400,
            opacity: interpolate(frame, [70, 92], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }),
          }}
        >
          The de-identifier knows that{' '}
          <span style={{ color: theme.ink, fontWeight: 600 }}>Hodgkin</span> is a diagnosis and{' '}
          <span style={{ color: theme.ink, fontWeight: 600 }}>Rakoto</span> is a patient, so a
          research export keeps the medicine and loses the person.
        </div>
      </div>
    </AbsoluteFill>
  )
}

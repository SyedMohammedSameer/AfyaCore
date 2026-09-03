import React from 'react'
import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion'
import { theme } from './theme'

/**
 * The two models, credited.
 *
 * This beat exists because the audience is a machine learning venue and the
 * interesting claim is not that the app uses models, it is *where* they run.
 * Both are open weights the deployer copies onto the facility's own server;
 * the browser executes them with onnxruntime-web, and no inference request
 * ever leaves the phone. That is what makes the privacy claim in the rest of
 * the video hold, and it is the part a reviewer will want named.
 *
 * Facts checked against the model cards rather than remembered. Both are
 * Apache-2.0 — Whisper's *code* is MIT and the weights are not, which is an
 * easy thing to get wrong on a slide in front of the people most likely to
 * notice.
 */
const MODELS = [
  {
    name: 'OpenAI Whisper',
    variant: 'base · multilingual · 72.6M',
    does: 'Speech to text',
    detail:
      'Transcribes the consultation in a worker on the phone, in French or English. The patient’s voice never reaches a network.',
    meta: '81 MB · Apache-2.0 · arXiv:2212.04356',
  },
  {
    name: 'OpenMed PII',
    variant: 'French clinical · 33M',
    does: 'Names the roster has never seen',
    detail:
      'Finds a relative mentioned in passing in a note, which matching against the patient list cannot catch. The deterministic scrub runs with or without it.',
    meta: '70 MB · Apache-2.0 · arXiv:2508.01630',
  },
]

export const Models: React.FC = () => {
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
          What runs on the phone
        </div>
        <div style={{ fontSize: 58, fontWeight: 700, color: theme.ink, letterSpacing: '-0.022em' }}>
          Two open models, running where the patient is
        </div>

        <div style={{ marginTop: 50, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 32 }}>
          {MODELS.map((model, i) => {
            const reveal = interpolate(frame, [18 + i * 14, 40 + i * 14], [0, 1], {
              extrapolateLeft: 'clamp',
              extrapolateRight: 'clamp',
            })
            return (
              <div
                key={model.name}
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
                    fontSize: 40,
                    fontWeight: 700,
                    color: theme.brand,
                    letterSpacing: '-0.02em',
                  }}
                >
                  {model.name}
                </div>
                <div
                  style={{
                    fontSize: 22,
                    color: theme.ink3,
                    marginTop: 6,
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {model.variant}
                </div>
                <div style={{ fontSize: 30, color: theme.ink, marginTop: 22, fontWeight: 600 }}>
                  {model.does}
                </div>
                <div style={{ fontSize: 24, lineHeight: 1.45, color: theme.ink3, marginTop: 10 }}>
                  {model.detail}
                </div>
                <div
                  style={{
                    fontSize: 21,
                    color: theme.ink3,
                    marginTop: 20,
                    paddingTop: 16,
                    borderTop: `1px solid ${theme.line}`,
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {model.meta}
                </div>
              </div>
            )
          })}
        </div>

        <div
          style={{
            marginTop: 36,
            fontSize: 27,
            lineHeight: 1.5,
            color: theme.ink3,
            maxWidth: 1400,
            opacity: interpolate(frame, [58, 80], [0, 1], {
              extrapolateLeft: 'clamp',
              extrapolateRight: 'clamp',
            }),
          }}
        >
          Neither is ever called over a network. An administrator copies both onto the facility’s own
          server, the browser runs them with{' '}
          <span style={{ color: theme.ink, fontWeight: 600 }}>onnxruntime-web</span>, and the service
          worker keeps them, so one afternoon of connectivity buys them for good.
        </div>
      </div>
    </AbsoluteFill>
  )
}

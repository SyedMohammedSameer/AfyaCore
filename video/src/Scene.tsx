import React from 'react'
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion'
import { Img, staticFile } from 'remotion'
import { Phone } from './Phone'
import { theme } from './theme'

/**
 * One beat of the story: a phone on the left, a claim on the right.
 *
 * The claim is deliberately short. A demo video is watched once, at whatever
 * size the reviewer's window happens to be, often without sound — so each beat
 * gets one sentence a reader can finish before the shot changes, and the
 * evidence for it is on screen beside it rather than narrated over it.
 */
export const Scene: React.FC<{
  src: string
  kicker: string
  claim: string
  note?: string
  /** Desktop shots are not phone shaped, so they get a laptop-ish card instead. */
  wide?: boolean
}> = ({ src, kicker, claim, note, wide }) => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()

  const enter = spring({ frame, fps, config: { damping: 200 }, durationInFrames: 20 })
  const drift = interpolate(frame, [0, 240], [0, -14], { extrapolateRight: 'clamp' })

  return (
    <AbsoluteFill style={{ background: theme.ground, fontFamily: theme.font }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: wide ? 70 : 110,
          width: '100%',
          height: '100%',
          padding: wide ? '0 90px' : '0 130px',
        }}
      >
        <div
          style={{
            transform: `translateY(${drift + (1 - enter) * 40}px)`,
            opacity: enter,
            flexShrink: 0,
          }}
        >
          {wide ? (
            <div
              style={{
                width: 980,
                borderRadius: 18,
                overflow: 'hidden',
                background: theme.surface,
                border: `1px solid ${theme.line}`,
                boxShadow: '0 40px 90px -20px rgba(28,35,33,0.4)',
              }}
            >
              <Img src={staticFile(src)} style={{ width: '100%', display: 'block' }} />
            </div>
          ) : (
            <Phone src={src} scale={0.98} />
          )}
        </div>

        <div style={{ opacity: interpolate(frame, [6, 24], [0, 1], { extrapolateRight: 'clamp' }) }}>
          <div
            style={{
              fontSize: 22,
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
              fontWeight: 700,
              color: theme.brand,
              marginBottom: 22,
            }}
          >
            {kicker}
          </div>
          <div
            style={{
              fontSize: wide ? 46 : 62,
              lineHeight: 1.14,
              fontWeight: 700,
              letterSpacing: '-0.022em',
              color: theme.ink,
              maxWidth: wide ? 640 : 900,
            }}
          >
            {claim}
          </div>
          {note && (
            <div
              style={{
                marginTop: wide ? 24 : 30,
                fontSize: wide ? 25 : 30,
                lineHeight: 1.45,
                color: theme.ink3,
                maxWidth: wide ? 640 : 820,
              }}
            >
              {note}
            </div>
          )}
        </div>
      </div>
    </AbsoluteFill>
  )
}

import React from 'react'
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion'
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
}> = ({ src, kicker, claim, note }) => {
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
          gap: 110,
          width: '100%',
          height: '100%',
          padding: '0 130px',
        }}
      >
        <div
          style={{
            transform: `translateY(${drift + (1 - enter) * 40}px)`,
            opacity: enter,
            flexShrink: 0,
          }}
        >
          <Phone src={src} scale={1.02} />
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
              fontSize: 62,
              lineHeight: 1.14,
              fontWeight: 700,
              letterSpacing: '-0.022em',
              color: theme.ink,
              maxWidth: 900,
            }}
          >
            {claim}
          </div>
          {note && (
            <div
              style={{
                marginTop: 30,
                fontSize: 30,
                lineHeight: 1.45,
                color: theme.ink3,
                maxWidth: 820,
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

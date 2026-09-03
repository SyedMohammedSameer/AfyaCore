import React from 'react'
import { AbsoluteFill, Img, interpolate, staticFile, useCurrentFrame } from 'remotion'
import { theme } from './theme'

/**
 * The one beat a still cannot carry.
 *
 * These four frames were photographed in sequence by `video/capture.mjs` while
 * the browser's network was switched off, in the same walk `npm run smoke`
 * asserts in CI. The badge changing from online to offline is the app's own
 * indicator, not an overlay: nothing here is staged.
 */
const STEPS = [
  { src: 'offline/01-online-roster.png', label: 'Online', off: false },
  { src: 'offline/02-offline-roster.png', label: 'Network off', off: true },
  { src: 'offline/03-offline-reload-lock.png', label: 'Full reload, still off', off: true },
  { src: 'offline/05-offline-roster-again.png', label: 'Records intact', off: true },
]

export const Offline: React.FC = () => {
  const frame = useCurrentFrame()
  const fade = interpolate(frame, [0, 14], [0, 1], { extrapolateRight: 'clamp' })

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
      <div style={{ textAlign: 'center', marginBottom: 46 }}>
        <div
          style={{
            fontSize: 22,
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
            fontWeight: 700,
            color: theme.brand,
            marginBottom: 16,
          }}
        >
          The claim everything rests on
        </div>
        <div style={{ fontSize: 58, fontWeight: 700, color: theme.ink, letterSpacing: '-0.022em' }}>
          Switch the network off. Nothing changes.
        </div>
        <div style={{ fontSize: 28, color: theme.ink3, marginTop: 18, maxWidth: 1150 }}>
          Three of these four have no connectivity, including a full page reload. The app looks the
          same because it never needed the network — the same walk CI asserts on every commit.
        </div>
      </div>

      <div style={{ display: 'flex', gap: 40, alignItems: 'flex-start' }}>
        {STEPS.map((step, i) => {
          const reveal = interpolate(frame, [18 + i * 22, 38 + i * 22], [0, 1], {
            extrapolateLeft: 'clamp',
            extrapolateRight: 'clamp',
          })
          const dim = i === 0 ? 1 : reveal
          return (
            <div key={step.src} style={{ opacity: dim, transform: `translateY(${(1 - reveal) * 22}px)` }}>
              <div
                style={{
                  width: 300,
                  height: 650,
                  borderRadius: 30,
                  padding: 7,
                  background: '#14181A',
                  boxShadow: '0 24px 50px -14px rgba(28,35,33,0.35)',
                }}
              >
                <div style={{ width: '100%', height: '100%', borderRadius: 24, overflow: 'hidden' }}>
                  <Img
                    src={staticFile(step.src)}
                    style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'top' }}
                  />
                </div>
              </div>
              <div
                style={{
                  marginTop: 20,
                  textAlign: 'center',
                  fontSize: 26,
                  fontWeight: 600,
                  color: step.off ? theme.warn : theme.ink3,
                }}
              >
                {step.label}
              </div>
            </div>
          )
        })}
      </div>
    </AbsoluteFill>
  )
}

import React from 'react'
import { AbsoluteFill, Img, interpolate, staticFile, useCurrentFrame } from 'remotion'
import { theme } from './theme'

/**
 * The one beat a still cannot carry.
 *
 * These four frames were photographed in sequence by `video/capture.mjs` while
 * the browser's network was switched off, in the same walk `npm run smoke`
 * asserts in CI.
 *
 * The chip above each phone is not an overlay drawn here. It is a magnified
 * crop of the app's own sync indicator, taken out of the same screenshot it
 * sits above, at the coordinates the chip occupies in a 390x844 viewport. It
 * is enlarged because at four phones across a 1920 frame the real chip is
 * about thirty pixels wide, and the state change is the entire point of the
 * beat. Enlarging something the app drew is fair; drawing it ourselves would
 * not be, which is why `capture.mjs` now enrols against a real sync server
 * rather than leaving the chip on its neutral "saved on device" state.
 */
const CHIP = { x: 374, y: 42, w: 92, h: 66, zoom: 1.3 }

/** A magnified crop of the sync chip out of the screenshot beneath it. */
const Chip: React.FC<{ src: string }> = ({ src }) => (
  <div
    style={{
      width: CHIP.w * CHIP.zoom,
      height: CHIP.h * CHIP.zoom,
      overflow: 'hidden',
      position: 'relative',
      borderRadius: 16,
      background: theme.surface,
      border: `1px solid ${theme.line}`,
    }}
  >
    <Img
      src={staticFile(src)}
      style={{
        position: 'absolute',
        width: 780 * CHIP.zoom,
        maxWidth: 'none',
        left: -CHIP.x * CHIP.zoom,
        top: -CHIP.y * CHIP.zoom,
      }}
    />
  </div>
)
const STEPS = [
  { src: 'offline/01-online-roster.png', label: 'Online', off: false, chip: true },
  { src: 'offline/02-offline-roster.png', label: 'Network off', off: true, chip: true },
  // The lock screen has no header, so there is no chip to magnify. A blank
  // slot rather than a fabricated one: this is a shot of a cold reload with no
  // network, and its evidence is that it rendered at all.
  { src: 'offline/03-offline-reload-lock.png', label: 'Full reload, still off', off: true, chip: false },
  { src: 'offline/05-offline-roster-again.png', label: 'Records intact', off: true, chip: true },
]

/**
 * Same rule as `Phone`: the screen box carries the screenshot's own aspect
 * ratio (390x844) and the bezel is added outside it, so the bottom of the
 * screen is never eaten by the frame.
 */
const SCREEN_W = 262
const SCREEN_H = Math.round(SCREEN_W * (844 / 390))
const BEZEL = 7

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
      <div style={{ textAlign: 'center', marginBottom: 32 }}>
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
          Turn the network off. Nothing changes.
        </div>
        <div style={{ fontSize: 28, color: theme.ink3, marginTop: 18, maxWidth: 1150 }}>
          The chip above each phone is the app's own sync indicator, enlarged. Three of these four
          have no network, including one that was reloaded from nothing. Records are written to the
          device first and sync later, so a week offline costs nothing.
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
            <div
              key={step.src}
              style={{
                opacity: dim,
                transform: `translateY(${(1 - reveal) * 22}px)`,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 14,
              }}
            >
              {step.chip ? (
                <Chip src={step.src} />
              ) : (
                <div style={{ width: CHIP.w * CHIP.zoom, height: CHIP.h * CHIP.zoom }} />
              )}
              <div
                style={{
                  width: SCREEN_W + BEZEL * 2,
                  height: SCREEN_H + BEZEL * 2,
                  borderRadius: 30,
                  padding: BEZEL,
                  background: '#14181A',
                  boxShadow: '0 24px 50px -14px rgba(28,35,33,0.35)',
                }}
              >
                <div
                  style={{
                    width: SCREEN_W,
                    height: SCREEN_H,
                    borderRadius: 24,
                    overflow: 'hidden',
                  }}
                >
                  <Img
                    src={staticFile(step.src)}
                    style={{ width: '100%', height: '100%', objectFit: 'fill' }}
                  />
                </div>
              </div>
              <div
                style={{
                  marginTop: 4,
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

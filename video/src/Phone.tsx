import React from 'react'
import { Img, staticFile } from 'remotion'
import { theme } from './theme'

/**
 * A screenshot of the running app, in a phone-shaped frame.
 *
 * The screen area is sized to the screenshot's own aspect ratio (390x844, the
 * viewport `npm run screenshots` captures) and the bezel is added *outside*
 * it. The first version sized the outer frame to 390x844 and then subtracted
 * padding, which left an inner box of 370x824 — a different aspect — so every
 * shot was cropped, and the crop always ate the bottom of the screen where the
 * action bar and the last prescription live.
 *
 * The frame is drawn here because the app does not draw its own bezel.
 * Everything inside it is untouched.
 */
const SCREEN_W = 390
const SCREEN_H = 844

export const Phone: React.FC<{ src: string; scale?: number }> = ({ src, scale = 1 }) => {
  const bezel = 12 * scale
  const w = SCREEN_W * scale
  const h = SCREEN_H * scale

  return (
    <div
      style={{
        width: w + bezel * 2,
        height: h + bezel * 2,
        borderRadius: 46 * scale,
        padding: bezel,
        background: '#14181A',
        boxShadow: '0 40px 90px -20px rgba(28,35,33,0.45), 0 8px 24px -8px rgba(28,35,33,0.3)',
      }}
    >
      <div
        style={{
          width: w,
          height: h,
          borderRadius: 34 * scale,
          overflow: 'hidden',
          background: theme.ground,
        }}
      >
        {/* `fill` rather than `cover`: the box is already the screenshot's own
            aspect ratio, so nothing is scaled unevenly and nothing is cut. */}
        <Img src={staticFile(src)} style={{ width: '100%', height: '100%', objectFit: 'fill' }} />
      </div>
    </div>
  )
}

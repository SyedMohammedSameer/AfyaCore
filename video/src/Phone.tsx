import React from 'react'
import { Img, staticFile } from 'remotion'
import { theme } from './theme'

/**
 * A screenshot of the running app, in a phone-shaped frame.
 *
 * The frame is drawn here rather than photographed because the app does not
 * draw its own bezel — but everything inside it is `docs/screenshots/*.webp`,
 * captured from the production build by `npm run screenshots`. Nothing is
 * redrawn, retouched or recreated.
 */
export const Phone: React.FC<{ src: string; scale?: number }> = ({ src, scale = 1 }) => (
  <div
    style={{
      width: 390 * scale,
      height: 844 * scale,
      borderRadius: 44 * scale,
      padding: 10 * scale,
      background: '#14181A',
      boxShadow: '0 40px 90px -20px rgba(28,35,33,0.45), 0 8px 24px -8px rgba(28,35,33,0.3)',
    }}
  >
    <div
      style={{
        width: '100%',
        height: '100%',
        borderRadius: 34 * scale,
        overflow: 'hidden',
        background: theme.ground,
      }}
    >
      <Img src={staticFile(src)} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
    </div>
  </div>
)

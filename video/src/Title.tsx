import React from 'react'
import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion'
import { theme } from './theme'

export const Title: React.FC<{ title: string; subtitle: string; footnote?: string }> = ({
  title,
  subtitle,
  footnote,
}) => {
  const frame = useCurrentFrame()
  const fade = interpolate(frame, [0, 18], [0, 1], { extrapolateRight: 'clamp' })
  const rise = interpolate(frame, [0, 26], [26, 0], { extrapolateRight: 'clamp' })

  return (
    <AbsoluteFill
      style={{
        background: `linear-gradient(160deg, ${theme.brandDeep} 0%, #085541 55%, ${theme.brand} 100%)`,
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: theme.font,
        color: '#fff',
      }}
    >
      <div style={{ textAlign: 'center', opacity: fade, transform: `translateY(${rise}px)` }}>
        <div style={{ fontSize: 116, fontWeight: 700, letterSpacing: '-0.03em' }}>{title}</div>
        <div style={{ fontSize: 40, marginTop: 26, color: 'rgba(255,255,255,0.86)', maxWidth: 1250 }}>
          {subtitle}
        </div>
        {footnote && (
          <div style={{ fontSize: 25, marginTop: 46, color: 'rgba(255,255,255,0.62)' }}>{footnote}</div>
        )}
      </div>
    </AbsoluteFill>
  )
}

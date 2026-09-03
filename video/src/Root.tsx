import React from 'react'
import { Composition } from 'remotion'
import { Demo, TOTAL } from './Demo'
import { RENDER_FPS } from './theme'

export const RemotionRoot: React.FC = () => (
  <Composition
    id="Demo"
    component={Demo}
    durationInFrames={TOTAL}
    // Same frames as authored, played twice as fast. See SPEED in theme.ts.
    fps={RENDER_FPS}
    width={1920}
    height={1080}
  />
)

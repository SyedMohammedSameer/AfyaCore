import React from 'react'
import { Composition } from 'remotion'
import { Demo, TOTAL } from './Demo'
import { FPS } from './theme'

export const RemotionRoot: React.FC = () => (
  <Composition
    id="Demo"
    component={Demo}
    durationInFrames={TOTAL}
    fps={FPS}
    width={1920}
    height={1080}
  />
)

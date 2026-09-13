import React from 'react'
import { Composition } from 'remotion'
import { Demo, TOTAL, type DemoProps } from './Demo'
import { FPS, SPEED } from './theme'

/**
 * Speed is an input prop, not only a constant.
 *
 * The composition is authored at FPS and rendered at FPS x speed, which is a
 * true speed-up: same frames, faster clock. SPEED in theme.ts stays the
 * default so the README trailer and `scripts/demo-preview.mjs` keep working
 * unchanged; the submission cut passes `--props '{"speed":1,"narration":true}'`
 * through `render.mjs` to get the 110-second readable version with the
 * voice-over under it.
 */
export const RemotionRoot: React.FC = () => (
  <Composition<DemoProps>
    id="Demo"
    component={Demo}
    durationInFrames={TOTAL}
    fps={FPS * SPEED}
    width={1920}
    height={1080}
    defaultProps={{ narration: false, speed: SPEED }}
    calculateMetadata={({ props }) => ({ fps: FPS * props.speed })}
  />
)

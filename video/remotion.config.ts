import { Config } from '@remotion/cli/config'

Config.setVideoImageFormat('jpeg')
Config.setOverwriteOutput(true)

/**
 * Muting is decided per render, in `render.mjs`, not here.
 *
 * The README trailer is silent on purpose (a muxed silent track confused
 * every player we tried it in) and passes `--muted`. The conference cut lays
 * a voice-over under the picture and must not be muted. A `Config.setMuted`
 * in this file won the argument over the composition's own Audio element,
 * so the narrated render came out with no audio stream at all, which is the
 * one defect a submission video cannot survive.
 */

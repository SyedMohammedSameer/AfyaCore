import { Config } from '@remotion/cli/config'

Config.setVideoImageFormat('jpeg')
Config.setOverwriteOutput(true)

/**
 * No audio track at all.
 *
 * Remotion muxes a silent AAC track by default even when a composition has no
 * sound in it. Music is added afterwards in an editor, and a silent track that
 * arrives first is something to notice and delete rather than something that
 * helps — so the render leaves the audio slot genuinely empty.
 */
Config.setMuted(true)
Config.setEnforceAudioTrack(false)

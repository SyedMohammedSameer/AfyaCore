/**
 * The video borrows the app's own palette.
 *
 * Not decoration: a demo whose title cards are a different colour from the
 * product reads as a video *about* something, and this one should read as the
 * thing itself. These are the exact tokens from src/index.css.
 */
export const theme = {
  ground: '#F7F5F0',
  surface: '#FFFFFF',
  ink: '#1C2321',
  ink2: '#4A5551',
  ink3: '#5D6B66',
  line: '#E4DFD5',
  brand: '#0A6B52',
  brandDeep: '#05352A',
  warn: '#8A5300',
  warnBg: '#FDF3E0',
  font: '"IBM Plex Sans", "DejaVu Sans", system-ui, sans-serif',
} as const

/**
 * The rate the beats are written in.
 *
 * Every duration in `Demo.tsx` and every `interpolate` range in a component is
 * counted in these frames, so this is the authoring clock and changing it
 * would rewrite the whole composition.
 */
export const FPS = 30

/**
 * How much faster the finished file plays than it was written.
 *
 * A true 2x: the composition keeps its frame count and is rendered at twice
 * the frame rate, so every hold, spring and fade compresses by exactly half,
 * the way speeding up playback would. Doing it here rather than by
 * time-stretching the encode means the output is real frames at 60 fps rather
 * than the same 30 dropped in half, so nothing judders.
 *
 * The cost is reading time, and it is not small: at 1x the video runs 500
 * words in 110 seconds, which is already 4.5 words a second, and this doubles
 * that. Set back to 1 to get the readable cut.
 */
export const SPEED = 2

/** What the file is actually encoded at. */
export const RENDER_FPS = FPS * SPEED

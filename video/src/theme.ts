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

export const FPS = 30

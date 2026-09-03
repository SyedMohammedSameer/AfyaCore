import { continueRender, delayRender, staticFile } from 'remotion'

/**
 * Load IBM Plex Sans before the first frame is drawn.
 *
 * Without this every frame renders in whatever the render container happens to
 * have — DejaVu Sans here — which is the same class of mistake the app itself
 * shipped with for months: naming a typeface and never loading it. A video
 * whose type does not match the product undoes half of what the design work
 * was for.
 *
 * `delayRender` holds the renderer until the face is actually ready, so no
 * frame can be captured mid-swap.
 */
const handle = delayRender('loading IBM Plex Sans')

const face = new FontFace(
  'IBM Plex Sans',
  `url(${staticFile('fonts/ibm-plex-sans-latin-wght-normal.woff2')}) format('woff2-variations')`,
  { weight: '100 700' },
)

face
  .load()
  .then((loaded) => {
    document.fonts.add(loaded)
    continueRender(handle)
  })
  .catch(() => {
    // A missing font must not stall a render; it falls back and the video is
    // merely uglier rather than absent.
    continueRender(handle)
  })

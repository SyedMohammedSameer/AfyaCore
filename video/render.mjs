/**
 * Render the demo, using the same browser the capture and smoke scripts use.
 *
 * Remotion's default is to download its own Chrome Headless Shell from
 * remotion.media. That is a fine default and a bad one here: the shell is a
 * ~150 MB download this repo does not need, and on a machine with restricted
 * egress it fails with a 403 that reads like a Remotion bug rather than a
 * network policy. Every other browser-driving script in this repo resolves a
 * binary through `scripts/find-chrome.mjs`, so this one does too.
 */
import { spawn } from 'node:child_process'
import { findChrome } from '../scripts/find-chrome.mjs'

const out = process.argv[2] ?? 'out/afyacore-demo.mp4'
// Quality knob. The master stays visually lossless for editing; the copy
// committed for the README is squeezed, because the content is flat colour and
// text and h264 gives that away almost free.
const crf = process.argv[3] ?? '18'
/**
 * The submission cut: `SPEED=1 NARRATION=1 node render.mjs out/afyacore-ml4h.mp4`.
 *
 * SPEED overrides the authoring default in theme.ts for this render only,
 * through the composition's input props. NARRATION lays `public/narration.m4a`
 * under the picture and turns the muted default off; without the file, the
 * render fails loudly rather than producing a silent "narrated" cut.
 */
const speed = Number(process.env.SPEED ?? '') || undefined
const narration = process.env.NARRATION === '1'
if (narration) {
  const { access } = await import('node:fs/promises')
  await access(new URL('./public/narration.m4a', import.meta.url)).catch(() => {
    throw new Error('NARRATION=1 but video/public/narration.m4a is missing. Run `node video/narrate.mjs` or record docs/ml4h/voiceover.md.')
  })
}
const props = JSON.stringify({ ...(speed ? { speed } : {}), narration })
const browser = await findChrome()
console.log(`browser: ${browser}`)
console.log(`props:   ${props}`)

const child = spawn(
  'npx',
  [
    'remotion',
    'render',
    'src/index.ts',
    'Demo',
    out,
    // Silent by default: a muxed silent track confused every player we tried
    // it in. The narrated cut is the exception and says so.
    ...(narration ? [] : ['--muted']),
    `--props=${props}`,
    `--crf=${crf}`,
    `--browser-executable=${browser}`,
    // Containers and CI images run as root without a user namespace, which
    // Chromium's sandbox needs. Rendering our own local bundle, not the web.
    '--chrome-mode=chrome-for-testing',
    '--disable-web-security',
    '--gl=angle',
  ],
  { stdio: 'inherit' },
)
child.on('exit', (code) => process.exit(code ?? 1))

/**
 * Where to find a browser, in one place.
 *
 * This list existed three times — in `screenshots.mjs`, `smoke.mjs` and
 * `video/capture.mjs` — and the third copy was written from memory and dropped
 * Brave. The result was a capture script that failed on the one machine the
 * other two scripts worked on, which is exactly the failure mode a duplicated
 * constant produces: not a wrong answer, an inconsistent one.
 *
 * `CHROME_PATH` always wins, so CI and unusual installs need no code change.
 */
import { access } from 'node:fs/promises'

export const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  // macOS. Brave first because it is Chromium and many developers have only it.
  '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  // Linux
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/snap/bin/chromium',
].filter(Boolean)

export async function findChrome() {
  for (const path of CHROME_CANDIDATES) {
    try {
      await access(path)
      return path
    } catch {
      // try the next candidate
    }
  }
  throw new Error(
    'No Chromium-based browser found. Install Chrome, Chromium or Brave, or set\n' +
      'CHROME_PATH to a binary.\n\nTried:\n  ' +
      CHROME_CANDIDATES.join('\n  '),
  )
}

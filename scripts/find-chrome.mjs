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
import { access, readdir } from 'node:fs/promises'
import { join } from 'node:path'

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

/**
 * Playwright keeps its Chromium in a versioned directory, so the path cannot
 * be a constant. Cloud build images (and any machine where the browser came
 * from `playwright install`) have it here and nowhere else, which is why the
 * fixed list above finds nothing on them.
 */
async function playwrightChromes() {
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers'
  let entries
  try {
    entries = await readdir(root)
  } catch {
    return []
  }
  return entries
    .filter((name) => name.startsWith('chromium'))
    // Plain `chromium-*` before `chromium_headless_shell-*`: the headless
    // shell cannot do everything a full build can, so it is the fallback.
    .sort()
    .flatMap((name) => [
      join(root, name, 'chrome-linux', 'chrome'),
      join(root, name, 'chrome-linux', 'headless_shell'),
      join(root, name, 'chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'),
    ])
}

export async function findChrome() {
  const candidates = [...CHROME_CANDIDATES, ...(await playwrightChromes())]
  for (const path of candidates) {
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
      candidates.join('\n  '),
  )
}

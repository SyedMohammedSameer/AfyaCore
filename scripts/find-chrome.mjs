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

/**
 * Launch flags every script here needs, in the same one place as the browser.
 *
 * `--no-sandbox` was previously added only when running as root, on the
 * reasoning that Chromium refuses to start as root with its sandbox on and
 * that this is a container-only problem. Both halves were wrong, and the
 * offline smoke walk failed on every CI run from the day it was added because
 * of it: a GitHub runner is *not* root, so the flag was withheld, and Ubuntu
 * 23.10 and later restrict unprivileged user namespaces through AppArmor, so
 * Chromium's zygote aborts before the first page loads. Ten red runs, and the
 * step had never once been green.
 *
 * Turning the sandbox off unconditionally is safe here in a way it would not
 * be in a browser: every one of these scripts drives our own build, served
 * from localhost, in a throwaway profile. The sandbox exists to contain
 * hostile page content, and there is none. Nothing here ever visits the web.
 *
 * `--disable-dev-shm-usage` is the companion fix for the other container
 * failure: /dev/shm defaults to 64 MB in Docker and Chromium fills it, which
 * shows up as a tab crashing mid-run rather than as an error anyone can read.
 */
export const LAUNCH_ARGS = ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']

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

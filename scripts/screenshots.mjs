#!/usr/bin/env node
/**
 * Regenerate the screenshots used in README.md.
 *
 * Screenshots pasted into a README rot: a button moves, a string changes, and
 * the picture quietly starts lying about the app. This drives the real build in
 * a real browser and rewrites every image, so refreshing them is one command
 * rather than an afternoon of cropping.
 *
 * Uses `puppeteer-core` against a Chromium already on the machine rather than
 * `puppeteer`, which would download a second ~150 MB copy of Chrome into
 * node_modules. Point CHROME_PATH at any Chromium build if the defaults miss.
 *
 *   npm run preview        # serve the production build on :4173
 *   npm run screenshots    # in another shell
 *
 * Every screenshot is taken against the synthetic demo workspace. No real
 * patient data goes anywhere near this script, and none should.
 */
import { mkdir, access, rename, stat, rm } from 'node:fs/promises'
import { join } from 'node:path'
import puppeteer from 'puppeteer-core'
import { findChrome, LAUNCH_ARGS } from './find-chrome.mjs'

const BASE = process.env.AFYACORE_URL ?? 'http://localhost:4173'
const OUT = 'docs/screenshots'
/**
 * The directory `npm run preview` is serving.
 *
 * Needed because two of these screenshots are of *deployment configurations*
 * rather than screens: whether the on-device speech model is installed changes
 * what the dictation panel says, and both states are real and both are
 * documented. Moving the model directory aside for one shot and back for the
 * next captures each of them from the running app, which is the rule this
 * script exists to keep. Nothing is mocked and no state is faked.
 */
const SERVED = process.env.AFYACORE_DIST ?? 'dist'
const SPEECH_PACKS = ['whisper-base', 'whisper-tiny']


/**
 * Capture sizes and format.
 *
 * Deliberately modest. Retina PNGs of this UI ran to ~1.5 MB each, because the
 * glass panels are smooth gradients and PNG is the wrong codec for those; nine
 * of them would have put 10 MB of pictures in a repository whose entire pitch
 * is a 135 kB bundle. WebP at these dimensions is a fifteenth of that and still
 * sharper than GitHub renders a README image.
 */
const DESKTOP = { width: 1440, height: 900, deviceScaleFactor: 1 }
const MOBILE = { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
const FORMAT = 'webp'
const QUALITY = 88

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * Wait for the app to stop animating so shots are not caught mid-transition.
 *
 * The lock screen is not inside a `main`, so waiting for `main` alone hangs
 * whenever the app is signed out, which after this change is every full page
 * load. Waiting for either surface keeps one helper for both.
 */
async function settle(page) {
  await page.waitForFunction(
    () => document.querySelector('main') !== null || document.querySelector('[data-lock]') !== null,
    { timeout: 15_000 },
  )
  await sleep(700)
}

/**
 * Whether a speech pack is being served, and the ability to hide it briefly.
 *
 * `hidePacks` returns false when there was nothing to hide, which is the
 * signal that this run cannot produce the on-device shots at all — the
 * caller then captures the fallback configuration under its own names and
 * `main` warns loudly, rather than quietly writing an asset that describes a
 * deployment nobody is recommending.
 */
let packsPresent = false
const hidden = []

const exists = (p) =>
  access(p).then(
    () => true,
    () => false,
  )

async function detectPacks() {
  for (const pack of SPEECH_PACKS) {
    if (await exists(join(SERVED, 'models', pack))) packsPresent = true
  }
  return packsPresent
}

async function hidePacks() {
  if (!packsPresent) return false
  for (const pack of SPEECH_PACKS) {
    const from = join(SERVED, 'models', pack)
    if (!(await exists(from))) continue
    const to = `${from}.hidden`
    await rename(from, to)
    hidden.push([from, to])
  }
  return hidden.length > 0
}

async function restorePacks() {
  while (hidden.length > 0) {
    const [from, to] = hidden.pop()
    await rename(to, from).catch(() => {})
  }
}

/**
 * Fail rather than write a screenshot of the wrong configuration.
 *
 * The whole class of bug here is an asset that keeps being used after the
 * behaviour it depicts has changed, and it is invisible: the picture still
 * looks like the app. Asserting the sentence the panel is supposed to be
 * showing turns that into a failed command.
 */
async function assertDictation(page, expected) {
  const text = await page.evaluate(() => document.body.textContent ?? '')
  if (!expected.test(text)) {
    throw new Error(
      `the dictation panel does not match ${expected}. ` +
        `Either the copy changed or the speech pack state is not what this run assumed.`,
    )
  }
}

/** Scroll the first element whose text matches into view, then let it settle. */
async function scrollTo(page, pattern) {
  const found = await page.evaluate((src) => {
    const re = new RegExp(src, 'i')
    const el = [...document.querySelectorAll('h2, h3, button, label, section')].find((node) =>
      re.test((node.textContent ?? '').trim()),
    )
    if (!el) return false
    el.scrollIntoView({ block: 'center' })
    return true
  }, pattern.source ?? pattern)
  if (!found) throw new Error(`nothing on the page matching ${pattern}`)
  await sleep(500)
}

async function shot(page, name) {
  const path = join(OUT, `${name}.${FORMAT}`)
  await page.screenshot({ path, type: FORMAT, quality: QUALITY })
  const { size } = await stat(path)
  console.log(`  ${path}  ${(size / 1024).toFixed(0)} kB`)
}

/** Type into the nth input on the page. */
async function fillInputs(page, values) {
  const inputs = await page.$$('input')
  for (const [index, value] of values.entries()) {
    const input = inputs[index]
    if (!input) throw new Error(`No input at index ${index}`)
    await input.click({ clickCount: 3 })
    await input.type(value)
  }
}

/**
 * Walk the first-run account setup.
 *
 * The app is gated behind a sign-in, so there is no way to reach any screen
 * without creating an account first. Driving the real flow rather than writing
 * a session straight into IndexedDB keeps the screenshots honest: if the gate
 * breaks, the screenshot run breaks with it.
 */
async function createFirstAccount(page) {
  // name, PIN, confirm PIN. 4729 passes the policy; 1234 deliberately does not.
  await fillInputs(page, ['Dr Ranaivo', '4729', '4729'])
  await clickText(page, 'button', /create account/)
  await page.waitForSelector('main', { timeout: 15_000 })
  await sleep(700)
}

/**
 * Navigate, signing back in if the lock screen is in the way.
 *
 * The session is held in memory on purpose, so every full page load lands on
 * the lock screen. Rather than special-casing that at twenty call sites, all
 * navigation goes through here.
 */
async function visit(page, url) {
  await page.goto(url, { waitUntil: 'networkidle2' })
  await settle(page)
  await unlockIfNeeded(page)
}

async function unlockIfNeeded(page) {
  // The lock screen has two forms and only one of them can be unlocked: before
  // any account exists it shows first-run setup, which has no keypad. Keying on
  // the Unlock button rather than on `[data-lock]` tells them apart.
  const locked = await page.evaluate(() =>
    [...document.querySelectorAll('button')].some(
      (b) => (b.textContent ?? '').trim().toLowerCase() === 'unlock',
    ),
  )
  if (!locked) return
  for (const digit of '4729') {
    await page.evaluate((d) => {
      const key = [...document.querySelectorAll('button')].find(
        (b) => b.textContent?.trim() === d,
      )
      key?.click()
    }, digit)
  }
  await clickText(page, 'button', /^unlock$/)
  await page.waitForSelector('main', { timeout: 15_000 })
  await sleep(700)
}

/** Click the first element whose text matches, and wait for the app to settle. */
async function clickText(page, selector, pattern) {
  const handle = await page.evaluateHandle(
    (sel, src) => {
      const re = new RegExp(src, 'i')
      // Trimmed, because JSX routinely leaves whitespace inside an element and
      // an anchored pattern like /^unlock$/ then matches nothing at all.
      return (
        [...document.querySelectorAll(sel)].find((el) => re.test((el.textContent ?? '').trim())) ??
        null
      )
    },
    selector,
    pattern.source ?? pattern,
  )
  const element = handle.asElement()
  if (!element) throw new Error(`No ${selector} matching ${pattern}`)
  await element.click()
  await settle(page)
}

async function main() {
  const executablePath = await findChrome()
  console.log(`chromium: ${executablePath}`)
  // Start clean so a renamed or retired shot cannot linger and keep being
  // served by a README that no longer references it.
  await rm(OUT, { recursive: true, force: true })
  await mkdir(OUT, { recursive: true })

  await detectPacks()
  if (packsPresent) {
    console.log(`speech pack: found in ${SERVED}/models, capturing both configurations`)
  } else {
    console.warn(
      `\nWARNING: no speech pack in ${SERVED}/models.\n` +
        '  The dictation screenshots will show the browser recogniser sending audio\n' +
        '  off the device, which is the fallback and not the recommended deployment.\n' +
        '  Run `npm run vendor:whisper && npm run build` first for the shots the\n' +
        '  README and the demo video actually want.\n',
    )
  }

  const browser = await puppeteer.launch({
    executablePath,
    headless: true,
    args: [
      '--hide-scrollbars',
      '--force-color-profile=srgb',
      '--font-render-hinting=none',
      ...LAUNCH_ARGS,
    ],
  })

  try {
    const page = await browser.newPage()

    // Pin the interface language so the images do not follow whatever the
    // machine building them happens to be set to.
    await page.evaluateOnNewDocument(() => localStorage.setItem('afyacore.lang', 'en'))

    // --- Create the facility administrator, then seed the demo workspace.
    // IndexedDB persists across navigations; the session does not, because it
    // is held in memory on purpose, so a full page load signs the account out
    // and every later navigation has to sign back in.
    await page.setViewport(DESKTOP)
    await visit(page, BASE)
    await createFirstAccount(page)

    await visit(page, `${BASE}/reports`)
    await clickText(page, 'button', /load demo/)

    // The lock screen, on mobile, where staff actually meet it. Taken before
    // the desktop pass so the session is still signed out from the seed
    // navigation and the sign-in form is genuinely on screen.
    console.log('security:')
    await page.setViewport(MOBILE)
    await page.goto(BASE, { waitUntil: 'networkidle2' })
    await settle(page)
    await shot(page, 'mobile-lock')

    console.log('desktop:')
    await page.setViewport(DESKTOP)
    await visit(page, BASE)
    await shot(page, 'desktop-today')

    await visit(page, `${BASE}/patients`)
    await shot(page, 'desktop-roster')

    await visit(page, `${BASE}/reports`)
    await shot(page, 'desktop-settings')

    // The reporting controls live below the fold on a 900px viewport, so the
    // shot above shows storage and model settings and none of the thing the
    // page is named for. Scroll to them and take a second frame: the monthly
    // DHIS2 return and the de-identified research export are the two exports
    // a ministry and an ethics committee respectively ask about.
    await scrollTo(page, /monthly report/i)
    await shot(page, 'desktop-reports')

    console.log('mobile:')
    await page.setViewport(MOBILE)

    await visit(page, BASE)
    await shot(page, 'mobile-today')

    await visit(page, `${BASE}/patients`)
    await shot(page, 'mobile-roster')

    // Walk the clinical path by clicking, the same way a person would, so the
    // ids in the URLs stay whatever the seed happened to generate.
    await clickText(page, 'a[href^="/patient/"]', /RAKOTOARISOA/)
    await shot(page, 'mobile-patient')

    await clickText(page, 'a[href*="/review"]', /paludisme|malaria/)
    await shot(page, 'mobile-review')

    await visit(page, `${page.url().replace('/review', '/instructions')}`)
    await shot(page, 'mobile-instructions')

    /*
     * The dictation panel, in both configurations it actually ships in.
     *
     * With the speech model installed, transcription happens on the device and
     * the panel says so. Without it, the browser's recogniser sends audio to a
     * third party, so the microphone is not offered until somebody accountable
     * says that is acceptable.
     *
     * `mobile-encounter` is the first of those, because it is the configuration
     * this project recommends and the one the demo video shows. It used to be
     * the second, captured by clicking through the disclosure, and that asset
     * went on being used after the model landed — so the video's dictation beat
     * showed the app warning that audio leaves the device in the same breath as
     * claiming it does not. Naming the two shots apart is what stops that
     * recurring.
     */
    const draft = async () => {
      await visit(page, `${BASE}/patients`)
      await clickText(page, 'a[href^="/patient/"]', /ANDRIANJAFY/)
      await clickText(page, 'button', /new consultation/)
    }

    if (await hidePacks()) {
      try {
        await draft()
        // Captured before it is dismissed, because it is the control and not
        // an interruption.
        await shot(page, 'mobile-dictation-disclosure')
        await clickText(page, 'button', /understood|compris|azoko/)
        await shot(page, 'mobile-encounter-remote')
      } finally {
        await restorePacks()
      }
    }

    await draft()
    await shot(page, 'mobile-encounter')
    await assertDictation(page, packsPresent ? /does not leave/i : /audio leaves/i)
  } finally {
    await restorePacks()
    await browser.close()
  }
}

main().catch((error) => {
  console.error(`\nscreenshots failed: ${error.message}`)
  console.error(`Is the app running at ${BASE}?  npm run preview`)
  process.exit(1)
})

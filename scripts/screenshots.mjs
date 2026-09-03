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
import { mkdir, access, stat, rm } from 'node:fs/promises'
import { join } from 'node:path'
import puppeteer from 'puppeteer-core'
import { findChrome } from './find-chrome.mjs'

const BASE = process.env.AFYACORE_URL ?? 'http://localhost:4173'
const OUT = 'docs/screenshots'


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

  const browser = await puppeteer.launch({
    executablePath,
    headless: true,
    args: [
      '--hide-scrollbars',
      '--force-color-profile=srgb',
      '--font-render-hinting=none',
      // Chromium refuses to start as root with its sandbox on. That is the
      // normal situation inside a CI container and nowhere else, so the flag is
      // added only in that case rather than being on by default.
      ...(process.getuid?.() === 0 ? ['--no-sandbox'] : []),
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

    // A fresh draft, to show the capture screen with the dictation panel.
    await visit(page, `${BASE}/patients`)
    await clickText(page, 'a[href^="/patient/"]', /ANDRIANJAFY/)
    await clickText(page, 'button', /new consultation/)

    // The disclosure is the honest first state of this screen: the browser's
    // dictation sends audio to a third party, so the microphone is not offered
    // until somebody accountable says that is acceptable. Captured before it
    // is dismissed, because it is the control and not an interruption.
    await shot(page, 'mobile-dictation-disclosure')

    // Then the working screen, which is what a clinician sees every day after
    // the one-time acknowledgement.
    await clickText(page, 'button', /understood|compris|azoko/)
    await shot(page, 'mobile-encounter')
  } finally {
    await browser.close()
  }
}

main().catch((error) => {
  console.error(`\nscreenshots failed: ${error.message}`)
  console.error(`Is the app running at ${BASE}?  npm run preview`)
  process.exit(1)
})

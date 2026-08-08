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

const BASE = process.env.AFYACORE_URL ?? 'http://localhost:4173'
const OUT = 'docs/screenshots'

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter(Boolean)

async function findChrome() {
  for (const path of CHROME_CANDIDATES) {
    try {
      await access(path)
      return path
    } catch {
      // try the next candidate
    }
  }
  throw new Error(
    `No Chromium found. Set CHROME_PATH to a Chrome/Brave/Chromium binary.\nTried:\n  ${CHROME_CANDIDATES.join('\n  ')}`,
  )
}

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

/** Wait for the app to stop animating so shots are not caught mid-transition. */
async function settle(page) {
  await page.waitForSelector('main', { timeout: 15_000 })
  await sleep(700)
}

async function shot(page, name) {
  const path = join(OUT, `${name}.${FORMAT}`)
  await page.screenshot({ path, type: FORMAT, quality: QUALITY })
  const { size } = await stat(path)
  console.log(`  ${path}  ${(size / 1024).toFixed(0)} kB`)
}

/** Click the first element whose text matches, and wait for the app to settle. */
async function clickText(page, selector, pattern) {
  const handle = await page.evaluateHandle(
    (sel, src) => {
      const re = new RegExp(src, 'i')
      return [...document.querySelectorAll(sel)].find((el) => re.test(el.textContent ?? '')) ?? null
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
    args: ['--hide-scrollbars', '--force-color-profile=srgb', '--font-render-hinting=none'],
  })

  try {
    const page = await browser.newPage()

    // Pin the interface language so the images do not follow whatever the
    // machine building them happens to be set to.
    await page.evaluateOnNewDocument(() => localStorage.setItem('afyacore.lang', 'en'))

    // --- Seed the demo workspace once; IndexedDB persists across navigations.
    await page.setViewport(DESKTOP)
    await page.goto(BASE, { waitUntil: 'networkidle2' })
    await settle(page)
    await clickText(page, 'button', /load demo/)

    console.log('desktop:')
    await page.goto(BASE, { waitUntil: 'networkidle2' })
    await settle(page)
    await shot(page, 'desktop-today')

    await page.goto(`${BASE}/patients`, { waitUntil: 'networkidle2' })
    await settle(page)
    await shot(page, 'desktop-roster')

    await page.goto(`${BASE}/reports`, { waitUntil: 'networkidle2' })
    await settle(page)
    await shot(page, 'desktop-settings')

    console.log('mobile:')
    await page.setViewport(MOBILE)

    await page.goto(BASE, { waitUntil: 'networkidle2' })
    await settle(page)
    await shot(page, 'mobile-today')

    await page.goto(`${BASE}/patients`, { waitUntil: 'networkidle2' })
    await settle(page)
    await shot(page, 'mobile-roster')

    // Walk the clinical path by clicking, the same way a person would, so the
    // ids in the URLs stay whatever the seed happened to generate.
    await clickText(page, 'a[href^="/patient/"]', /RAKOTOARISOA/)
    await shot(page, 'mobile-patient')

    await clickText(page, 'a[href*="/review"]', /paludisme|malaria/)
    await shot(page, 'mobile-review')

    await page.goto(`${page.url().replace('/review', '/instructions')}`, { waitUntil: 'networkidle2' })
    await settle(page)
    await shot(page, 'mobile-instructions')

    // A fresh draft, to show the capture screen with the dictation panel.
    await page.goto(`${BASE}/patients`, { waitUntil: 'networkidle2' })
    await settle(page)
    await clickText(page, 'a[href^="/patient/"]', /ANDRIANJAFY/)
    await clickText(page, 'button', /new consultation/)
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

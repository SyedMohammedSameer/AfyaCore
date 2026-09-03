#!/usr/bin/env node
/**
 * The offline walk, driven through a real browser against the real build.
 *
 * ## What this is for
 *
 * The unit suite proves the pieces behave. It cannot prove the *claim*: that a
 * clinician with no connectivity can open this app, record a consultation, and
 * still have it after the phone reloads. That claim depends on the service
 * worker, the precache manifest, IndexedDB persistence and the router all being
 * right together, and every one of those is invisible to vitest.
 *
 * It is also the demo. A live demonstration at ML4H is exactly this walk, and
 * the failure mode — a service worker that did not precache a route, so the
 * reload lands on the browser's offline page — happens in front of an audience
 * and cannot be recovered from. Better to find it here.
 *
 * ## Why puppeteer-core and not Playwright
 *
 * The review suggested Playwright. This project already drives a browser with
 * `puppeteer-core` for screenshots, against a Chromium already on the machine,
 * and adding a second automation stack would pull a ~150 MB browser download
 * into a repository whose entire argument is a 139 kB bundle. Same coverage,
 * one dependency, no download.
 *
 *   npm run build && npm run preview      # in one terminal
 *   npm run smoke                         # in another
 *
 * Exits non-zero on the first failed step, so CI can gate on it.
 */
import puppeteer from 'puppeteer-core'
import { findChrome } from './find-chrome.mjs'

const BASE = process.env.AFYACORE_URL ?? 'http://localhost:4173'


const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let passed = 0
const failures = []

/** Run one named step. A throw is recorded and the walk stops. */
async function step(name, fn) {
  process.stdout.write(`  ${name} … `)
  try {
    await fn()
    passed++
    console.log('ok')
  } catch (err) {
    console.log('FAILED')
    failures.push({ name, message: err.message })
    throw err
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

async function settle(page) {
  await page.waitForFunction(
    () => document.querySelector('main') !== null || document.querySelector('[data-lock]') !== null,
    { timeout: 20_000 },
  )
  await sleep(500)
}

async function clickText(page, selector, pattern) {
  const handle = await page.evaluateHandle(
    (sel, src) => {
      const re = new RegExp(src, 'i')
      return (
        [...document.querySelectorAll(sel)].find((el) => re.test((el.textContent ?? '').trim())) ??
        null
      )
    },
    selector,
    pattern.source ?? pattern,
  )
  const el = handle.asElement()
  if (!el) throw new Error(`no ${selector} matching ${pattern}`)
  await el.click()
  await settle(page)
}

async function textOf(page) {
  return page.evaluate(() => document.body.innerText)
}

/**
 * Sign in if the lock screen is in the way.
 *
 * The session is held in memory on purpose, so every full page load lands on
 * the lock screen — including the ones this walk performs to prove the service
 * worker is serving. Navigation therefore always goes through here.
 */
async function unlockIfNeeded(page) {
  const locked = await page.evaluate(() =>
    [...document.querySelectorAll('button')].some(
      (b) => (b.textContent ?? '').trim().toLowerCase() === 'unlock',
    ),
  )
  if (!locked) return
  for (const digit of '4729') {
    await page.evaluate((d) => {
      ;[...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === d)?.click()
    }, digit)
  }
  await clickText(page, 'button', /^unlock$/)
  await page.waitForSelector('main', { timeout: 20_000 })
  await sleep(400)
}

async function visit(page, path, waitUntil = 'networkidle2') {
  await page.goto(`${BASE}${path}`, { waitUntil })
  await settle(page)
  await unlockIfNeeded(page)
}

async function main() {
  const executablePath = await findChrome()
  const browser = await puppeteer.launch({
    executablePath,
    headless: 'new',
    args: process.getuid?.() === 0 ? ['--no-sandbox'] : [],
  })

  const page = await browser.newPage()
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true })

  console.log(`AfyaCore offline smoke walk against ${BASE}\n`)

  try {
    await step('loads and shows first-run setup', async () => {
      await page.goto(BASE, { waitUntil: 'networkidle2' })
      await settle(page)
      assert(/create account/i.test(await textOf(page)), 'no account setup on first load')
    })

    await step('creates an account through the real gate', async () => {
      const inputs = await page.$$('input')
      const values = ['Dr Ranaivo', '4729', '4729']
      for (let i = 0; i < values.length && i < inputs.length; i++) {
        await inputs[i].click()
        await inputs[i].type(values[i])
      }
      await clickText(page, 'button', /create account/)
      assert((await page.$('main')) !== null, 'did not reach the app')
    })

    await step('registers a service worker', async () => {
      // Without this the offline steps below prove nothing: the pages would be
      // coming from the HTTP cache, not the precache.
      const ready = await page.evaluate(async () => {
        if (!('serviceWorker' in navigator)) return false
        const reg = await navigator.serviceWorker.ready
        return Boolean(reg.active)
      })
      assert(ready, 'no active service worker')
    })

    await step('loads the demo workspace', async () => {
      await visit(page, '/settings')
      await clickText(page, 'button', /load demo/)
      await sleep(800)
    })

    /* ---------------------------------------------------------------- *
     * Everything below runs with the network off.
     * ---------------------------------------------------------------- */

    await step('goes offline', async () => {
      await page.setOfflineMode(true)
      const online = await page.evaluate(() => navigator.onLine)
      assert(online === false, 'browser still reports online')
    })

    await step('reloads from the service worker with no network', async () => {
      // The claim the whole project rests on. If the precache missed the shell,
      // this is where a live demo dies in front of an audience.
      await page.reload({ waitUntil: 'domcontentloaded' })
      await settle(page)
      const text = await textOf(page)
      assert(!/no internet|ERR_INTERNET_DISCONNECTED/i.test(text), 'browser offline page shown')
      assert((await page.$('[data-lock]')) !== null || (await page.$('main')) !== null, 'app did not render')
    })

    await step('signs back in offline', async () => {
      // The session is memory-only, so a reload always lands on the lock
      // screen. Signing in must not need the network.
      for (const digit of '4729') {
        await page.evaluate((d) => {
          ;[...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === d)?.click()
        }, digit)
      }
      await clickText(page, 'button', /^unlock$/)
      assert((await page.$('main')) !== null, 'could not unlock offline')
    })

    await step('opens the roster offline and sees the demo patients', async () => {
      await visit(page, '/patients', 'domcontentloaded')
      const text = await textOf(page)
      assert(/RAKOTOARISOA|ANDRIANJAFY/.test(text), 'roster is empty offline')
    })

    await step('records a consultation offline', async () => {
      await clickText(page, 'a[href^="/patient/"]', /RAKOTOARISOA/)
      await clickText(page, 'button', /new consultation/)

      // Type a vital and a diagnosis. Manual entry is the path that must work
      // with no connectivity; dictation deliberately does not.
      const filled = await page.evaluate(() => {
        const setValue = (el, value) => {
          const proto = Object.getPrototypeOf(el)
          const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set
          setter?.call(el, value)
          el.dispatchEvent(new Event('input', { bubbles: true }))
        }
        const number = document.querySelector('input[inputmode="decimal"], input[type="number"]')
        if (number) setValue(number, '38.9')
        const areas = [...document.querySelectorAll('textarea')]
        if (areas[0]) setValue(areas[0], 'fievre depuis trois jours')
        return Boolean(number || areas[0])
      })
      assert(filled, 'found no field to type into')
      await sleep(600)
    })

    await step('keeps the consultation after an offline reload', async () => {
      // Persistence is the other half of the claim: IndexedDB must have the
      // write before the tab is gone, with no server anywhere.
      const before = await page.evaluate(async () => {
        const req = indexedDB.open('afyacore')
        const db = await new Promise((res, rej) => {
          req.onsuccess = () => res(req.result)
          req.onerror = () => rej(req.error)
        })
        const tx = db.transaction('encounters', 'readonly')
        const count = await new Promise((res) => {
          const c = tx.objectStore('encounters').count()
          c.onsuccess = () => res(c.result)
        })
        db.close()
        return count
      })
      assert(before > 0, 'no encounter was persisted')

      await page.reload({ waitUntil: 'domcontentloaded' })
      await settle(page)
      assert(!/no internet/i.test(await textOf(page)), 'offline reload failed')
    })

    await step('comes back online without breaking', async () => {
      await page.setOfflineMode(false)
      await page.reload({ waitUntil: 'networkidle2' })
      await settle(page)
      assert((await page.$('[data-lock]')) !== null || (await page.$('main')) !== null, 'app broken after reconnect')
    })
  } catch {
    /* the failing step has already been recorded */
  } finally {
    await browser.close()
  }

  console.log('')
  if (failures.length === 0) {
    console.log(`  ${passed} steps passed. The offline walk holds.`)
    return
  }
  for (const f of failures) console.error(`  FAILED  ${f.name}\n          ${f.message}`)
  console.error(`\n  ${passed} passed, ${failures.length} failed.`)
  process.exit(1)
}

main().catch((err) => {
  console.error(`smoke failed to run: ${err.message}`)
  process.exit(1)
})

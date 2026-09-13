#!/usr/bin/env node
/**
 * Render the ML4H spec sheet to PDF with the same browser every other script
 * here uses, so the two-page limit is checked by the thing that will be read.
 *
 *   node scripts/spec-pdf.mjs      # writes docs/ml4h/AfyaCore-ML4H-2026-spec-sheet.pdf
 */
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import puppeteer from 'puppeteer-core'
import { findChrome, LAUNCH_ARGS } from './find-chrome.mjs'

const src = resolve('docs/ml4h/spec-sheet.html')
const out = resolve('docs/ml4h/AfyaCore-ML4H-2026-spec-sheet.pdf')

const browser = await puppeteer.launch({ executablePath: await findChrome(), headless: 'new', args: LAUNCH_ARGS })
try {
  const page = await browser.newPage()
  await page.goto(pathToFileURL(src).href, { waitUntil: 'networkidle0' })
  await page.pdf({ path: out, format: 'A4', printBackground: true, preferCSSPageSize: true })
  console.log(`wrote ${out}`)
} finally {
  await browser.close()
}

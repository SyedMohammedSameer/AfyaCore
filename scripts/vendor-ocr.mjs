#!/usr/bin/env node
/**
 * Vendor the OCR runtime into `public/ocr/` so it is served from our own origin.
 *
 * tesseract.js defaults to loading its worker, WASM core and language model from
 * a public CDN. That is wrong for this deployment twice over: a facility on a
 * weak or filtered connection may not reach the CDN at all, and a service worker
 * cannot reliably cache an opaque cross-origin response, so OCR would appear to
 * work in testing and fail in a village.
 *
 * These files are large (~7 MB) and are therefore NOT committed. They are copied
 * out of node_modules at build time, and the language model is fetched once and
 * cached in `.cache/`. Run automatically by `npm run build`.
 */
import { copyFile, mkdir, access, stat } from 'node:fs/promises'
import { createWriteStream } from 'node:fs'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, 'public', 'ocr')
const cacheDir = join(root, '.cache')

// French only. Malagasy has no Tesseract model, and the paper records this
// reads are written in French, see docs/MODEL-RESEARCH.md §1.
const LANG = 'fra'
const LANG_URL = `https://raw.githubusercontent.com/naptha/tessdata/gh-pages/4.0.0_fast/${LANG}.traineddata.gz`

/**
 * LSTM-only cores (the smallest that still do modern recognition), in all three
 * SIMD flavours. tesseract.js feature-detects at runtime and downloads exactly
 * one of them, so this costs server disk but never client bandwidth.
 */
const CORE_VARIANTS = [
  'tesseract-core-relaxedsimd-lstm',
  'tesseract-core-simd-lstm',
  'tesseract-core-lstm',
]

const COPIES = [
  ['tesseract.js/dist/worker.min.js', 'worker.min.js'],
  ...CORE_VARIANTS.flatMap((v) => [
    [`tesseract.js-core/${v}.wasm.js`, `${v}.wasm.js`],
    [`tesseract.js-core/${v}.wasm`, `${v}.wasm`],
  ]),
]

async function exists(p) {
  try {
    await access(p)
    return true
  } catch {
    return false
  }
}

async function main() {
  await mkdir(outDir, { recursive: true })
  await mkdir(cacheDir, { recursive: true })

  for (const [from, to] of COPIES) {
    const src = join(root, 'node_modules', from)
    if (!(await exists(src))) {
      console.warn(`  skip  ${to} (not installed)`)
      continue
    }
    await copyFile(src, join(outDir, to))
    const { size } = await stat(join(outDir, to))
    console.log(`  copy  ${to} (${(size / 1e6).toFixed(1)} MB)`)
  }

  const langFile = `${LANG}.traineddata.gz`
  const cached = join(cacheDir, langFile)
  if (!(await exists(cached))) {
    console.log(`  fetch ${langFile}…`)
    const res = await fetch(LANG_URL)
    if (!res.ok || !res.body) throw new Error(`Failed to fetch ${LANG_URL}: HTTP ${res.status}`)
    await pipeline(Readable.fromWeb(res.body), createWriteStream(cached))
  }
  await copyFile(cached, join(outDir, langFile))
  const { size } = await stat(join(outDir, langFile))
  console.log(`  copy  ${langFile} (${(size / 1e6).toFixed(2)} MB)`)

  console.log('OCR runtime vendored to public/ocr/')
}

main().catch((err) => {
  console.error('vendor-ocr failed:', err.message)
  // A build without OCR assets is still a working app: the feature degrades to
  // "photo stored, text not read" rather than taking the whole build down.
  process.exitCode = 0
})

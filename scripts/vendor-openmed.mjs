#!/usr/bin/env node
/**
 * Vendor the OpenMed French PII model into `public/models/openmed-pii-fr/`.
 *
 * Same reasoning as `vendor-ocr.mjs`, and the same conclusion: the model is
 * served from our own origin rather than from huggingface.co. A facility on a
 * weak or filtered connection may not reach the Hub, and a service worker
 * cannot reliably cache an opaque cross-origin response, so on-device
 * de-identification would pass testing and fail in a village.
 *
 * Unlike the OCR pack, this is **not** part of `npm run build`. It is ~70 MB and
 * the neural pass is an opt-in accuracy upgrade over a deterministic scrub that
 * already covers the common case, so a facility that never runs this loses
 * nothing except recall on identifiers the roster does not hold. Making it a
 * build step would also mean the build fails wherever the Hub is unreachable.
 *
 *   npm run vendor:openmed
 *
 * Model: OpenMed/OpenMed-PII-French-ClinicalE5-Small-33M-v1-onnx-android
 * 33M parameters, BERT (12 layers, hidden 384), Apache-2.0, French clinical PII.
 * See docs/MODEL-RESEARCH.md §4b for why this one and not the others.
 */
import { mkdir, access, stat, copyFile, writeFile } from 'node:fs/promises'
import { createWriteStream } from 'node:fs'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, 'public', 'models', 'openmed-pii-fr')
const cacheDir = join(root, '.cache', 'openmed')

const REPO = 'OpenMed/OpenMed-PII-French-ClinicalE5-Small-33M-v1-onnx-android'

const ortDir = join(root, 'public', 'ort')

/**
 * The ONNX Runtime WebAssembly core, copied out of node_modules.
 *
 * transformers.js otherwise pulls this from a CDN at first inference, which
 * fails for the same two reasons the OCR runtime is vendored: an unreachable
 * CDN, and a service worker that cannot cache an opaque cross-origin response.
 *
 * Only the plain SIMD-threaded build is copied. The `jsep` variant is the
 * WebGPU path at 25 MB, and this model runs on CPU on the phones this targets;
 * `asyncify` and `jspi` are alternative suspension mechanisms we do not use.
 * Taking one of the four keeps this at 13 MB rather than 75 MB.
 */
const ORT_FILES = ['ort-wasm-simd-threaded.wasm', 'ort-wasm-simd-threaded.mjs']
const BASE = `https://huggingface.co/${REPO}/resolve/main`

/**
 * transformers.js expects the graph under `onnx/`, whereas the OpenMed repo
 * publishes it at the root, so the download is rearranged rather than mirrored.
 *
 * **int8, not fp16.** This repo ships four graphs and the model card is
 * explicit about which runtime each is for: `model_int8.onnx` is the "CPU,
 * WebAssembly, and Android default", `model_fp16.onnx` is for "WebGPU and
 * compatible accelerated runtimes". We serve the plain SIMD-threaded ONNX
 * Runtime core and deliberately do *not* ship the 25 MB `jsep` build, so there
 * is no WebGPU path here by construction — pairing the WebGPU graph with a
 * WASM-only runtime was asking the one combination the publisher tells you not
 * to use. transformers.js agrees independently: its own default dtype for the
 * `wasm` device is a quantised graph (`utils/dtypes.js`).
 *
 * This reverses an earlier decision that took fp16 because int8 is, oddly, the
 * *larger* download here — 69.6 MB against 66.8 MB, because the embedding table
 * stays at higher precision. That was a real observation and the wrong call:
 * 2.8 MB of bandwidth is not worth running off the supported path, and a
 * download the runtime cannot use costs 66.8 MB rather than saving anything.
 *
 * Named `model_int8.onnx` on the transformers.js side so the `dtype: 'int8'`
 * selection in src/lib/openmed.ts resolves to it.
 */
const FILES = [
  ['config.json', 'config.json', 4503],
  ['tokenizer.json', 'tokenizer.json', 711661],
  ['tokenizer_config.json', 'tokenizer_config.json', 499],
  ['model_int8.onnx', 'onnx/model_int8.onnx', 69626378],
]

const exists = (p) =>
  access(p).then(
    () => true,
    () => false,
  )

const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`

/**
 * Sizes are asserted, not trusted.
 *
 * These are LFS objects behind a redirect to a CDN. A captive portal, a
 * filtering proxy or an expired signed URL can all answer 200 with a page of
 * HTML, and `fetch` will follow the redirect and write it out perfectly
 * happily. The failure then surfaces much later as an opaque ONNX parse error
 * inside a browser, on someone else's machine. A byte count taken from the Hub
 * listing turns that into a clear failure here, before anything is cached.
 */
async function download(remote, cachePath, expectedSize) {
  const check = (size, where) => {
    if (expectedSize && size !== expectedSize) {
      throw new Error(
        `${remote}: expected ${expectedSize} bytes, ${where} has ${size}. ` +
          `Delete .cache/openmed and retry; if it persists, the Hub listing may have moved.`,
      )
    }
  }

  if (await exists(cachePath)) {
    const { size } = await stat(cachePath)
    check(size, 'the cached copy')
    console.log(`  cached  ${remote.padEnd(22)} ${mb(size)}`)
    return
  }

  const url = `${BASE}/${remote}`
  process.stdout.write(`  fetch   ${remote.padEnd(22)} `)

  const response = await fetch(url)
  if (!response.ok || !response.body) {
    throw new Error(`${url} -> HTTP ${response.status}`)
  }

  // Streamed to a temporary name and renamed only on success, so an
  // interrupted download can never be mistaken for a cached one on the next
  // run. A half-written ONNX graph fails at load time with an opaque error.
  const partial = `${cachePath}.partial`
  await mkdir(dirname(cachePath), { recursive: true })
  await pipeline(Readable.fromWeb(response.body), createWriteStream(partial))
  const { size } = await stat(partial)
  try {
    check(size, 'the download')
  } catch (err) {
    // Never promote a bad download into the cache: the next run would report
    // it as `cached` and the error would look like a different problem.
    const { rm } = await import('node:fs/promises')
    await rm(partial, { force: true })
    throw err
  }
  await copyFile(partial, cachePath)
  const { rm } = await import('node:fs/promises')
  await rm(partial, { force: true })
  console.log(mb(size))
}

async function main() {
  console.log(`vendoring ${REPO}\n`)
  await mkdir(outDir, { recursive: true })

  let total = 0
  for (const [remote, local, expectedSize] of FILES) {
    const cachePath = join(cacheDir, remote)
    await download(remote, cachePath, expectedSize)
    const target = join(outDir, local)
    await mkdir(dirname(target), { recursive: true })
    await copyFile(cachePath, target)
    total += (await stat(target)).size
  }

  /**
   * A provenance file next to the weights.
   *
   * The export manifest names the model; this lets somebody holding the
   * deployment check that the files actually present are the ones claimed,
   * which is the sort of thing a data-protection review asks for and nobody
   * can answer from a directory of .onnx files.
   */
  await writeFile(
    join(outDir, 'PROVENANCE.json'),
    `${JSON.stringify(
      {
        repo: REPO,
        source: `https://huggingface.co/${REPO}`,
        licence: 'Apache-2.0',
        paper: 'https://arxiv.org/abs/2508.01630',
        vendoredAt: new Date().toISOString(),
        files: FILES.map(([, local]) => local),
        graph: 'int8 (CPU/WebAssembly path, per the model card)',
      },
      null,
      2,
    )}\n`,
  )

  // --- ONNX Runtime core
  console.log('')
  await mkdir(ortDir, { recursive: true })
  for (const file of ORT_FILES) {
    const from = join(root, 'node_modules', 'onnxruntime-web', 'dist', file)
    if (!(await exists(from))) {
      throw new Error(
        `${file} not found in node_modules. Run: npm install -D @huggingface/transformers`,
      )
    }
    const to = join(ortDir, file)
    await copyFile(from, to)
    const { size } = await stat(to)
    total += size
    console.log(`  copy    ${file.padEnd(34)} ${mb(size)}`)
  }

  console.log(`\n  total   ${mb(total)} -> public/models/ + public/ort/`)
  console.log('\nNot committed. Re-run after a clean checkout; downloads are cached in .cache/.')
}

main().catch((err) => {
  console.error(`\nvendor-openmed failed: ${err.message}`)
  console.error(
    '\nThe neural de-identification pass is optional. Without it the deterministic\n' +
      'scrub still runs, which is the shipped default; see docs/MODEL-RESEARCH.md §4b.',
  )
  process.exit(1)
})

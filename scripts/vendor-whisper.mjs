#!/usr/bin/env node
/**
 * Vendor a Whisper speech model into `public/models/whisper-<size>/`.
 *
 * ## Why this exists
 *
 * It closes the last hole in the offline claim, and it is the only one that
 * was a disclosure rather than an inconvenience.
 *
 * The browser's Web Speech API streams captured audio to the vendor's
 * recognition service. A clinician dictating a consultation therefore sends
 * the patient's name, complaint and diagnosis, in their own voice, to a
 * company the facility has no relationship with; voice is biometric data under
 * several of the regimes in docs/COMPLIANCE.md §5. `src/lib/dictation.ts`
 * gates that behind an audited acknowledgement, which makes it honest but does
 * not make it stop.
 *
 * With this pack installed, dictation runs on the device and there is nothing
 * to disclose. The gate stays, because a facility that declines the download
 * still needs it, but it stops being the normal path.
 *
 *   npm run vendor:whisper           # base, multilingual, ~81 MB
 *   npm run vendor:whisper -- tiny   # ~45 MB, materially less accurate
 *
 * ## Which model
 *
 * **Multilingual, not `.en`.** Five of the nine country profiles document in
 * French and the rest in English, and the same build serves both, so an
 * English-only model would be wrong half the time it was used.
 *
 * **`base` by default, not `tiny`.** Whisper's word error rate on French
 * roughly halves from tiny to base, and the failure mode of a speech model in
 * this app is not an awkward sentence: it is a drug name or a dose transcribed
 * as something else. The extractor downstream reads figures out of the
 * transcript, so an error there lands in a clinical field. 36 MB more, once,
 * over a connection the facility already has, against every consultation
 * dictated afterwards.
 *
 * **Quantised (`q8`).** transformers.js already defaults to `q8` on the wasm
 * device, and we serve a wasm-only ONNX Runtime core deliberately, exactly as
 * for the de-identification model. The fp16 graphs are the WebGPU path and
 * pairing them with this runtime is the one combination not to use.
 *
 * ## Not part of the build
 *
 * Same reasoning as vendor-openmed.mjs. It is large, it is optional, and
 * making it a build step would break the build wherever the Hub is
 * unreachable — which includes the connections this project is about.
 */
import { mkdir, access, stat, copyFile, writeFile, rm } from 'node:fs/promises'
import { createWriteStream } from 'node:fs'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const ortDir = join(root, 'public', 'ort')

/**
 * Byte counts come from the Hub listing and are asserted, not trusted.
 *
 * These are LFS objects behind a redirect. A captive portal or a filtering
 * proxy answers 200 with a page of HTML, `fetch` follows the redirect and
 * writes it out happily, and the failure then surfaces as an opaque ONNX parse
 * error inside a browser on someone else's machine.
 */
const MODELS = {
  base: {
    repo: 'onnx-community/whisper-base',
    licence: 'Apache-2.0',
    files: [
      ['config.json', 2243],
      ['generation_config.json', 3832],
      ['preprocessor_config.json', 339],
      ['tokenizer.json', 2480466],
      ['tokenizer_config.json', 282682],
      ['special_tokens_map.json', 2194],
      ['added_tokens.json', 34604],
      ['vocab.json', 1036584],
      ['merges.txt', 493869],
      ['normalizer.json', 52666],
      ['onnx/encoder_model_quantized.onnx', 23201314],
      ['onnx/decoder_model_merged_quantized.onnx', 53693315],
    ],
  },
  tiny: {
    repo: 'Xenova/whisper-tiny',
    licence: 'Apache-2.0',
    files: [
      ['config.json', 2248],
      ['generation_config.json', 3716],
      ['preprocessor_config.json', 339],
      ['tokenizer.json', 2480466],
      ['tokenizer_config.json', 282683],
      ['special_tokens_map.json', 2194],
      ['added_tokens.json', 2082],
      ['vocab.json', 1036584],
      ['merges.txt', 493869],
      ['normalizer.json', 52666],
      ['onnx/encoder_model_quantized.onnx', 10124910],
      ['onnx/decoder_model_merged_quantized.onnx', 30727765],
    ],
  },
}

/**
 * The ONNX Runtime WebAssembly core, copied out of node_modules.
 *
 * Identical to vendor-openmed.mjs and idempotent, so running either script is
 * enough and running both is harmless. transformers.js otherwise pulls this
 * from a CDN at first inference, which fails for the two reasons every other
 * runtime here is vendored: an unreachable CDN, and a service worker that
 * cannot cache an opaque cross-origin response.
 */
const ORT_FILES = ['ort-wasm-simd-threaded.wasm', 'ort-wasm-simd-threaded.mjs']

const size = (process.argv[2] ?? 'base').toLowerCase()
const model = MODELS[size]
if (!model) {
  console.error(`unknown model "${size}". One of: ${Object.keys(MODELS).join(', ')}`)
  process.exit(1)
}

const outDir = join(root, 'public', 'models', `whisper-${size}`)
const cacheDir = join(root, '.cache', `whisper-${size}`)
const BASE = `https://huggingface.co/${model.repo}/resolve/main`

const exists = (p) =>
  access(p).then(
    () => true,
    () => false,
  )

const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`

async function download(remote, cachePath, expectedSize) {
  const check = (bytes, where) => {
    if (expectedSize && bytes !== expectedSize) {
      throw new Error(
        `${remote}: expected ${expectedSize} bytes, ${where} has ${bytes}. ` +
          `Delete .cache/whisper-${size} and retry; if it persists, the Hub listing may have moved.`,
      )
    }
  }

  if (await exists(cachePath)) {
    const { size: bytes } = await stat(cachePath)
    check(bytes, 'the cached copy')
    console.log(`  cached  ${remote.padEnd(42)} ${mb(bytes)}`)
    return
  }

  const url = `${BASE}/${remote}`
  process.stdout.write(`  fetch   ${remote.padEnd(42)} `)

  const response = await fetch(url)
  if (!response.ok || !response.body) throw new Error(`${url} -> HTTP ${response.status}`)

  // Streamed to a temporary name and renamed only on success, so an
  // interrupted download can never be mistaken for a cached one next run.
  const partial = `${cachePath}.partial`
  await mkdir(dirname(cachePath), { recursive: true })
  await pipeline(Readable.fromWeb(response.body), createWriteStream(partial))
  const { size: bytes } = await stat(partial)
  try {
    check(bytes, 'the download')
  } catch (err) {
    // Never promote a bad download into the cache: the next run would report
    // it as `cached` and the error would look like a different problem.
    await rm(partial, { force: true })
    throw err
  }
  await copyFile(partial, cachePath)
  await rm(partial, { force: true })
  console.log(mb(bytes))
}

async function main() {
  console.log(`vendoring ${model.repo} (whisper-${size})\n`)
  await mkdir(outDir, { recursive: true })

  let total = 0
  for (const [remote, expectedSize] of model.files) {
    const cachePath = join(cacheDir, remote)
    await download(remote, cachePath, expectedSize)
    const target = join(outDir, remote)
    await mkdir(dirname(target), { recursive: true })
    await copyFile(cachePath, target)
    total += (await stat(target)).size
  }

  /**
   * A provenance file next to the weights, for the same reason the
   * de-identification model has one: somebody holding the deployment can check
   * that the files present are the ones claimed, which a data-protection
   * review asks for and nobody can answer from a directory of .onnx files.
   */
  await writeFile(
    join(outDir, 'PROVENANCE.json'),
    `${JSON.stringify(
      {
        repo: model.repo,
        source: `https://huggingface.co/${model.repo}`,
        licence: model.licence,
        paper: 'https://arxiv.org/abs/2212.04356',
        vendoredAt: new Date().toISOString(),
        files: model.files.map(([remote]) => remote),
        graph: 'q8 (the transformers.js default for the wasm device)',
        purpose: 'On-device speech recognition, so dictated audio never leaves the device.',
      },
      null,
      2,
    )}\n`,
  )

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
    const { size: bytes } = await stat(to)
    total += bytes
    console.log(`  copy    ${file.padEnd(42)} ${mb(bytes)}`)
  }

  console.log(`\n  total   ${mb(total)} -> public/models/whisper-${size}/ + public/ort/`)
  console.log('\nNot committed. Re-run after a clean checkout; downloads are cached in .cache/.')
}

main().catch((err) => {
  console.error(`\nvendor-whisper failed: ${err.message}`)
  console.error(
    '\nOn-device dictation is optional. Without it the app falls back to the\n' +
      'browser recogniser, which sends audio off the device and stays behind the\n' +
      'disclosure gate in src/lib/dictation.ts; typing always works and never leaves.',
  )
  process.exit(1)
})

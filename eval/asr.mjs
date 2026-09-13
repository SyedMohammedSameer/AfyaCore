#!/usr/bin/env node
/**
 * Speech to fields, end to end, on the vendored model.
 *
 *   npm run eval:asr              # table
 *   npm run eval:asr -- --json    # machine-readable
 *
 * `npm run eval` scores the extractor on clean transcripts and has always
 * said so: those numbers bound the rules, not the recogniser. This harness
 * closes the gap that was left open. Each corpus case is spoken by a
 * text-to-speech voice, transcribed by the same Whisper pack the phone runs
 * (`public/models/whisper-base`, loaded through the same transformers.js
 * build), and the transcript is pushed through the same extractor and the
 * same scorer as the text harness. Two numbers come out of it:
 *
 *  - **Word error rate**, the conventional recogniser measure, reported raw.
 *    It is a pessimistic number here, because Whisper writes "38,5" where the
 *    reference says "trente-huit virgule cinq" and that scores as errors.
 *  - **Field F1 from speech**, which is the number that matters: how much of
 *    the consultation reaches structured fields correctly once the recogniser
 *    is in the loop, against the 100% the extractor gets on clean text.
 *
 * ## What this is, and is not
 *
 * A synthetic voice is not a clinician in a consultation room, and it is
 * tempting to call this an upper bound on field performance. It is not one,
 * in either direction. Text-to-speech removes the things that obviously make
 * recognition harder, meaning background noise, a queue at the door,
 * disfluency and accent, and it introduces a domain mismatch of its own,
 * because Whisper
 * was trained on human speech and a synthesiser is not one. It also
 * pronounces drug names the way a dictionary would rather than the way a
 * clinician does.
 *
 * So this is a controlled condition, reproducible on any machine with the
 * same two voices, that measures the one thing nothing else here measures:
 * what survives the whole pipeline, with the exact model files and code path
 * the phone runs. Before this harness the README said "unmeasured". A
 * controlled measurement whose conditions are stated is better than that,
 * and it is not a substitute for recordings of the people who would use it.
 *
 * Needs macOS `say` and `afconvert` for the voices, so it runs on a
 * developer's machine rather than in CI, and skips with a message rather
 * than failing anywhere they are absent. Audio is cached under `.cache/tts/`
 * and never committed.
 */
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { mkdir, readFile, readdir, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { confidenceBuckets, flagAnalysis, prf, reviewUnits, scoreExtraction, wordErrorRate } from './score.mjs'

const run = promisify(execFile)
const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const asJson = process.argv.includes('--json')
/**
 * `--prime`: hand Whisper the formulary as a text prompt before decoding.
 *
 * Whisper conditions on previous text, and the documented use of that is to
 * feed it vocabulary it would otherwise misspell. The prompt costs nothing
 * on the phone beyond a few dozen decoder tokens, and if it moves drug-name
 * recognition it belongs in the worker. Measured here first, because a
 * prompt can also make the model echo or invent, and that has to be seen in
 * the numbers rather than assumed away.
 */
const prime = process.argv.includes('--prime')

/** One voice per language, both shipped with macOS. */
const VOICES = { fr: 'Thomas', en: 'Daniel' }
const WHISPER_LANG = { fr: 'french', en: 'english' }
const RATE = 170

function skip(reason) {
  if (asJson) console.log(JSON.stringify({ skipped: reason }))
  else console.log(`\n  eval:asr skipped: ${reason}\n`)
  process.exit(0)
}

async function exists(path) {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

/** Speak a case once and keep the 16 kHz mono PCM it produced. */
async function synthesise(text, voice, cacheDir) {
  const key = createHash('sha1').update(`${voice}|${RATE}|${text}`).digest('hex').slice(0, 16)
  const wav = join(cacheDir, `${key}.wav`)
  if (await exists(wav)) return wav
  const aiff = join(cacheDir, `${key}.aiff`)
  await run('say', ['-v', voice, '-r', String(RATE), '-o', aiff, text])
  await run('afconvert', ['-f', 'WAVE', '-d', 'LEI16@16000', '-c', '1', aiff, wav])
  return wav
}

/** Minimal PCM16 WAV reader: enough for what afconvert writes. */
function wavToFloat32(buffer) {
  let offset = 12
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString('ascii', offset, offset + 4)
    const size = buffer.readUInt32LE(offset + 4)
    if (id === 'data') {
      const samples = Math.floor(size / 2)
      const out = new Float32Array(samples)
      for (let i = 0; i < samples; i++) out[i] = buffer.readInt16LE(offset + 8 + i * 2) / 32768
      return out
    }
    offset += 8 + size
  }
  throw new Error('no data chunk')
}

async function loadWhisper(modelRoot) {
  const { pipeline, env } = await import('@huggingface/transformers')
  env.allowRemoteModels = false
  env.allowLocalModels = true
  env.localModelPath = `${modelRoot}/`
  // Same graph and quantisation the worker loads (src/lib/asr.worker.ts).
  return pipeline('automatic-speech-recognition', 'whisper-base', { dtype: 'q8' })
}

async function main() {
  for (const tool of ['say', 'afconvert']) {
    try {
      await run('which', [tool])
    } catch {
      skip(`${tool} not found; the voices need macOS`)
    }
  }
  const modelRoot = join(root, 'public', 'models')
  if (!(await exists(join(modelRoot, 'whisper-base', 'config.json')))) {
    skip('no speech pack at public/models/whisper-base; run `npm run vendor:whisper`')
  }

  const cacheDir = join(root, '.cache', 'tts')
  await mkdir(cacheDir, { recursive: true })

  const { extractClinical } = await import('../src/lib/clinicalExtract.ts')
  const { CLINICAL_LOCALES } = await import('../src/lib/clinicalLocales.ts')
  // The app's own threshold, imported rather than restated: a calibration
  // report that measures a number the app does not use is worse than none.
  const { UNCERTAIN_BELOW } = await import('../src/db/schema.ts')

  const started = performance.now()
  const asr = await loadWhisper(modelRoot)
  const loadMs = Math.round(performance.now() - started)

  /** Whisper's own prompt format: <|startofprev|> followed by plain text tokens. */
  const promptFor = (locale) => {
    if (!prime) return undefined
    // The special token is written as text: the tokenizer recognises its
    // added tokens before anything else, so this yields <|startofprev|>'s id
    // followed by the prompt, which is the layout Whisper was trained on.
    const text = '<|startofprev|> ' + locale.formulary.slice(0, 40).join(', ') + '.'
    return asr.tokenizer(text, { add_special_tokens: false }).input_ids.tolist()[0].map(Number)
  }

  const files = (await readdir(join(here, 'corpus'))).filter((f) => f.startsWith('extraction.')).sort()
  const results = []

  for (const file of files) {
    const corpus = JSON.parse(await readFile(join(here, 'corpus', file), 'utf8'))
    const lang = corpus.locale
    const locale = CLINICAL_LOCALES[lang]
    const voice = VOICES[lang]
    if (!voice || !locale) continue

    let tp = 0
    let fp = 0
    let fn = 0
    let words = 0
    let errors = 0
    let audioSeconds = 0
    let inferenceMs = 0
    const cases = []
    const units = []

    for (const testCase of corpus.cases) {
      const wav = await synthesise(testCase.text, voice, cacheDir)
      const audio = wavToFloat32(await readFile(wav))
      audioSeconds += audio.length / 16000

      const t0 = performance.now()
      const promptIds = promptFor(locale)
      const out = await asr(audio, {
        ...(promptIds ? { prompt_ids: promptIds } : {}),
        language: WHISPER_LANG[lang],
        task: 'transcribe',
        do_sample: false,
        condition_on_previous_text: false,
        return_timestamps: false,
        // Whisper's window is 30 s; the longer cases need chunking, exactly as
        // the phone's segmenter would have cut them.
        chunk_length_s: 30,
      })
      inferenceMs += performance.now() - t0
      const transcript = (Array.isArray(out) ? out.map((p) => p.text).join(' ') : out.text).trim()

      const wer = wordErrorRate(testCase.text, transcript)
      words += wer.words
      errors += wer.errors

      const extraction = extractClinical(transcript, locale)
      const score = scoreExtraction(testCase.expect, extraction)
      tp += score.tp
      fp += score.fp
      fn += score.fn
      // Every row the review screen would put in front of a clinician for
      // this case, with the flag it would carry and whether it is right.
      units.push(...reviewUnits(testCase.expect, extraction))

      cases.push({ id: testCase.id, wer: wer.wer, transcript, misses: score.misses })
    }

    results.push({
      locale: lang,
      voice,
      cases: corpus.cases.length,
      wer: Number((errors / Math.max(1, words)).toFixed(4)),
      fromSpeech: prf(tp, fp, fn),
      audioSeconds: Number(audioSeconds.toFixed(1)),
      realTimeFactor: Number((inferenceMs / 1000 / audioSeconds).toFixed(3)),
      flag: flagAnalysis(units, UNCERTAIN_BELOW),
      buckets: confidenceBuckets(units),
      perCase: cases,
    })
  }

  const report = {
    date: new Date().toISOString().slice(0, 10),
    pack: 'whisper-base (q8, transformers.js)',
    primed: prime,
    loadMs,
    setting: 'synthetic TTS speech: a controlled condition, not a bound on field performance in either direction',
    results,
  }

  if (asJson) {
    console.log(JSON.stringify(report, null, 2))
    return
  }

  console.log('\nAfyaCore speech evaluation')
  console.log(`  ${report.pack}, loaded in ${loadMs} ms${prime ? ', primed with the formulary' : ''}`)
  console.log(`  ${report.setting}\n`)
  console.log('  locale  voice    cases   WER (raw)   fields from speech P / R / F1     RTF')
  for (const r of results) {
    const f = r.fromSpeech
    console.log(
      `  ${r.locale.padEnd(7)} ${r.voice.padEnd(8)} ${String(r.cases).padStart(5)}   ${pct(r.wer).padStart(8)}   ` +
        `${pct(f.precision)} / ${pct(f.recall)} / ${pct(f.f1)}            ${r.realTimeFactor}`,
    )
  }
  console.log(`\n  Does the "Check this" flag (confidence < ${UNCERTAIN_BELOW}) predict a wrong value?`)
  console.log('  Rows are what a clinician ticks: each vital, the complaint, the diagnosis,')
  console.log('  each prescription. Only values the extractor produced; a missed field has')
  console.log('  no row and no flag.\n')
  console.log('  locale  rows  wrong   error rate flagged / unflagged   catches   asks them to read')
  for (const r of results) {
    const f = r.flag
    console.log(
      `  ${r.locale.padEnd(7)} ${String(f.units).padStart(4)}  ${String(f.wrong).padStart(5)}   ` +
        `${pct(f.errorRateFlagged).padStart(8)} / ${pct(f.errorRateUnflagged).padStart(10)}   ` +
        `${pct(f.catchRate).padStart(7)}   ${pct(f.burden).padStart(6)} of rows`,
    )
  }
  for (const r of results) {
    if (r.flag.unflaggedErrors.length > 0) {
      console.log(`\n  ${r.locale}: wrong and NOT flagged: ${r.flag.unflaggedErrors.join(', ')}`)
    }
  }
  console.log('\n  Error rate by confidence, for judging another threshold:')
  for (const r of results) {
    const line = r.buckets.map((b) => `${b.confidence.toFixed(2)}:${b.wrong}/${b.total}`).join('  ')
    console.log(`  ${r.locale.padEnd(7)} ${line}`)
  }

  console.log('\n  What the recogniser cost, case by case (empty = every field survived):')
  for (const r of results) {
    for (const c of r.perCase) {
      const tag = c.misses.length ? c.misses.join('; ') : ''
      console.log(`  ${c.id.padEnd(30)} WER ${pct(c.wer).padStart(6)}  ${tag}`)
    }
  }
  console.log(
    '\n  WER is raw: "38,5" against "trente-huit virgule cinq" counts as errors even\n' +
      '  though the extractor reads both. The field score is the one that matters.\n' +
      '  Text-only extraction scores 100% on this corpus (npm run eval); the gap is\n' +
      '  what the speech model costs, in the easiest acoustic setting it will meet.\n',
  )
}

const pct = (x) => `${(x * 100).toFixed(1)}%`

main().catch((err) => {
  console.error(`eval:asr failed: ${err.stack ?? err.message}`)
  process.exit(1)
})

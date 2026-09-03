/**
 * On-device OCR for photographed paper records.
 *
 * Tesseract runs entirely in the browser, the image never leaves the phone,
 * which matters because these are patient records.
 *
 * ## The model follows the country, not the interface
 *
 * This shipped French-only, which was right when the only deployment was
 * Madagascar and wrong the moment there were nine countries: a dispensary in
 * Kenya photographs an English register, and we read it with the French model
 * and then parsed the result with the English pack. Numerals and drug names
 * mostly survived that; English prose did not.
 *
 * The language is now taken from the country profile's `clinicalLang`, the
 * same binding the extractor uses and for the same reason — documentation
 * language is a property of the health system, not of the person holding the
 * phone. Anything else lets a nurse change the interface language and silently
 * change how a photograph is read.
 *
 * Cost and how it is managed: the WASM core plus the French model is roughly
 * 12 MB. That is far too much to put in the install, so it is fetched on first
 * use and cached permanently afterwards. Settings offers an explicit
 * "download now" so staff can pre-load the pack while they have connectivity
 * rather than discovering the download mid-consultation in a village.
 *
 * Realistic expectations (docs/MODEL-RESEARCH.md §4): printed French forms read
 * well; handwriting is the hard case and will need correction. The output is
 * therefore treated as a draft that flows through the same review screen as
 * dictation, never as fact.
 */

import { getCountryProfile } from './facility'
import type { ClinicalLang } from './clinicalLocales'

export interface OcrResult {
  text: string
  /** 0–1, mean over recognised words. */
  confidence: number
  /** Words the engine itself was unsure about, surfaced for correction. */
  lowConfidenceWords: string[]
}

export type OcrProgress = (stage: string, progress: number) => void

type TesseractWorker = {
  recognize: (image: Blob) => Promise<{
    data: { text: string; confidence: number; words?: { text: string; confidence: number }[] }
  }>
  terminate: () => Promise<unknown>
}

/**
 * Tesseract's code for a clinical language.
 *
 * Kept as an explicit map rather than a string manipulation so that adding a
 * clinical language without adding its OCR model is a type error rather than a
 * request for a `.traineddata` that was never vendored.
 */
export const TESSERACT_LANG: Record<ClinicalLang, string> = {
  fr: 'fra',
  en: 'eng',
}

/**
 * One warm worker per language.
 *
 * Keyed rather than singular because a device that changes country mid-session
 * must not keep recognising with the previous model, and because reusing one
 * slot would mean tearing down and recompiling the WASM core on every switch.
 * In practice a device has exactly one country and therefore exactly one entry.
 */
const workers = new Map<string, Promise<TesseractWorker>>()

/** The Tesseract language this device should be reading in. */
async function currentLang(): Promise<string> {
  const profile = await getCountryProfile()
  return TESSERACT_LANG[profile.clinicalLang] ?? 'fra'
}

async function getWorker(onProgress?: OcrProgress): Promise<TesseractWorker> {
  const lang = await currentLang()
  const existing = workers.get(lang)
  if (existing) return existing

  const created = (async () => {
    // Dynamic import keeps tesseract.js out of the app's entry chunk entirely.
    const { createWorker } = await import('tesseract.js')

    // Everything is served from our own origin (see scripts/vendor-ocr.mjs).
    // The library's CDN defaults would fail on a filtered or weak connection
    // and cannot be reliably cached by the service worker.
    const base = `${import.meta.env.BASE_URL}ocr`

    return (await createWorker(lang, 1, {
      workerPath: `${base}/worker.min.js`,
      corePath: base,
      langPath: base,
      // Model is gzipped on disk to keep the download small.
      gzip: true,
      logger: (m: { status: string; progress: number }) => onProgress?.(m.status, m.progress),
    })) as unknown as TesseractWorker
  })()

  workers.set(lang, created)
  try {
    return await created
  } catch (err) {
    // Never cache a failed initialisation, a user who was offline on their
    // first attempt must be able to simply try again once they have signal.
    workers.delete(lang)
    throw err
  }
}

/**
 * True once an OCR pack has been fetched and a worker is warm.
 *
 * Deliberately not "the pack for the current country": this is a synchronous
 * call used to seed a button's label, the country lookup is asynchronous, and
 * a warm worker for the wrong language still means the 12 MB core is cached.
 * Getting the language wrong here costs a mislabelled button; making the call
 * asynchronous would cost a flash of the wrong state on every render.
 */
export function isOcrReady(): boolean {
  return workers.size > 0
}

/** Pre-fetch the OCR pack. Called from Settings while connectivity exists. */
export async function preloadOcr(onProgress?: OcrProgress): Promise<void> {
  await getWorker(onProgress)
}

export async function recogniseImage(blob: Blob, onProgress?: OcrProgress): Promise<OcrResult> {
  const worker = await getWorker(onProgress)
  const { data } = await worker.recognize(blob)

  const words = data.words ?? []
  const lowConfidenceWords = words
    .filter((w) => w.confidence < 70 && w.text.trim().length > 1)
    .map((w) => w.text)

  return {
    // Tesseract emits hard line breaks at the image's line boundaries, which
    // fragment sentences the clinical extractor needs to read as one span.
    text: data.text.replace(/\s*\n\s*/g, ' ').replace(/\s{2,}/g, ' ').trim(),
    confidence: (data.confidence ?? 0) / 100,
    lowConfidenceWords,
  }
}

export async function releaseOcr(): Promise<void> {
  const pending = [...workers.values()]
  workers.clear()
  await Promise.all(
    pending.map(async (p) => {
      const worker = await p.catch(() => null)
      await worker?.terminate().catch(() => undefined)
    }),
  )
}

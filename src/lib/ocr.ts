/**
 * On-device OCR for photographed paper records.
 *
 * Tesseract with the French model runs entirely in the browser, the image
 * never leaves the phone, which matters because these are patient records.
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

export interface OcrResult {
  text: string
  /** 0–1, mean over recognised words. */
  confidence: number
  /** Words the engine itself was unsure about, surfaced for correction. */
  lowConfidenceWords: string[]
}

export type OcrProgress = (stage: string, progress: number) => void

// The worker is expensive to spin up (WASM compile + model load), so it is
// created once and reused for the rest of the session.
type TesseractWorker = {
  recognize: (image: Blob) => Promise<{
    data: { text: string; confidence: number; words?: { text: string; confidence: number }[] }
  }>
  terminate: () => Promise<unknown>
}

let workerPromise: Promise<TesseractWorker> | null = null

async function getWorker(onProgress?: OcrProgress): Promise<TesseractWorker> {
  if (workerPromise) return workerPromise

  workerPromise = (async () => {
    // Dynamic import keeps tesseract.js out of the app's entry chunk entirely.
    const { createWorker } = await import('tesseract.js')

    // Everything is served from our own origin (see scripts/vendor-ocr.mjs).
    // The library's CDN defaults would fail on a filtered or weak connection
    // and cannot be reliably cached by the service worker.
    const base = `${import.meta.env.BASE_URL}ocr`

    return (await createWorker('fra', 1, {
      workerPath: `${base}/worker.min.js`,
      corePath: base,
      langPath: base,
      // Model is gzipped on disk to keep the download small.
      gzip: true,
      logger: (m: { status: string; progress: number }) => onProgress?.(m.status, m.progress),
    })) as unknown as TesseractWorker
  })()

  try {
    return await workerPromise
  } catch (err) {
    // Never cache a failed initialisation, a user who was offline on their
    // first attempt must be able to simply try again once they have signal.
    workerPromise = null
    throw err
  }
}

/** True once the OCR pack has been fetched and the worker is warm. */
export function isOcrReady(): boolean {
  return workerPromise !== null
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
  if (!workerPromise) return
  const worker = await workerPromise.catch(() => null)
  workerPromise = null
  await worker?.terminate().catch(() => undefined)
}

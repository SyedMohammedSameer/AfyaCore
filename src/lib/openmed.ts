/**
 * Neural PII detection over free text, using OpenMed.
 *
 * ## Why this exists at all
 *
 * `scrubFreeText` matches identifiers against the roster this device already
 * holds, which gives 100% recall on the dominant leak (a patient's own name in
 * their own note) at zero megabytes. What it cannot catch is an identifier the
 * roster does *not* hold, and those are routine in real notes: "sa fille
 * Hanta", "adressé par le Dr Rakoto", a village nobody is registered in. Those
 * are exactly what a NER model is for.
 *
 * So this is an **extra pass, never a replacement**. The deterministic scrub
 * runs first and always; the model only ever adds redactions. That ordering is
 * the whole safety argument: if the model fails to load, times out, or returns
 * nothing, the export is exactly as de-identified as it was before, and no
 * export path becomes less safe because a download failed.
 *
 * ## Why OpenMed
 *
 * [OpenMed](https://huggingface.co/OpenMed) (Maziyar Panahi, arXiv:2508.01630)
 * is Apache-2.0, which matters: much of the alternative Malagasy/French model
 * landscape is CC-BY-NC and would foreclose a commercial version of this app
 * (docs/MODEL-RESEARCH.md §5). It also publishes ONNX builds tagged for
 * WebAssembly and WebGPU, which is what makes on-device inference in a PWA
 * possible at all.
 *
 * `docs/MODEL-RESEARCH.md` §4b previously recorded that OpenMed's PII model was
 * English-only and could not be validated here. That is now out of date in our
 * favour: OpenMed shipped per-language PII models in February 2026, French
 * among them, with ONNX builds in July 2026.
 *
 * We use the smallest French one that exists:
 * `OpenMed-PII-French-ClinicalE5-Small-33M-v1-onnx-android`, 33M parameters,
 * ~67 MB as fp16. The 44M SuperClinical variant is a DeBERTa-v2 whose fp32
 * graph is 566 MB with an 8 MB SentencePiece tokenizer, which is not a download
 * to ask of a health post.
 *
 * ## Why the backend is injectable
 *
 * `NerBackend` is an interface rather than a direct transformers.js call so
 * that span merging, BIO decoding, label filtering and the redaction logic can
 * be tested without 67 MB of weights. Those parts are where the bugs live; the
 * model itself is somebody else's tested artefact.
 */

/** One entity as a NER backend reports it. Character offsets into the input. */
export interface NerEntity {
  /** Entity type without its BIO prefix, e.g. `FIRSTNAME`. */
  label: string
  start: number
  end: number
  score: number
}

export interface NerBackend {
  (text: string): Promise<NerEntity[]>
}

/**
 * The OpenMed PII labels worth redacting in a clinical note.
 *
 * The model emits 54 types, most of them irrelevant here: a rural outpatient
 * record does not contain a Bitcoin address, an IBAN or a MAC address, and
 * listing them would only add ways to redact something that is actually
 * clinical. This is the subset that identifies a person in this setting.
 *
 * `AGE` is deliberately absent. Age is clinical content, it drives the WHO/IMCI
 * age bands the whole DHIS2 report is disaggregated by, and the structured
 * `approximateAge` field is already capped at 89 by `deidentify`. Redacting
 * "enfant de 6 ans" out of a note would damage the record to remove something
 * the export already handles correctly.
 *
 * `DATE` is likewise absent: dates are generalised structurally at the
 * `anonymous` level rather than blanked mid-sentence.
 */
export const REDACTABLE_LABELS = new Set([
  'FIRSTNAME',
  'LASTNAME',
  'MIDDLENAME',
  'PREFIX',
  'USERNAME',
  'ACCOUNTNAME',
  'EMAIL',
  'PHONE',
  'STREET',
  'BUILDINGNUMBER',
  'SECONDARYADDRESS',
  'CITY',
  'COUNTY',
  'STATE',
  'ZIPCODE',
  'GPSCOORDINATES',
  'SSN',
  'IPADDRESS',
  'URL',
  'ORGANIZATION',
  'JOBTITLE',
  'JOBDEPARTMENT',
  'OCCUPATION',
])

/**
 * Minimum score before a span is redacted.
 *
 * Low, on purpose, and the direction of the asymmetry is the point: a false
 * positive costs one redacted word in a research export, a false negative
 * leaks a name. `scrubFreeText`'s own comment states the same principle, "when
 * a rule is unsure, it removes rather than keeps", and a threshold tuned for
 * balanced F1 would be the wrong trade here.
 */
export const DEFAULT_MIN_SCORE = 0.35

export interface NeuralScrubOptions {
  minScore?: number
  labels?: Set<string>
  /** Replacement token. Defaults to the same marker the deterministic pass uses. */
  redacted?: string
}

/**
 * Merge overlapping and adjacent spans.
 *
 * Token classifiers emit one span per word piece, so "Jean Baptiste Rakoto"
 * arrives as three or more spans. Redacting each separately produces
 * "[…] […] […]", which is both ugly and a worse disclosure risk than it looks:
 * the number of markers leaks how many name parts there were. Spans separated
 * only by whitespace or a hyphen are joined so one name becomes one marker.
 */
export function mergeSpans(entities: NerEntity[], text: string): Array<[number, number]> {
  if (entities.length === 0) return []

  const sorted = [...entities].sort((a, b) => a.start - b.start || a.end - b.end)
  const merged: Array<[number, number]> = []

  for (const entity of sorted) {
    const last = merged[merged.length - 1]
    if (!last) {
      merged.push([entity.start, entity.end])
      continue
    }
    // Join when overlapping, or when only a separator sits between them.
    const between = text.slice(last[1], entity.start)
    if (entity.start <= last[1] || /^[\s'’-]*$/.test(between)) {
      last[1] = Math.max(last[1], entity.end)
    } else {
      merged.push([entity.start, entity.end])
    }
  }

  return merged
}

/**
 * Apply a NER backend's findings to one piece of text.
 *
 * Spans are spliced back to front so earlier offsets stay valid as the string
 * shortens, the same technique `scrubFreeText` uses.
 */
export function applyEntities(
  text: string,
  entities: NerEntity[],
  options: NeuralScrubOptions = {},
): { text: string; redactions: number } {
  const {
    minScore = DEFAULT_MIN_SCORE,
    labels = REDACTABLE_LABELS,
    redacted = '[…]',
  } = options

  const keep = entities.filter(
    (e) =>
      e.score >= minScore &&
      labels.has(e.label.toUpperCase()) &&
      e.end > e.start &&
      e.start >= 0 &&
      e.end <= text.length,
  )

  const spans = mergeSpans(keep, text)
  let out = text
  let redactions = 0

  for (const [start, end] of [...spans].reverse()) {
    // Text already replaced by the deterministic pass is left alone: redacting
    // a redaction marker would double-count and produce "[…][…]".
    const slice = out.slice(start, end)
    if (slice === redacted || slice.trim() === '') continue
    out = out.slice(0, start) + redacted + out.slice(end)
    redactions++
  }

  return { text: out, redactions }
}

/**
 * Decode a token-classification output into entity spans.
 *
 * Written here rather than relying on a pipeline's own aggregation because BIO
 * decoding is precisely the part that silently mis-handles the case we care
 * about: an `I-LASTNAME` that follows nothing. A strict decoder drops it; we
 * treat it as the start of an entity instead. Dropping it would mean silently
 * not redacting a surname, which is the one failure this module exists to
 * prevent.
 */
export function decodeBio(
  tokens: Array<{ label: string; start: number; end: number; score: number }>,
): NerEntity[] {
  const entities: NerEntity[] = []
  let current: NerEntity | null = null

  const flush = () => {
    if (current) entities.push(current)
    current = null
  }

  for (const token of tokens) {
    const raw = token.label
    if (raw === 'O' || raw === '') {
      flush()
      continue
    }

    const match = /^([BILUES])-(.+)$/i.exec(raw)
    const prefix = match ? match[1]!.toUpperCase() : 'B'
    const label = match ? match[2]! : raw

    if (prefix === 'B' || prefix === 'U' || prefix === 'S' || !current || current.label !== label) {
      flush()
      current = { label, start: token.start, end: token.end, score: token.score }
    } else {
      current.end = token.end
      // The weakest token in a span governs it: a span is only as trustworthy
      // as its least certain part.
      current.score = Math.min(current.score, token.score)
    }
  }
  flush()

  return entities
}

/* ------------------------------------------------------------------ *
 * Runtime loading
 * ------------------------------------------------------------------ */

/**
 * Where the vendored model lives.
 *
 * Served from our own origin, not a CDN, for the same reason the OCR pack is
 * (`scripts/vendor-ocr.mjs`): a facility on a weak or filtered connection may
 * not reach huggingface.co, and a service worker cannot reliably cache an
 * opaque cross-origin response, so the feature would pass testing and fail in a
 * village. `scripts/vendor-openmed.mjs` puts it here.
 */
export const MODEL_PATH = '/models/openmed-pii-fr'

export const MODEL_REPO = 'OpenMed/OpenMed-PII-French-ClinicalE5-Small-33M-v1-onnx-android'

/**
 * True when the vendored model has actually been placed on this origin.
 *
 * Deliberately fetches and parses the config rather than trusting a status
 * code. A single-page app serves `index.html` with HTTP 200 for any unknown
 * path, so a `HEAD` request for a model that was never vendored comes back
 * `ok: true` with a page of HTML. The app then told the facility "Model
 * installed, neural pass active" while running no model at all, which is the
 * worst class of bug this codebase can have: a false claim that a privacy
 * control is switched on.
 *
 * Parsing the JSON and checking for a field only a real config carries is what
 * distinguishes "the file is there" from "the server answered".
 */
export async function isModelAvailable(fetchImpl: typeof fetch = fetch): Promise<boolean> {
  try {
    const response = await fetchImpl(`${MODEL_PATH}/config.json`, {
      headers: { accept: 'application/json' },
    })
    if (!response.ok) return false
    const config = (await response.json()) as { model_type?: unknown; id2label?: unknown }
    // A token-classification config always carries both.
    return typeof config?.model_type === 'string' && typeof config?.id2label === 'object'
  } catch {
    // Non-JSON (the SPA fallback) lands here via the JSON parse throwing.
    return false
  }
}

let cached: NerBackend | null = null

/**
 * Load the model and return a backend, or null if it is not present.
 *
 * Returns null rather than throwing. The caller is an export path, and an
 * export must not fail because an optional accuracy upgrade is missing; it
 * falls back to the deterministic scrub, which is the shipped default anyway.
 *
 * transformers.js is imported dynamically so that neither it nor
 * onnxruntime-web enters the initial bundle. The whole premise of the app is a
 * 130 kB install over 2G.
 */
export async function loadBackend(): Promise<NerBackend | null> {
  if (cached) return cached
  if (!(await isModelAvailable())) return null

  try {
    const { pipeline, env } = await import('@huggingface/transformers')

    // Never reach for the Hub or a CDN at runtime. Everything is local by
    // construction: the model, the tokeniser and the WebAssembly core are all
    // served from this origin by `npm run vendor:openmed`. A facility behind a
    // filtered connection is the normal case, not the edge case.
    env.allowRemoteModels = false
    env.allowLocalModels = true
    env.localModelPath = '/models/'
    // Optional-chained: the shape of `env.backends` depends on which
    // transformers.js build resolves, and a missing backend must degrade to the
    // deterministic scrub rather than throw inside an export.
    if (env.backends?.onnx?.wasm) env.backends.onnx.wasm.wasmPaths = '/ort/'

    const pipe = await pipeline('token-classification', 'openmed-pii-fr', {
      dtype: 'fp16',
    })

    cached = async (text: string) => {
      const raw = (await pipe(text)) as Array<{
        entity?: string
        entity_group?: string
        score: number
        start?: number
        end?: number
      }>
      return decodeBio(
        raw
          .filter((t) => t.start !== undefined && t.end !== undefined)
          .map((t) => ({
            label: t.entity ?? t.entity_group ?? 'O',
            start: t.start!,
            end: t.end!,
            score: t.score,
          })),
      )
    }
    return cached
  } catch {
    // A corrupt download or an unsupported runtime must degrade to the
    // deterministic scrub, not break the export.
    return null
  }
}

/** Drop the cached pipeline, freeing its memory. */
export function unloadBackend(): void {
  cached = null
}

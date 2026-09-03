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
 * ~70 MB as int8. The 44M SuperClinical variant is a DeBERTa-v2 whose fp32
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
 * Character offsets
 * ------------------------------------------------------------------ */

/**
 * Normalise text the way a BERT WordPiece tokeniser does, keeping an index map.
 *
 * `tokenizer_config.json` for this model sets `do_lower_case: true` and leaves
 * `strip_accents` null, which in BERT means "follow do_lower_case" — so the
 * tokeniser sees `febriles` where the record says `fébriles`. Aligning the
 * tokeniser's output back onto the original string therefore has to compare
 * against the same normalisation.
 *
 * Accent stripping is not length-preserving (`é` is one codepoint, its NFD form
 * is two, and one of them is dropped), so a map from normalised index back to
 * original index is built alongside. Without it every offset after the first
 * accented character is wrong, and in French clinical text that is the first
 * few words.
 */
export function normaliseForAlignment(text: string): { normalised: string; map: number[] } {
  let normalised = ''
  const map: number[] = []

  for (let i = 0; i < text.length; i++) {
    // Decompose one character at a time so each output character keeps the
    // index of the source character it came from.
    const decomposed = text[i]!.normalize('NFD')
    for (const char of decomposed) {
      // Drop combining marks: the accent-stripping half of BertNormalizer.
      if (/\p{Mn}/u.test(char)) continue
      normalised += char.toLowerCase()
      map.push(i)
    }
  }

  return { normalised, map }
}

/**
 * Recover character offsets for tokens a pipeline did not give offsets for.
 *
 * transformers.js's token-classification pipeline returns `entity`, `score`,
 * `index` and `word`, and carries a literal `// TODO: Add support for start and
 * end` where the offsets should be. Our code filtered on
 * `start !== undefined`, which dropped every token, which meant `decodeBio`
 * always received an empty array and the neural pass redacted nothing — while
 * loading 70 MB, running the model, and reporting itself as active. It cost
 * 2.4 ms a sentence to do nothing at all.
 *
 * So offsets are reconstructed here. Greedy forward search over the normalised
 * text, the same technique the E3C scorer uses for the same reason: token
 * lengths do not sum to the source, so any offset computed by addition drifts
 * and then mislabels every span after it.
 *
 * WordPiece continuations may arrive as `##ies` or, once decoded, as `ies`.
 * Both are handled by stripping the marker and searching from the cursor,
 * which finds a continuation immediately at the cursor and a fresh word after
 * the intervening space.
 *
 * A token that cannot be located is dropped rather than guessed at. Dropping
 * loses one redaction; guessing redacts the wrong span, and a redaction marker
 * over clinical content is worse than a missed one is here, where a
 * deterministic pass has already run.
 */
export function alignTokenOffsets(
  text: string,
  tokens: Array<{ word: string; entity: string; score: number }>,
): Array<{ label: string; start: number; end: number; score: number }> {
  const { normalised, map } = normaliseForAlignment(text)
  const aligned: Array<{ label: string; start: number; end: number; score: number }> = []
  let cursor = 0

  for (const token of tokens) {
    const piece = token.word.replace(/^##/, '').toLowerCase()
    if (!piece) continue

    const at = normalised.indexOf(piece, cursor)
    if (at === -1) continue

    const startNorm = at
    const endNorm = at + piece.length
    const start = map[startNorm]
    // `map` holds the source index of each normalised character, so the end of
    // the span is one past the source index of its last character.
    const lastSource = map[endNorm - 1]
    if (start === undefined || lastSource === undefined) continue

    aligned.push({ label: token.entity, start, end: lastSource + 1, score: token.score })
    cursor = endNorm
  }

  return aligned
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
 * What the last backend call actually did.
 *
 * Exposed so the evaluation harness can report "the model tagged N tokens and
 * none of them survived", which is the sentence that would have caught the
 * offset bug on the day it was written instead of after a 70 MB download.
 */
export interface BackendDiagnostics {
  /** Calls to the backend. */
  calls: number
  /** Tokens the model labelled as something other than `O`. */
  tokensTagged: number
  /** Spans that survived offset alignment and BIO decoding. */
  spansAligned: number
}

let diagnostics: BackendDiagnostics = { calls: 0, tokensTagged: 0, spansAligned: 0 }

export function getBackendDiagnostics(): BackendDiagnostics {
  return { ...diagnostics }
}

export function resetBackendDiagnostics(): void {
  diagnostics = { calls: 0, tokensTagged: 0, spansAligned: 0 }
}

/**
 * Where and whether to look for the model.
 *
 * These exist for the evaluation harness, which runs under Node rather than in
 * a browser, and the distinction is not cosmetic. `isModelAvailable` fetches
 * `/models/...`, an origin-relative path that is meaningful in a page and a
 * `TypeError` in Node; `localModelPath` is a URL prefix in the browser and a
 * filesystem directory in Node. Left as they were, the harness caught the
 * throw, reported "model absent", and would have gone on doing so after a
 * perfectly successful download — which is the sort of thing that gets
 * diagnosed as "the model doesn't work".
 */
export interface LoadBackendOptions {
  /** URL prefix in a browser, filesystem directory under Node. Must end in a separator. */
  modelRoot?: string
  /** Presence check. Defaults to fetching the config over HTTP. */
  available?: () => Promise<boolean>
}

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
export async function loadBackend(options: LoadBackendOptions = {}): Promise<NerBackend | null> {
  const { modelRoot = '/models/', available = isModelAvailable } = options

  if (cached) return cached
  if (!(await available())) return null

  try {
    const { pipeline, env } = await import('@huggingface/transformers')

    // Never reach for the Hub or a CDN at runtime. Everything is local by
    // construction: the model, the tokeniser and the WebAssembly core are all
    // served from this origin by `npm run vendor:openmed`. A facility behind a
    // filtered connection is the normal case, not the edge case.
    env.allowRemoteModels = false
    env.allowLocalModels = true
    env.localModelPath = modelRoot
    // Optional-chained: the shape of `env.backends` depends on which
    // transformers.js build resolves, and a missing backend must degrade to the
    // deterministic scrub rather than throw inside an export.
    if (env.backends?.onnx?.wasm) env.backends.onnx.wasm.wasmPaths = '/ort/'

    // int8, matching the graph `scripts/vendor-openmed.mjs` vendors. The model
    // card names int8 the "CPU, WebAssembly, and Android default" and reserves
    // fp16 for WebGPU, and we ship no WebGPU runtime. Changing one of these
    // two without the other means the pipeline looks for a file that is not
    // there, which surfaces as a silent fall back to the deterministic scrub.
    const pipe = await pipeline('token-classification', 'openmed-pii-fr', {
      dtype: 'int8',
    })

    cached = async (text: string) => {
      const raw = (await pipe(text)) as Array<{
        entity?: string
        entity_group?: string
        score: number
        word?: string
      }>

      const tagged = raw
        .filter((t) => t.word)
        .map((t) => ({
          word: t.word!,
          entity: t.entity ?? t.entity_group ?? 'O',
          score: t.score,
        }))

      const entities = decodeBio(alignTokenOffsets(text, tagged))

      // Counters, because the way this failed before was silence: the model
      // ran, returned tokens, and every one of them was discarded downstream
      // without anything anywhere recording that it had happened.
      diagnostics = {
        calls: diagnostics.calls + 1,
        tokensTagged: diagnostics.tokensTagged + tagged.filter((t) => t.entity !== 'O').length,
        spansAligned: diagnostics.spansAligned + entities.length,
      }

      return entities
    }
    return cached
  } catch {
    // A corrupt download or an unsupported runtime must degrade to the
    // deterministic scrub, not break the export.
    return null
  }
}

/**
 * Drop the cached pipeline, freeing its memory.
 *
 * Also the escape hatch for `loadBackend`'s cache, which is keyed on nothing:
 * a second call with different options returns the first backend. That is
 * correct for the app, which only ever has one model, and a trap for a test
 * that wants two.
 */
export function unloadBackend(): void {
  cached = null
}

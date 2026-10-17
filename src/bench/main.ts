/**
 * On-device speech benchmark: what the Whisper pack costs on the phone in
 * your hand.
 *
 * Open /bench.html on the device, press Run, and copy or download the JSON
 * at the end. docs/ml4h/PHONE-BENCHMARK.md has the protocol.
 *
 * Three numbers, each measured the way a clinician would meet it:
 *
 *  - **Load time.** A fresh worker per load, so every load pays for starting
 *    the runtime and building both sessions, as the app does each time it is
 *    reopened. A load is labelled cold when the model files were not cached
 *    on the device beforehand, because then it is timing the network.
 *  - **Real-time factor.** Inference time over audio duration, on the app's
 *    own segments of the sample dictations. Below 1, the model keeps up with
 *    someone talking.
 *  - **Peak memory.** The runtime's WebAssembly heap, which holds the weights
 *    and activations and cannot shrink, so its final size is its peak (an
 *    upper bound by up to 20%; see bench.worker.ts).
 *
 * Deliberately outside the React app: no sign-in, no database, nothing else
 * on the page competing for the memory being measured.
 */
import type { BenchFromWorker, BenchToWorker, SegmentTiming } from './protocol'

const PACK = 'whisper-base'
const ENCODER_FILE = 'encoder_model_quantized.onnx'
/** Whisper's input rate. `audio.ts` has it too; restated to keep the app out of this page's bundle. */
const WHISPER_RATE = 16_000

interface Clip {
  id: string
  file: string
  language: 'french' | 'english'
  label: string
}

const CLIPS: Clip[] = [
  { id: 'studio-fr', file: '/samples/studio-fr.wav', language: 'french', label: 'French consultation, synthetic voice' },
  { id: 'studio-en', file: '/samples/studio-en.wav', language: 'english', label: 'English consultation, synthetic voice' },
  { id: 'dictation-fr', file: '/samples/dictation-fr.m4a', language: 'french', label: 'French dictation sample' },
  { id: 'dictation-en', file: '/samples/dictation-en.m4a', language: 'english', label: 'English dictation sample' },
]

interface Decoded {
  clip: Clip
  samples: Float32Array
  sampleRate: number
  seconds: number
}

interface LoadRecord {
  index: number
  /** Whether the model files were in a cache before this load. Null when it cannot be told. */
  cachedBefore: boolean | null
  /** From creating the worker to the model being ready: what a user waits for. */
  loadMs: number
  /** The part of that spent inside `loadWhisper`. */
  pipelineMs: number
  threads: number | null
  wasmHeapMb: number | null
}

interface PassRecord {
  /** 0 is the first inference after loading, reported apart and left out of the summary. */
  pass: number
  clip: string
  audioSeconds: number
  inferenceMs: number
  rtf: number
  segments: SegmentTiming[]
  text: string
  wasmHeapMb: number | null
}

/* ------------------------------------------------------------------ *
 * Worker
 * ------------------------------------------------------------------ */

type Reply<T extends BenchFromWorker['type']> = Extract<BenchFromWorker, { type: T }>

class BenchWorker {
  private readonly worker = new Worker(new URL('./bench.worker.ts', import.meta.url), { type: 'module' })

  /** One request at a time: the page never has two in flight. */
  private request<T extends BenchFromWorker['type']>(message: BenchToWorker, expect: T): Promise<Reply<T>> {
    return new Promise((resolve, reject) => {
      this.worker.onmessage = (event: MessageEvent<BenchFromWorker>) => {
        const reply = event.data
        if (reply.type === 'error') reject(new Error(reply.message))
        else if (reply.type === expect) resolve(reply as Reply<T>)
      }
      // A worker the phone killed for memory lands here, not in an error reply.
      this.worker.onerror = (event) => reject(new Error(event.message || 'the worker stopped'))
      this.worker.postMessage(message)
    })
  }

  load(pack: string) {
    return this.request({ type: 'load', pack }, 'loaded')
  }

  /** Copied rather than transferred, so the same clip can be sent every pass. */
  transcribe(audio: Decoded) {
    return this.request(
      { type: 'transcribe', audio: audio.samples, sampleRate: audio.sampleRate, language: audio.clip.language },
      'transcribed',
    )
  }

  terminate() {
    this.worker.terminate()
  }
}

/* ------------------------------------------------------------------ *
 * Device and environment
 * ------------------------------------------------------------------ */

type BenchNavigator = Navigator & {
  deviceMemory?: number
  userAgentData?: { getHighEntropyValues(hints: string[]): Promise<Record<string, unknown>> }
  getBattery?: () => Promise<{ level: number; charging: boolean }>
}
const nav = navigator as BenchNavigator

async function describeDevice() {
  const hints = await nav.userAgentData
    ?.getHighEntropyValues(['model', 'platform', 'platformVersion', 'architecture', 'fullVersionList'])
    .catch(() => undefined)
  const brands = (hints?.fullVersionList ?? []) as Array<{ brand: string; version: string }>
  const chrome = brands.find((b) => /Chrome|Chromium/.test(b.brand))
  return {
    // Android Chrome reports the handset model here; desktop reports ''.
    model: (hints?.model as string | undefined) || null,
    platform: hints ? `${hints.platform} ${hints.platformVersion}`.trim() : null,
    architecture: (hints?.architecture as string | undefined) || null,
    browser: chrome ? `${chrome.brand} ${chrome.version}` : null,
    userAgent: navigator.userAgent,
    // Rounded down to a power of two, and capped on some browsers. Write
    // the handset's real RAM into the results by hand.
    deviceMemoryGb: nav.deviceMemory ?? null,
    cores: navigator.hardwareConcurrency ?? null,
    crossOriginIsolated: self.crossOriginIsolated,
  }
}

async function battery() {
  const b = await nav.getBattery?.().catch(() => undefined)
  return b ? { level: b.level, charging: b.charging } : null
}

/** Fetches and parses the config, for the reason `isPackAvailable` in asr.ts gives. */
async function modelProvenance(): Promise<unknown> {
  const config = await fetch(`/models/${PACK}/config.json`)
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null)
  if (config?.model_type !== 'whisper') {
    throw new Error(`The ${PACK} speech model is not installed on this server. Run npm run vendor:whisper.`)
  }
  return fetch(`/models/${PACK}/PROVENANCE.json`)
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null)
}

/** True when the encoder is in any cache: the app's service worker or transformers.js's own. */
async function modelCached(): Promise<boolean | null> {
  if (!('caches' in self)) return null
  try {
    for (const name of await caches.keys()) {
      const keys = await (await caches.open(name)).keys()
      if (keys.some((request) => request.url.endsWith(ENCODER_FILE))) return true
    }
    return false
  } catch {
    return null
  }
}

async function decode(clip: Clip): Promise<Decoded> {
  const response = await fetch(clip.file)
  if (!response.ok) throw new Error(`${clip.file}: HTTP ${response.status}`)
  const bytes = await response.arrayBuffer()
  // Decoded as `transcribeUrl` decodes: a context at Whisper's rate, so the
  // browser resamples and the worker's own resample is a no-op.
  const context = new AudioContext({ sampleRate: WHISPER_RATE })
  try {
    const decoded = await context.decodeAudioData(bytes)
    return {
      clip,
      samples: new Float32Array(decoded.getChannelData(0)),
      sampleRate: decoded.sampleRate,
      seconds: decoded.duration,
    }
  } finally {
    void context.close().catch(() => {})
  }
}

/**
 * Keep the screen on for the run.
 *
 * A phone that dims and locks halfway through throttles or suspends the tab,
 * and the timings after that measure the lock screen. The lock is dropped
 * whenever the page is hidden, so it is taken again on return.
 */
async function keepScreenOn(): Promise<{ held: boolean; release: () => void }> {
  let lock: WakeLockSentinel | null = null
  const acquire = async () => {
    lock = (await navigator.wakeLock?.request('screen').catch(() => null)) ?? null
    return lock !== null
  }
  const onVisible = () => {
    if (document.visibilityState === 'visible') void acquire()
  }
  const held = await acquire()
  document.addEventListener('visibilitychange', onVisible)
  return {
    held,
    release: () => {
      document.removeEventListener('visibilitychange', onVisible)
      void lock?.release().catch(() => {})
    },
  }
}

/* ------------------------------------------------------------------ *
 * Statistics
 * ------------------------------------------------------------------ */

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)
const mb = (bytes: number | null) => (bytes === null ? null : round(bytes / 2 ** 20, 1))
const round = (x: number, digits: number) => Number(x.toFixed(digits))

/** Nearest-rank percentile; with a handful of values, interpolating would invent precision. */
function percentile(xs: number[], p: number): number | null {
  if (xs.length === 0) return null
  const sorted = [...xs].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))]
}

function spread(xs: number[], digits = 0) {
  if (xs.length === 0) return null
  return {
    n: xs.length,
    median: round(percentile(xs, 50)!, digits),
    min: round(Math.min(...xs), digits),
    max: round(Math.max(...xs), digits),
  }
}

const maxOf = (xs: Array<number | null>) => {
  const seen = xs.filter((x): x is number => x !== null)
  return seen.length ? Math.max(...seen) : null
}

function summarise(loads: LoadRecord[], passes: PassRecord[]) {
  const cold = (l: LoadRecord) => l.cachedBefore === false || (l.cachedBefore === null && l.index === 1)
  const timed = passes.filter((p) => p.pass > 0)
  const segmentMs = timed.flatMap((p) => p.segments.map((s) => s.inferenceMs))
  const first = passes.find((p) => p.pass === 0)
  const audio = sum(timed.map((p) => p.audioSeconds))

  return {
    warmLoadMs: spread(loads.filter((l) => !cold(l)).map((l) => l.loadMs)),
    coldLoadMs: loads.find(cold)?.loadMs ?? null,
    firstInference: first
      ? { audioSeconds: first.audioSeconds, inferenceMs: first.inferenceMs, rtf: first.rtf }
      : null,
    rtf: audio > 0 ? round(sum(timed.map((p) => p.inferenceMs)) / 1000 / audio, 3) : null,
    rtfPerClip: spread(timed.map((p) => p.rtf), 3),
    segmentMs:
      segmentMs.length > 0
        ? {
            n: segmentMs.length,
            median: Math.round(percentile(segmentMs, 50)!),
            p90: Math.round(percentile(segmentMs, 90)!),
            max: Math.round(Math.max(...segmentMs)),
          }
        : null,
    segmentAudioSeconds: spread(timed.flatMap((p) => p.segments.map((s) => s.audioSeconds)), 1),
    peakWasmHeapMb: maxOf([...loads.map((l) => l.wasmHeapMb), ...passes.map((p) => p.wasmHeapMb)]),
    threads: loads.at(-1)?.threads ?? null,
  }
}

/* ------------------------------------------------------------------ *
 * The run
 * ------------------------------------------------------------------ */

interface Settings {
  loads: number
  passes: number
  clips: Clip[]
}

async function run(settings: Settings, status: (text: string) => void) {
  const result = {
    kind: 'afyacore-phone-benchmark',
    version: 1,
    date: new Date().toISOString(),
    page: location.origin,
    device: await describeDevice(),
    batteryStart: await battery(),
    batteryEnd: null as Awaited<ReturnType<typeof battery>>,
    model: {
      pack: PACK,
      dtype: 'q8',
      device: 'wasm',
      provenance: null as unknown,
    },
    settings: { loads: settings.loads, passes: settings.passes, clips: [] as Array<{ id: string; seconds: number }> },
    screenKeptOn: false,
    hiddenDuringRun: false,
    durationSeconds: 0,
    loads: [] as LoadRecord[],
    passes: [] as PassRecord[],
    summary: null as ReturnType<typeof summarise> | null,
    error: null as string | null,
  }

  const started = performance.now()
  const screen = await keepScreenOn()
  result.screenKeptOn = screen.held
  // A hidden tab is throttled, and every timing after that is the
  // throttle's. Recorded rather than prevented, because it cannot be.
  const onHide = () => {
    if (document.hidden) result.hiddenDuringRun = true
  }
  document.addEventListener('visibilitychange', onHide)

  let worker: BenchWorker | null = null
  try {
    status('Checking the model is installed')
    result.model.provenance = await modelProvenance()

    const audio: Decoded[] = []
    for (const clip of settings.clips) {
      status(`Decoding ${clip.file}`)
      audio.push(await decode(clip))
    }
    result.settings.clips = audio.map((a) => ({ id: a.clip.id, seconds: round(a.seconds, 2) }))

    for (let index = 1; index <= settings.loads; index++) {
      // The previous worker goes first, so two copies of the model are
      // never held at once and the peak is one model's worth.
      worker?.terminate()
      const cachedBefore = await modelCached()
      status(
        `Loading the model, ${index} of ${settings.loads}` +
          (cachedBefore === false ? ' (first download, about 80 MB)' : ''),
      )
      const t0 = performance.now()
      worker = new BenchWorker()
      const loaded = await worker.load(PACK)
      result.loads.push({
        index,
        cachedBefore,
        loadMs: Math.round(performance.now() - t0),
        pipelineMs: Math.round(loaded.loadMs),
        threads: loaded.threads,
        wasmHeapMb: mb(loaded.wasmHeapBytes),
      })
    }

    const total = settings.passes * audio.length + 1
    let done = 0
    const transcribe = async (pass: number, clip: Decoded) => {
      done++
      status(
        pass === 0
          ? `First inference after loading (${done} of ${total})`
          : `Pass ${pass} of ${settings.passes}: ${clip.clip.id} (${done} of ${total})`,
      )
      const reply = await worker!.transcribe(clip)
      const audioSeconds = sum(reply.segments.map((s) => s.audioSeconds))
      const inferenceMs = sum(reply.segments.map((s) => s.inferenceMs))
      result.passes.push({
        pass,
        clip: clip.clip.id,
        audioSeconds: round(audioSeconds, 2),
        inferenceMs: Math.round(inferenceMs),
        rtf: audioSeconds > 0 ? round(inferenceMs / 1000 / audioSeconds, 3) : 0,
        segments: reply.segments.map((s) => ({
          audioSeconds: round(s.audioSeconds, 2),
          inferenceMs: Math.round(s.inferenceMs),
        })),
        text: reply.text,
        wasmHeapMb: mb(reply.wasmHeapBytes),
      })
    }

    await transcribe(0, audio[0])
    for (let pass = 1; pass <= settings.passes; pass++) {
      for (const clip of audio) await transcribe(pass, clip)
    }
  } catch (err) {
    // Kept with whatever was measured before it: a model that will not load
    // on a given phone is itself the finding.
    result.error = (err as Error)?.message ?? String(err)
  } finally {
    worker?.terminate()
    screen.release()
    document.removeEventListener('visibilitychange', onHide)
    result.batteryEnd = await battery()
    result.durationSeconds = Math.round((performance.now() - started) / 1000)
    result.summary = summarise(result.loads, result.passes)
  }
  return result
}

type Result = Awaited<ReturnType<typeof run>>

/* ------------------------------------------------------------------ *
 * Page
 * ------------------------------------------------------------------ */

function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> = {},
  ...children: Array<Node | string | null>
): HTMLElementTagNameMap[K] {
  const element = Object.assign(document.createElement(tag), props)
  for (const child of children) if (child !== null) element.append(child)
  return element
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T

const seconds = (ms: number | null | undefined) => (ms === null || ms === undefined ? '–' : `${(ms / 1000).toFixed(1)} s`)

function table(head: string[], rows: Array<Array<string | number>>) {
  return h(
    'table',
    { className: 'data' },
    h('thead', {}, h('tr', {}, ...head.map((cell) => h('th', { textContent: cell })))),
    h('tbody', {}, ...rows.map((row) => h('tr', {}, ...row.map((cell) => h('td', { textContent: String(cell) }))))),
  )
}

/** Two columns, label and value, with no header row. */
function facts(rows: Array<[string, string]>) {
  return h(
    'table',
    { className: 'facts' },
    h('tbody', {}, ...rows.map(([label, value]) => h('tr', {}, h('th', { scope: 'row', textContent: label }), h('td', { textContent: value })))),
  )
}

function renderDevice(device: Awaited<ReturnType<typeof describeDevice>>) {
  const rows: Array<[string, string]> = [
    ['Device', device.model ?? 'not reported (desktop, or a browser without client hints)'],
    ['Platform', device.platform ?? device.userAgent],
    ['Browser', device.browser ?? '–'],
    ['Memory hint', device.deviceMemoryGb === null ? 'not reported' : `at least ${device.deviceMemoryGb} GB`],
    ['CPU cores', String(device.cores ?? '–')],
  ]
  $('device').replaceChildren(facts(rows))
}

function renderResult(result: Result) {
  const s = result.summary!
  const warnings: string[] = []
  if (result.error) warnings.push(`Stopped early: ${result.error}`)
  if (result.hiddenDuringRun) warnings.push('The tab was hidden during the run, so timings after that are throttled. Run again with the screen on.')
  if (!result.screenKeptOn) warnings.push('The screen could not be kept on. Turn off auto-lock for the run.')
  if (result.batteryStart && !result.batteryStart.charging) warnings.push('On battery: some phones slow the CPU when not charging. Note this with the results.')

  const rows: Array<[string, string]> = [
    [
      'Model load, cached',
      s.warmLoadMs
        ? `${seconds(s.warmLoadMs.median)} median of ${s.warmLoadMs.n} (${seconds(s.warmLoadMs.min)}–${seconds(s.warmLoadMs.max)})`
        : '–',
    ],
    ['Model load, first download', s.coldLoadMs === null ? 'not seen (already cached)' : seconds(s.coldLoadMs)],
    [
      'First inference',
      s.firstInference
        ? `${seconds(s.firstInference.inferenceMs)} for ${s.firstInference.audioSeconds.toFixed(1)} s of audio`
        : '–',
    ],
    [
      'Real-time factor',
      s.rtf === null
        ? '–'
        : `${s.rtf.toFixed(2)}` + (s.rtfPerClip ? ` (per clip ${s.rtfPerClip.min.toFixed(2)}–${s.rtfPerClip.max.toFixed(2)})` : ''),
    ],
    [
      // What the app transcribes each time the speaker pauses, so in use
      // this is the wait before that stretch of text appears.
      'Time per segment',
      s.segmentMs
        ? `median ${seconds(s.segmentMs.median)}, p90 ${seconds(s.segmentMs.p90)}, max ${seconds(s.segmentMs.max)} over ${s.segmentMs.n} segments`
        : '–',
    ],
    ['Peak model memory', s.peakWasmHeapMb === null ? 'not observable' : `${s.peakWasmHeapMb} MB (WebAssembly heap, upper bound)`],
    ['Threads', `${s.threads ?? '–'}${result.device.crossOriginIsolated ? '' : ' (no cross-origin isolation, as in the app)'}`],
    ['Run took', `${result.durationSeconds} s`],
  ]

  $('results').replaceChildren(
    ...warnings.map((w) => h('p', { className: 'warning', textContent: w })),
    h('h2', { textContent: 'Summary' }),
    facts(rows),
    h('h2', { textContent: 'Loads' }),
    table(
      ['#', 'Cached before', 'Load (s)', 'Heap (MB)'],
      result.loads.map((l) => [
        l.index,
        l.cachedBefore === null ? '?' : l.cachedBefore ? 'yes' : 'no',
        (l.loadMs / 1000).toFixed(1),
        l.wasmHeapMb ?? '–',
      ]),
    ),
    h('h2', { textContent: 'Passes' }),
    table(
      ['Pass', 'Clip', 'Audio (s)', 'Time (s)', 'RTF', 'Seg.'],
      result.passes.map((p) => [
        p.pass === 0 ? 'first' : p.pass,
        p.clip,
        p.audioSeconds.toFixed(1),
        (p.inferenceMs / 1000).toFixed(1),
        p.rtf.toFixed(2),
        p.segments.length,
      ]),
    ),
    h(
      'details',
      {},
      h('summary', { textContent: 'Transcripts (last pass), to check the model ran properly' }),
      ...lastTranscripts(result).map(([clip, text]) => h('p', {}, h('strong', { textContent: `${clip}: ` }), text)),
    ),
  )

  const json = JSON.stringify(result, null, 2)
  $<HTMLTextAreaElement>('json').value = json
  $('export').hidden = false
  $('copy').onclick = async () => {
    try {
      await navigator.clipboard.writeText(json)
      $('copy').textContent = 'Copied'
    } catch {
      $<HTMLTextAreaElement>('json').select()
      $('copy').textContent = 'Select the text below and copy it'
    }
  }
  $('download').onclick = () => {
    const name = `afyacore-bench-${(result.device.model ?? 'device').replace(/[^\w-]+/g, '_')}-${result.date.slice(0, 19).replace(/:/g, '')}.json`
    const link = h('a', { href: URL.createObjectURL(new Blob([json], { type: 'application/json' })), download: name })
    link.click()
    setTimeout(() => URL.revokeObjectURL(link.href), 10_000)
  }
}

function lastTranscripts(result: Result): Array<[string, string]> {
  const last = new Map<string, string>()
  for (const p of result.passes) last.set(p.clip, p.text)
  return [...last]
}

function readSettings(): Settings {
  const count = (id: string, fallback: number) => {
    const value = Math.round(Number($<HTMLInputElement>(id).value))
    return Number.isFinite(value) && value >= 1 ? Math.min(value, 20) : fallback
  }
  return {
    loads: count('loads', 3),
    passes: count('passes', 3),
    clips: CLIPS.filter((clip) => $<HTMLInputElement>(`clip-${clip.id}`).checked),
  }
}

function init() {
  $('clips').replaceChildren(
    ...CLIPS.map((clip) =>
      h(
        'label',
        { className: 'check' },
        h('input', { type: 'checkbox', id: `clip-${clip.id}`, checked: true }),
        ` ${clip.label}`,
      ),
    ),
  )
  void describeDevice().then(renderDevice)

  const button = $<HTMLButtonElement>('run')
  const status = $('status')
  button.onclick = async () => {
    const settings = readSettings()
    if (settings.clips.length === 0) {
      status.textContent = 'Pick at least one clip.'
      return
    }
    button.disabled = true
    $('settings').inert = true
    $('export').hidden = true
    $('copy').textContent = 'Copy JSON'
    $('results').replaceChildren()

    const started = Date.now()
    let current = ''
    const tick = () => (status.textContent = `${current} · ${Math.round((Date.now() - started) / 1000)} s`)
    const timer = setInterval(tick, 1000)
    const result = await run(settings, (text) => {
      current = text
      tick()
    })
    clearInterval(timer)

    status.textContent = result.error ? 'Stopped early. What was measured is below.' : 'Done.'
    renderResult(result)
    button.disabled = false
    $('settings').inert = false
  }
}

init()

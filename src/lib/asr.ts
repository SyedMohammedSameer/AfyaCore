/**
 * On-device speech recognition, so dictated audio never leaves the phone.
 *
 * ## What this replaces
 *
 * The browser's Web Speech API streams captured audio to the vendor's
 * recognition service. That made dictation the one place in this application
 * where patient data left the device at runtime, and voice is biometric data
 * under several of the regimes in docs/COMPLIANCE.md §5. `dictation.ts` gates
 * it behind an audited acknowledgement, which is honest but is not a fix.
 *
 * With the Whisper pack installed (`npm run vendor:whisper`), transcription
 * happens here, in a worker, on the device. Nothing is sent anywhere and there
 * is nothing to disclose.
 *
 * ## The shape of the problem
 *
 * Whisper is not a streaming recogniser. It transcribes a finished buffer,
 * which means a naive port would show the clinician nothing until they stopped
 * talking — worse than what it replaces. `audio.ts` cuts the microphone stream
 * into utterances at pauses; each one is transcribed as it closes and arrives
 * as a final result, which is the same shape the panel already consumes.
 *
 * Inference runs in a worker. On the main thread a base-model pass on a
 * mid-range Android blocks for seconds, and a frozen UI during a consultation
 * is not a trade worth making for one fewer file.
 *
 * ## What it costs
 *
 * Accuracy. Whisper base is good and it is not Google's production recogniser,
 * and the error that matters here is a drug name or a dose, because the
 * extractor downstream reads clinical fields out of this text. Two things
 * hold that down: the review screen shows per-field provenance and flags
 * anything uncertain before it can be saved, and the transcript itself stays
 * on screen next to the extraction. Neither makes the model better; both mean
 * a mistake is visible to the person who can correct it.
 */
import { resample, Segmenter, TARGET_RATE, type SegmenterOptions } from './audio'
import type { RecogniserLang, SpeechResult } from './speech'

/** Which vendored pack to look for, largest first: better is preferred. */
export const PACKS = ['whisper-base', 'whisper-tiny'] as const
export type Pack = (typeof PACKS)[number]

export const PACK_SIZES: Record<Pack, string> = {
  'whisper-base': '~81 MB',
  'whisper-tiny': '~45 MB',
}

export const modelPath = (pack: Pack) => `/models/${pack}`

/**
 * Whisper's own language codes, which are not BCP-47.
 *
 * Malagasy deliberately absent. Whisper's training data contains almost none
 * of it and the model will happily produce fluent, confident French for
 * Malagasy input rather than failing — a wrong transcription is worse here
 * than no transcription, because the extractor cannot tell the difference and
 * the clinician may not reread text that looks plausible. Malagasy dictation
 * therefore stays on the browser recogniser, behind the disclosure gate.
 */
const WHISPER_LANG: Partial<Record<RecogniserLang, string>> = {
  'fr-FR': 'french',
  'en-US': 'english',
}

export function packSupports(lang: RecogniserLang): boolean {
  return WHISPER_LANG[lang] !== undefined
}

/**
 * True when a pack has actually been placed on this origin.
 *
 * Fetches and parses the config rather than trusting a status code, for the
 * reason `openmed.ts` documents at length: a single-page app serves
 * `index.html` with HTTP 200 for any unknown path, so a `HEAD` for a model
 * that was never vendored comes back `ok: true` with a page of HTML. Telling
 * a facility that audio stays on the device when no model is installed would
 * be the worst bug this codebase can have, so "the file is there" has to be
 * distinguished from "the server answered".
 */
export async function isPackAvailable(
  pack: Pack,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  try {
    const response = await fetchImpl(`${modelPath(pack)}/config.json`, {
      headers: { accept: 'application/json' },
    })
    if (!response.ok) return false
    const config = (await response.json()) as { model_type?: unknown }
    return config?.model_type === 'whisper'
  } catch {
    // Non-JSON (the SPA fallback) lands here via the JSON parse throwing.
    return false
  }
}

/** The best installed pack, or null when none is. */
export async function installedPack(fetchImpl: typeof fetch = fetch): Promise<Pack | null> {
  for (const pack of PACKS) {
    if (await isPackAvailable(pack, fetchImpl)) return pack
  }
  return null
}

/* ------------------------------------------------------------------ *
 * Worker protocol
 * ------------------------------------------------------------------ */

export type ToWorker =
  | { type: 'load'; pack: Pack }
  | { type: 'transcribe'; id: number; audio: Float32Array; language: string }

export type FromWorker =
  | { type: 'ready' }
  | { type: 'text'; id: number; text: string }
  | { type: 'error'; id?: number; message: string }

/**
 * Text Whisper emits for audio containing no speech.
 *
 * Whisper hallucinates on silence, and does it consistently: the training data
 * was scraped with subtitles attached, so silent stretches map to whatever the
 * subtitler wrote there. "Sous-titres réalisés par la communauté d'Amara.org"
 * appearing in a consultation record is a documented failure of the model, not
 * a bug in the caller, and dropping the known strings is the standard defence.
 * `audio.ts` already refuses to send it silence, so this is the second line.
 */
const HALLUCINATIONS = [
  /sous-titres? (réalisés?|faits?) par/i,
  /amara\.org/i,
  /^\s*merci( d'avoir regardé.*)?[.!]?\s*$/i,
  /^\s*thanks? for watching[.!]?\s*$/i,
  /^\s*sous-titrage/i,
  /^\s*\[?(musique|music|applause|applaudissements|silence)\]?[.!]?\s*$/i,
  /^\s*you\s*$/i,
]

/** True when a transcript is one of Whisper's known silence artefacts. */
export function isHallucination(text: string): boolean {
  const trimmed = text.trim()
  if (trimmed.length === 0) return true
  return HALLUCINATIONS.some((re) => re.test(trimmed))
}

export interface AsrOptions {
  /** Injected so tests can drive the recogniser without a real worker. */
  createWorker?: () => Worker
  /** Injected so tests can drive it without a real microphone. */
  openMicrophone?: () => Promise<MediaStream>
  segmenter?: SegmenterOptions
}

/**
 * A recogniser that satisfies the same interface as the browser's.
 *
 * `speech.ts` promised this seam: "the on-device path slots in behind this
 * same interface later without touching a single component". It does, with
 * one caveat worth naming — results only ever arrive as final. There are no
 * interim results because there is no interim state: a segment is either
 * still being spoken or it has been transcribed.
 */
export class LocalWhisperRecogniser {
  private worker: Worker | null = null
  private stream: MediaStream | null = null
  private context: AudioContext | null = null
  private node: ScriptProcessorNode | null = null
  private segmenter: Segmenter | null = null
  private nextId = 1
  private stopped = true

  constructor(
    private readonly pack: Pack,
    private readonly options: AsrOptions = {},
  ) {}

  readonly requiresNetwork = false

  async start(
    lang: RecogniserLang,
    onResult: (r: SpeechResult) => void,
    onError: (e: string) => void,
  ): Promise<void> {
    const language = WHISPER_LANG[lang]
    if (!language) {
      onError('unsupported-language')
      return
    }

    this.stopped = false
    this.segmenter = new Segmenter(this.options.segmenter)

    try {
      // Reused across dictations, deliberately. `start` used to create one
      // every time, which meant a clinician who stopped and started again
      // leaked the first worker — still holding a parsed 80 MB graph — and
      // paid the load cost a second time. It also orphaned the tail segment
      // `stop` had just sent to the old worker, so the last sentence of the
      // previous dictation was silently lost.
      this.worker ??= this.options.createWorker
        ? this.options.createWorker()
        : new Worker(new URL('./asr.worker.ts', import.meta.url), { type: 'module' })

      this.worker.onmessage = (event: MessageEvent<FromWorker>) => {
        const message = event.data
        if (message.type === 'text') {
          // Dropped silently rather than surfaced as an error: it is not a
          // failure, it is the model having nothing to say about a segment.
          if (!isHallucination(message.text)) {
            onResult({ transcript: message.text.trim(), isFinal: true })
          }
        } else if (message.type === 'error') {
          onError(message.message)
        }
      }
      this.worker.onerror = () => onError('worker')
      // Sent every start. The worker guards against loading twice, and the
      // second message costs one structured clone of a small object.
      this.worker.postMessage({ type: 'load', pack: this.pack } satisfies ToWorker)

      const open = this.options.openMicrophone
        ? this.options.openMicrophone
        : () =>
            navigator.mediaDevices.getUserMedia({
              audio: {
                // The microphone is being held in a consultation room, not a
                // studio. These are the browser's own DSP and they help.
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
              },
            })

      this.stream = await open()
      if (this.stopped) {
        // The user pressed stop while the permission prompt was up. Without
        // this the microphone stays open with no way to close it.
        this.releaseStream()
        return
      }

      // The rate is *requested*, not guaranteed: a browser may hand back its
      // hardware rate instead, so `resample` reads what actually arrived
      // rather than trusting what was asked for.
      this.context = new AudioContext({ sampleRate: TARGET_RATE })
      const source = this.context.createMediaStreamSource(this.stream)
      // ScriptProcessorNode is deprecated in favour of AudioWorklet, and is
      // used anyway: an AudioWorklet needs a separately served module file,
      // which is one more thing to cache offline and one more way for a
      // deployment to half-work. The deprecation has no removal date and the
      // load here is a copy of a few hundred floats per frame.
      this.node = this.context.createScriptProcessor(4096, 1, 1)
      this.node.onaudioprocess = (event) => {
        // The segmenter is the single signal that this is still running:
        // `stop` nulls it, and nothing else creates one. Testing `stopped` as
        // well read as belt and braces and was neither — a mutation test
        // deleted it and nothing failed, because there is no state in which
        // the two disagree.
        if (!this.segmenter) return
        const raw = event.inputBuffer.getChannelData(0)
        // Copied: the browser reuses this buffer for the next frame, so a
        // segment holding references to it would be overwritten with silence
        // by the time it was transcribed.
        const frame = resample(
          new Float32Array(raw),
          event.inputBuffer.sampleRate,
          TARGET_RATE,
        )
        const segment = this.segmenter.push(frame)
        if (segment) this.send(segment, language)
      }
      source.connect(this.node)
      // ScriptProcessorNode does not fire unless it is connected to a
      // destination. Nothing is played: the graph terminates at the speakers
      // but the node writes no output, so the room stays silent.
      this.node.connect(this.context.destination)
    } catch (err) {
      const name = (err as { name?: string })?.name
      onError(name === 'NotAllowedError' ? 'not-allowed' : String(err))
      this.stop()
    }
  }

  private send(audio: Float32Array, language: string): void {
    // Transferred rather than copied: a 25-second segment is 1.6 MB and
    // structured-cloning it on every pause is real jank on a cheap phone.
    this.worker?.postMessage({ type: 'transcribe', id: this.nextId++, audio, language }, [
      audio.buffer as ArrayBuffer,
    ])
  }

  /**
   * Stop listening, transcribing whatever was still being spoken.
   *
   * The microphone is released immediately but the worker is not: the last
   * segment is still in flight, and killing the worker here would silently
   * drop the end of the consultation. `dispose` is the one that tears down.
   */
  stop(language: RecogniserLang = 'fr-FR'): void {
    this.stopped = true
    const tail = this.segmenter?.flush()
    const whisperLang = WHISPER_LANG[language]
    if (tail && whisperLang) this.send(tail, whisperLang)
    this.segmenter = null

    if (this.node) {
      this.node.onaudioprocess = null
      this.node.disconnect()
      this.node = null
    }
    if (this.context) {
      void this.context.close().catch(() => {})
      this.context = null
    }
    this.releaseStream()
  }

  private releaseStream(): void {
    // A track left live keeps the recording indicator on and drains the
    // battery, which a clinician reads as the app listening to them.
    this.stream?.getTracks().forEach((track) => track.stop())
    this.stream = null
  }

  /** Release the worker and the model it holds. Called when the panel unmounts. */
  dispose(): void {
    this.stop()
    this.worker?.terminate()
    this.worker = null
    // A disposed recogniser can be started again; it just pays for the model
    // load once more. Resetting the id keeps the two runs from sharing a
    // sequence, which only matters for reading a message trace.
    this.nextId = 1
  }
}

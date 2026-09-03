/**
 * Speech input, behind an interface.
 *
 * v1 uses the browser's built-in recogniser: it costs zero bytes of bundle, is
 * already present on every Android Chrome, and handles French well.
 *
 * ## ⚠️ It sends audio off the device
 *
 * The Web Speech API is not local. In Chrome and Edge the captured audio is
 * streamed to the browser vendor's recognition service, which is why
 * `requiresNetwork` is true. That means **a clinician dictating a consultation
 * sends the patient's name, complaint and diagnosis, in their own voice, to a
 * third party** — and voice is biometric data in several of the regimes in
 * docs/COMPLIANCE.md §5.
 *
 * This module previously said only "it needs network", and SECURITY.md claimed
 * the app made no third-party runtime call at all. Both were wrong in the same
 * direction, and it is the worst direction: understating where patient data
 * goes. Needing a network and sending audio to Google are different facts, and
 * only one of them is a disclosure.
 *
 * Two things follow, and neither is optional:
 *
 *  1. **Prefer on-device recognition.** Chrome 138+ exposes `processLocally`
 *     and a static `available()`; where the language pack is installed, nothing
 *     leaves. We ask for it every time and report which mode we got.
 *  2. **Disclose when it is not local.** `src/lib/dictation.ts` gates remote
 *     recognition behind an explicit, audited acknowledgement by an
 *     administrator. Until that is given, dictation stays off and the manual
 *     form — which always works and never leaves the device — is the path.
 *
 * The on-device Malagasy path (ONNX Whisper / w2v-BERT) slots in behind this
 * same interface later without touching a single component, and would make the
 * disclosure unnecessary rather than merely honest.
 */

export type RecogniserLang = 'fr-FR' | 'mg-MG' | 'en-US'

export interface SpeechResult {
  transcript: string
  isFinal: boolean
}

/**
 * Where the audio is processed.
 *
 * `remote` is the honest name for what the Web Speech API does by default, and
 * naming it is the point: a facility cannot weigh a disclosure it cannot see.
 */
export type RecognitionMode = 'on-device' | 'remote'

export interface SpeechRecogniser {
  readonly available: boolean
  /** True when this recogniser needs connectivity to produce results. */
  readonly requiresNetwork: boolean
  /**
   * Whether on-device recognition can be used for this language.
   *
   * Resolves to `remote` whenever we cannot prove otherwise. Assuming local
   * because a check was inconclusive is exactly how a false privacy claim gets
   * made, so the uncertain case takes the answer that requires disclosure.
   */
  modeFor(lang: RecogniserLang): Promise<RecognitionMode>
  start(
    lang: RecogniserLang,
    onResult: (r: SpeechResult) => void,
    onError: (e: string) => void,
  ): void
  stop(): void
}

// The Web Speech API is still vendor-prefixed on Chrome and absent from the
// TS DOM lib, so it is typed structurally rather than pulled in wholesale.
interface SpeechRecognitionLike {
  lang: string
  continuous: boolean
  interimResults: boolean
  maxAlternatives: number
  /** Chrome 138+. Absent elsewhere, which is why it is optional and probed. */
  processLocally?: boolean
  start(): void
  stop(): void
  abort(): void
  onresult: ((e: SpeechRecognitionEventLike) => void) | null
  onerror: ((e: { error: string }) => void) | null
  onend: (() => void) | null
}

interface SpeechRecognitionEventLike {
  resultIndex: number
  results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>
}

type RecognitionCtor = new () => SpeechRecognitionLike

function getCtor(): RecognitionCtor | undefined {
  const w = window as unknown as {
    SpeechRecognition?: RecognitionCtor
    webkitSpeechRecognition?: RecognitionCtor
  }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition
}

/**
 * Ask the browser whether it can recognise this language without the network.
 *
 * `SpeechRecognition.available()` is Chrome 138+ and returns one of
 * `available` / `downloadable` / `downloading` / `unavailable`. Only
 * `available` counts: `downloadable` means the pack is not there yet, and
 * starting anyway would fall back to the remote service — which is precisely
 * the silent case this exists to prevent.
 */
async function localAvailable(lang: RecogniserLang): Promise<boolean> {
  const Ctor = getCtor() as unknown as
    | { available?: (o: { langs: string[]; processLocally: boolean }) => Promise<string> }
    | undefined
  if (typeof Ctor?.available !== 'function') return false
  try {
    return (await Ctor.available({ langs: [lang], processLocally: true })) === 'available'
  } catch {
    return false
  }
}

class WebSpeechRecogniser implements SpeechRecogniser {
  private recognition: SpeechRecognitionLike | null = null
  private stopped = false

  readonly available = getCtor() !== undefined
  readonly requiresNetwork = true

  async modeFor(lang: RecogniserLang): Promise<RecognitionMode> {
    return (await localAvailable(lang)) ? 'on-device' : 'remote'
  }

  start(lang: RecogniserLang, onResult: (r: SpeechResult) => void, onError: (e: string) => void): void {
    const Ctor = getCtor()
    if (!Ctor) {
      onError('unsupported')
      return
    }
    this.stop()
    this.stopped = false

    const recognition = new Ctor()
    recognition.lang = lang
    // Asked for unconditionally. Where the browser honours it the audio never
    // leaves; where it does not, the property is simply ignored and the
    // disclosure gate in dictation.ts is what stands between the microphone
    // and a third party.
    recognition.processLocally = true
    // Consultations are dictated in several breaths; a recogniser that stops at
    // the first pause would truncate half of them.
    recognition.continuous = true
    recognition.interimResults = true
    recognition.maxAlternatives = 1

    recognition.onresult = (event) => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i]
        if (!result) continue
        const alt = result[0]
        if (!alt) continue
        onResult({ transcript: alt.transcript, isFinal: result.isFinal })
      }
    }
    recognition.onerror = (e) => {
      // `aborted` is what a deliberate stop() looks like; it is not a failure.
      if (e.error !== 'aborted') onError(e.error)
    }
    recognition.onend = () => {
      // Chrome ends the session on silence. Restart unless the user asked to stop.
      if (!this.stopped && this.recognition === recognition) {
        try {
          recognition.start()
        } catch {
          /* already restarting */
        }
      }
    }

    this.recognition = recognition
    try {
      recognition.start()
    } catch (err) {
      onError(String(err))
    }
  }

  stop(): void {
    this.stopped = true
    if (this.recognition) {
      try {
        this.recognition.abort()
      } catch {
        /* ignore */
      }
      this.recognition = null
    }
  }
}

export const recogniser: SpeechRecogniser = new WebSpeechRecogniser()

/**
 * Speak text aloud.
 *
 * Android ships no Malagasy voice, so a Malagasy request will silently fall back
 * to whatever voice exists and sound wrong. Callers get `false` back when no
 * matching voice was found so the UI can show the text large instead of
 * pretending it was spoken. See docs/MODEL-RESEARCH.md §3 for the phrase-bank
 * plan that removes this limitation.
 */
export function speak(text: string, lang: RecogniserLang): boolean {
  if (!('speechSynthesis' in window)) return false
  const voices = window.speechSynthesis.getVoices()
  const prefix = lang.slice(0, 2)
  const voice = voices.find((v) => v.lang.toLowerCase().startsWith(prefix))
  if (!voice) return false

  window.speechSynthesis.cancel()
  const utterance = new SpeechSynthesisUtterance(text)
  utterance.voice = voice
  utterance.lang = voice.lang
  // Instructions are being given to a patient who may be anxious and is
  // certainly not a native speaker of the clinician's register.
  utterance.rate = 0.85
  window.speechSynthesis.speak(utterance)
  return true
}

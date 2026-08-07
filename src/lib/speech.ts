/**
 * Speech input, behind an interface.
 *
 * v1 uses the browser's built-in recogniser: it costs zero bytes of bundle, is
 * already present on every Android Chrome, and handles French well. Its cost is
 * that it needs network. That is an acceptable trade *only* because voice is an
 * accelerator over a manual form that always works, see docs/MODEL-RESEARCH.md §2.1.
 *
 * The on-device Malagasy path (ONNX Whisper / w2v-BERT) slots in behind this
 * same interface later without touching a single component.
 */

export type RecogniserLang = 'fr-FR' | 'mg-MG' | 'en-US'

export interface SpeechResult {
  transcript: string
  isFinal: boolean
}

export interface SpeechRecogniser {
  readonly available: boolean
  /** True when this recogniser needs connectivity to produce results. */
  readonly requiresNetwork: boolean
  start(lang: RecogniserLang, onResult: (r: SpeechResult) => void, onError: (e: string) => void): void
  stop(): void
}

// The Web Speech API is still vendor-prefixed on Chrome and absent from the
// TS DOM lib, so it is typed structurally rather than pulled in wholesale.
interface SpeechRecognitionLike {
  lang: string
  continuous: boolean
  interimResults: boolean
  maxAlternatives: number
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

class WebSpeechRecogniser implements SpeechRecogniser {
  private recognition: SpeechRecognitionLike | null = null
  private stopped = false

  readonly available = getCtor() !== undefined
  readonly requiresNetwork = true

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

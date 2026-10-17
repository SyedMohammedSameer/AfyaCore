/// <reference lib="webworker" />
/**
 * Whisper inference, off the main thread.
 *
 * A base-model pass over a 20-second segment takes seconds of CPU on the
 * phones this targets. On the main thread that is a frozen interface in the
 * middle of a consultation, so the model lives here and the page talks to it
 * by message.
 *
 * The pipeline is loaded once and kept. Loading is the expensive part —
 * parsing an 80 MB graph and allocating its tensors — and a clinician
 * dictates several times per patient. How it is loaded and called lives in
 * `whisperPipeline.ts`, which the phone benchmark runs too.
 */
import type { FromWorker, ToWorker } from './asr'
import { loadWhisper, TRANSCRIBE_OPTIONS, transcriptText, type Transcriber } from './whisperPipeline'

let transcriber: Transcriber | null = null
let loading: Promise<Transcriber> | null = null

const post = (message: FromWorker) => self.postMessage(message)

self.onmessage = async (event: MessageEvent<ToWorker>) => {
  const message = event.data

  if (message.type === 'load') {
    try {
      // Guarded by the promise rather than the result: two messages arriving
      // before the first load resolves would otherwise parse the graph twice
      // and hold two copies of it in memory.
      loading ??= loadWhisper(message.pack)
      transcriber = await loading
      post({ type: 'ready' })
    } catch (err) {
      loading = null
      post({ type: 'error', message: `load: ${(err as Error)?.message ?? String(err)}` })
    }
    return
  }

  if (message.type === 'transcribe') {
    try {
      if (!transcriber) {
        if (!loading) throw new Error('no model loaded')
        transcriber = await loading
      }
      const output = await transcriber(message.audio, {
        language: message.language,
        ...TRANSCRIBE_OPTIONS,
      })
      post({ type: 'text', id: message.id, text: transcriptText(output) })
    } catch (err) {
      post({
        type: 'error',
        id: message.id,
        message: `transcribe: ${(err as Error)?.message ?? String(err)}`,
      })
    }
  }
}

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
 * dictates several times per patient.
 */
import type { FromWorker, ToWorker } from './asr'

type Transcriber = (
  audio: Float32Array,
  options: Record<string, unknown>,
) => Promise<{ text?: string } | Array<{ text?: string }>>

let transcriber: Transcriber | null = null
let loading: Promise<Transcriber> | null = null

const post = (message: FromWorker) => self.postMessage(message)

async function load(pack: string): Promise<Transcriber> {
  const { pipeline, env } = await import('@huggingface/transformers')

  // Every byte from this origin. The Hub is unreachable from the connections
  // this project exists for, and a service worker cannot reliably cache an
  // opaque cross-origin response, so a model fetched from a CDN would pass
  // testing and fail in a village.
  env.allowRemoteModels = false
  env.allowLocalModels = true
  env.localModelPath = '/models/'
  if (env.backends?.onnx?.wasm) env.backends.onnx.wasm.wasmPaths = '/ort/'

  const pipe = await pipeline('automatic-speech-recognition', pack, {
    // The transformers.js default for the wasm device, stated rather than
    // inherited: we serve a wasm-only ONNX Runtime core on purpose, and the
    // fp16 graphs in these repos are the WebGPU path.
    dtype: 'q8',
    device: 'wasm',
  })
  return pipe as unknown as Transcriber
}

self.onmessage = async (event: MessageEvent<ToWorker>) => {
  const message = event.data

  if (message.type === 'load') {
    try {
      // Guarded by the promise rather than the result: two messages arriving
      // before the first load resolves would otherwise parse the graph twice
      // and hold two copies of it in memory.
      loading ??= load(message.pack)
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
        task: 'transcribe',
        // Greedy. Beam search costs a multiple of the compute for a small
        // gain, and the compute is the constraint on the phones this targets.
        // The clinician reads the transcript on screen either way.
        do_sample: false,
        // Whisper's default is to condition each window on the previous one,
        // which is how a single mistranscription becomes a paragraph of
        // invented text. Segments here are independent utterances, so there
        // is nothing to gain from the coupling and a repetition loop to lose.
        condition_on_previous_text: false,
        // No timestamps: they cost tokens and the caller wants text.
        return_timestamps: false,
      })
      const text = Array.isArray(output)
        ? output.map((part) => part?.text ?? '').join(' ')
        : (output?.text ?? '')
      post({ type: 'text', id: message.id, text })
    } catch (err) {
      post({
        type: 'error',
        id: message.id,
        message: `transcribe: ${(err as Error)?.message ?? String(err)}`,
      })
    }
  }
}

/**
 * How the on-device Whisper pack is loaded and called.
 *
 * Shared by the dictation worker (`asr.worker.ts`) and the phone benchmark
 * (`bench.html`). One definition rather than two copies, because a benchmark
 * that loads the model with different settings from the app is measuring a
 * different program, and nothing would say so.
 *
 * Imports transformers.js dynamically: whoever calls `loadWhisper` decides
 * when the 500 kB library and its runtime are paid for.
 */

export type WhisperOutput = { text?: string } | Array<{ text?: string }>

export type Transcriber = (
  audio: Float32Array,
  options: Record<string, unknown>,
) => Promise<WhisperOutput>

export async function loadWhisper(pack: string): Promise<Transcriber> {
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
    session_options: {
      /*
       * Found by pressing the button on the production build. The ONNX
       * Runtime build this transformers.js pins rewrites quantised
       * MatMul nodes into MatMulNBits at session creation, and the vendored
       * decoder graph is quantised in the older layout that rewrite does
       * not understand: "TransposeDQWeightsForMatMulNBits: missing required
       * scale for model.decoder.embed_tokens". The decoder then never
       * opens, on every phone, while the panel says the model is installed.
       * Leaving the graph's own DequantizeLinear and MatMul in place, which
       * is what this switch does, costs some speed on a large matmul and
       * gains a model that loads.
       */
      extra: { session: { disable_quant_qdq: '1' } },
    },
  })
  return pipe as unknown as Transcriber
}

/** Decoding settings for one segment; the caller adds `language`. */
export const TRANSCRIBE_OPTIONS = {
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
} as const

export function transcriptText(output: WhisperOutput): string {
  return Array.isArray(output)
    ? output.map((part) => part?.text ?? '').join(' ')
    : (output?.text ?? '')
}

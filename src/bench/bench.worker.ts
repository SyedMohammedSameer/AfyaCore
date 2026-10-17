/// <reference lib="webworker" />
/**
 * The speech model under measurement, for `bench.html`.
 *
 * Loads and calls Whisper through `whisperPipeline.ts`, the code the
 * dictation worker runs, and adds only clocks and a memory probe. Audio goes
 * through the app's own `resample` and `Segmenter`, fed frame by frame the
 * way `transcribeUrl` feeds them, so the model is timed on the segments a
 * dictation would produce rather than on one long clip. That changes the
 * numbers: Whisper pads every input to a 30-second window, so a short
 * segment costs nearly as much encoder time as a long one.
 */
import { resample, Segmenter, TARGET_RATE } from '../lib/audio'
import { loadWhisper, TRANSCRIBE_OPTIONS, transcriptText, type Transcriber } from '../lib/whisperPipeline'
import type { BenchFromWorker, BenchToWorker, MemorySample, SegmentTiming } from './protocol'

/*
 * Peak memory, read from the runtime itself.
 *
 * ONNX Runtime's WebAssembly build creates its linear memory with
 * `new WebAssembly.Memory(...)`, once per worker, and grows it as the weights
 * and activations need. Linear memory never shrinks, so its size at any
 * moment is the peak so far, and no sampling interval can miss it. It is an
 * upper bound by up to a fifth: the runtime grows by up to 20% more than each
 * allocation asks for, and those pages stay untouched. Nothing in the
 * onnxruntime-web API hands the object out, so the constructor is wrapped
 * here, before the runtime is imported, to catch it being made.
 *
 * The worker's JavaScript heap is not reported: Chrome's
 * `performance.memory` does not exist in workers.
 */
const memories: WebAssembly.Memory[] = []
WebAssembly.Memory = new Proxy(WebAssembly.Memory, {
  construct(target, args, newTarget) {
    const memory = Reflect.construct(target, args, newTarget) as WebAssembly.Memory
    memories.push(memory)
    return memory
  },
})

function memory(): MemorySample {
  return {
    wasmHeapBytes: memories.length ? memories.reduce((sum, m) => sum + m.buffer.byteLength, 0) : null,
  }
}

/** Cut a recording into the segments live dictation would have produced. */
function segments(audio: Float32Array): Float32Array[] {
  const segmenter = new Segmenter()
  const out: Float32Array[] = []
  // The frame size the microphone delivers. Copied because the segmenter
  // keeps references to what it is given.
  const FRAME = 4096
  for (let at = 0; at < audio.length; at += FRAME) {
    const segment = segmenter.push(new Float32Array(audio.subarray(at, at + FRAME)))
    if (segment) out.push(segment)
  }
  const tail = segmenter.flush()
  if (tail) out.push(tail)
  return out
}

let transcriber: Transcriber | null = null

const post = (message: BenchFromWorker) => self.postMessage(message)

self.onmessage = async (event: MessageEvent<BenchToWorker>) => {
  const message = event.data
  try {
    if (message.type === 'load') {
      const started = performance.now()
      transcriber = await loadWhisper(message.pack)
      const loadMs = performance.now() - started
      // Read after loading: the runtime settles the thread count when it
      // starts, and drops to one without cross-origin isolation.
      const { env } = await import('@huggingface/transformers')
      const threads = env.backends?.onnx?.wasm?.numThreads
      post({ type: 'loaded', loadMs, threads: typeof threads === 'number' ? threads : null, ...memory() })
      return
    }

    if (!transcriber) throw new Error('no model loaded')
    const timings: SegmentTiming[] = []
    const texts: string[] = []
    for (const segment of segments(resample(message.audio, message.sampleRate, TARGET_RATE))) {
      const started = performance.now()
      const output = await transcriber(segment, { language: message.language, ...TRANSCRIBE_OPTIONS })
      timings.push({ audioSeconds: segment.length / TARGET_RATE, inferenceMs: performance.now() - started })
      texts.push(transcriptText(output).trim())
    }
    post({ type: 'transcribed', segments: timings, text: texts.join(' '), ...memory() })
  } catch (err) {
    post({ type: 'error', message: (err as Error)?.message ?? String(err) })
  }
}

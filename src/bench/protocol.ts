/** Messages between `bench.html` and `bench.worker.ts`. */

export type BenchToWorker =
  | { type: 'load'; pack: string }
  | { type: 'transcribe'; audio: Float32Array; sampleRate: number; language: string }

export interface MemorySample {
  /**
   * The model runtime's WebAssembly heap. Linear memory only ever grows, so
   * this is also the most it has used so far. Null if the probe saw no heap.
   */
  wasmHeapBytes: number | null
}

export interface SegmentTiming {
  audioSeconds: number
  inferenceMs: number
}

export type BenchFromWorker =
  | ({ type: 'loaded'; loadMs: number; threads: number | null } & MemorySample)
  | ({ type: 'transcribed'; segments: SegmentTiming[]; text: string } & MemorySample)
  | { type: 'error'; message: string }

/**
 * Turning a microphone into something Whisper can read.
 *
 * Two jobs, both pure functions over `Float32Array`, both here rather than in
 * the recogniser so they can be tested without a browser, a microphone or a
 * 45 MB model.
 *
 *  1. **Resampling.** Whisper is trained on 16 kHz mono. A phone's microphone
 *     is typically 44.1 or 48 kHz, and `AudioContext({ sampleRate: 16000 })`
 *     is a request the browser is free to ignore, so the rate has to be
 *     handled rather than assumed.
 *  2. **Segmentation.** Whisper transcribes a finished buffer; it does not
 *     stream. A consultation dictated in one go would therefore produce
 *     nothing on screen until the clinician stopped talking, which is worse
 *     than the browser recogniser it replaces. Cutting the audio at pauses
 *     gives back incremental results.
 */

/** What Whisper expects, and what every model file here is built around. */
export const TARGET_RATE = 16_000

/**
 * Resample mono PCM by linear interpolation.
 *
 * Not the highest-quality resampler available — a windowed sinc would be
 * better — and deliberately so. Whisper's own front end immediately reduces
 * this to an 80-bin log-mel spectrogram at 100 frames per second, which
 * discards far more detail than the interpolation error introduces. The
 * aliasing that linear interpolation leaves lives above 8 kHz, where a mel
 * filterbank has almost no resolution and speech has almost no energy.
 *
 * Downsampling without a low-pass first is the usual objection. It is real,
 * and it is the reason this is not used for anything but speech: at 48 kHz to
 * 16 kHz the fold-back lands in the 5.3 to 8 kHz band, which carries fricative
 * energy and no phonemic distinction Whisper depends on.
 */
export function resample(input: Float32Array, from: number, to: number): Float32Array {
  if (from === to || input.length === 0) return input
  const ratio = from / to
  const length = Math.floor(input.length / ratio)
  const out = new Float32Array(length)
  for (let i = 0; i < length; i++) {
    const at = i * ratio
    const low = Math.floor(at)
    const high = Math.min(low + 1, input.length - 1)
    const t = at - low
    out[i] = input[low]! * (1 - t) + input[high]! * t
  }
  return out
}

/** Root mean square amplitude, the cheapest usable measure of "is anyone talking". */
export function rms(frame: Float32Array): number {
  if (frame.length === 0) return 0
  let sum = 0
  for (let i = 0; i < frame.length; i++) sum += frame[i]! * frame[i]!
  return Math.sqrt(sum / frame.length)
}

export interface SegmenterOptions {
  sampleRate?: number
  /**
   * Amplitude below which a frame counts as silence.
   *
   * A fixed threshold rather than an adaptive noise floor. A waiting room is
   * loud and an adaptive floor rises to meet it, at which point quiet speech
   * is classified as silence and the segment never closes. A fixed, low
   * threshold fails in the safe direction: in a noisy room segments close on
   * the timeout instead, which costs latency rather than words.
   */
  silenceThreshold?: number
  /** How long a pause must last before a segment is closed, in seconds. */
  silenceSeconds?: number
  /**
   * Shortest segment worth transcribing, in seconds.
   *
   * Whisper reads context. Handing it "trente-huit neuf" alone invites a
   * transcription with no idea it is a temperature, and clinicians pause
   * between items constantly, so a segmenter that cut at every pause would
   * hand over a stream of two-word fragments. A segment has to be worth its
   * own inference pass before a pause is allowed to end it.
   */
  minSeconds?: number
  /**
   * Longest segment, in seconds.
   *
   * Whisper's receptive field is 30 seconds and anything longer is truncated
   * or chunked internally, so a segment must close before then whether anyone
   * paused or not. 25 leaves room for the tail of a word.
   */
  maxSeconds?: number
  /**
   * How much audio before the first voiced frame to keep, in seconds.
   *
   * Silence ahead of speech is not buffered at all, but a little of it has to
   * be, because the energy threshold is crossed part-way into the first
   * syllable and a segment that starts exactly there begins with a clipped
   * consonant. 0.25s is enough for a plosive onset and short enough to be
   * bounded.
   */
  preRollSeconds?: number
}

const DEFAULTS: Required<SegmenterOptions> = {
  sampleRate: TARGET_RATE,
  silenceThreshold: 0.012,
  silenceSeconds: 0.7,
  minSeconds: 3,
  maxSeconds: 25,
  preRollSeconds: 0.25,
}

/**
 * Cuts a stream of microphone frames into utterances at pauses.
 *
 * Stateful by necessity and small on purpose: it takes frames in and hands
 * finished `Float32Array`s out, and knows nothing about workers, models or
 * promises. Everything about when to transcribe is decided here, where it can
 * be tested by feeding it arithmetic instead of audio.
 */
export class Segmenter {
  private readonly options: Required<SegmenterOptions>
  private buffer: Float32Array[] = []
  private samples = 0
  private silentSamples = 0
  /** Whether anything above the threshold has been heard in this segment. */
  private voiced = false
  /**
   * Recent silent frames, held only until speech starts.
   *
   * Silence before the first voiced frame is deliberately not accumulated
   * into the segment. Buffering it looks harmless and is not: the pause that
   * closes one segment continues into the next, so a clinician who stops
   * talking for a minute would open the following segment with a minute of
   * leading silence, and the maximum-length cut would then fire part-way
   * through their first sentence. A test caught exactly that.
   */
  private preRoll: Float32Array[] = []
  private preRollSamples = 0

  constructor(options: SegmenterOptions = {}) {
    this.options = { ...DEFAULTS, ...options }
  }

  private get seconds(): number {
    return this.samples / this.options.sampleRate
  }

  /**
   * Add a frame. Returns a finished segment when this frame ended one.
   *
   * Returning the segment rather than firing a callback keeps this
   * synchronous and pure enough to test: the caller decides what a finished
   * segment is for.
   */
  push(frame: Float32Array): Float32Array | null {
    if (frame.length === 0) return null

    if (rms(frame) < this.options.silenceThreshold && !this.voiced) {
      // Still waiting for someone to speak. Hold a bounded pre-roll and
      // nothing else, so a long silence costs no memory and no segment time.
      this.preRoll.push(frame)
      this.preRollSamples += frame.length
      const limit = this.options.preRollSeconds * this.options.sampleRate
      while (this.preRollSamples > limit && this.preRoll.length > 1) {
        this.preRollSamples -= this.preRoll.shift()!.length
      }
      return null
    }

    if (!this.voiced) {
      for (const held of this.preRoll) {
        this.buffer.push(held)
        this.samples += held.length
      }
      this.preRoll = []
      this.preRollSamples = 0
    }

    this.buffer.push(frame)
    this.samples += frame.length

    if (rms(frame) >= this.options.silenceThreshold) {
      this.voiced = true
      this.silentSamples = 0
    } else {
      this.silentSamples += frame.length
    }

    if (this.seconds >= this.options.maxSeconds) return this.close()

    const pause = this.silentSamples / this.options.sampleRate
    if (this.voiced && pause >= this.options.silenceSeconds && this.seconds >= this.options.minSeconds) {
      return this.close()
    }
    return null
  }

  /**
   * Close the current segment and hand it over, as when the user stops.
   *
   * Returns null for a segment that never had any speech in it, so releasing
   * the button after a silence does not spend an inference pass on room tone
   * — and, more to the point, does not risk Whisper hallucinating a sentence
   * onto it, which is its well-documented behaviour on silent input.
   */
  flush(): Float32Array | null {
    if (!this.voiced) {
      this.reset()
      return null
    }
    return this.close()
  }

  /**
   * Concatenate the buffer and start over.
   *
   * Only ever reached with speech in the buffer. It used to repeat `flush`'s
   * "was anything voiced" check, and once leading silence stopped being
   * buffered that copy became unreachable: an unvoiced segment now has no
   * samples at all, so neither the maximum-length cut nor the pause cut can
   * fire on one. A mutation test found it by deleting the check and watching
   * nothing fail. One guard, in `flush`, where the caller actually is.
   */
  private close(): Float32Array {
    const out = new Float32Array(this.samples)
    let at = 0
    for (const chunk of this.buffer) {
      out.set(chunk, at)
      at += chunk.length
    }
    this.reset()
    return out
  }

  private reset(): void {
    this.buffer = []
    this.samples = 0
    this.silentSamples = 0
    this.voiced = false
    this.preRoll = []
    this.preRollSamples = 0
  }
}

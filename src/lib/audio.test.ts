import { describe, expect, it } from 'vitest'
import { resample, rms, Segmenter, TARGET_RATE } from './audio'

/** A sine wave, which is what a resampler's error is easiest to measure against. */
function tone(seconds: number, rate: number, hz = 440, amplitude = 0.5): Float32Array {
  const out = new Float32Array(Math.round(seconds * rate))
  for (let i = 0; i < out.length; i++) out[i] = amplitude * Math.sin((2 * Math.PI * hz * i) / rate)
  return out
}

function silence(seconds: number, rate = TARGET_RATE): Float32Array {
  return new Float32Array(Math.round(seconds * rate))
}

/** Feed a buffer to a segmenter in frames, as a microphone would. */
function feed(seg: Segmenter, audio: Float32Array, frame = 1024): Float32Array[] {
  const closed: Float32Array[] = []
  for (let at = 0; at < audio.length; at += frame) {
    const out = seg.push(audio.subarray(at, Math.min(at + frame, audio.length)))
    if (out) closed.push(out)
  }
  return closed
}

describe('resample', () => {
  it('is a no-op at the same rate, without copying', () => {
    const input = tone(0.1, TARGET_RATE)
    expect(resample(input, TARGET_RATE, TARGET_RATE)).toBe(input)
  })

  it('produces the duration the new rate implies', () => {
    // The whole point: one second in must stay one second long, or every
    // timestamp Whisper produces is wrong by the ratio of the two rates.
    const input = tone(1, 48_000)
    const out = resample(input, 48_000, TARGET_RATE)
    expect(out.length).toBe(TARGET_RATE)
  })

  it('upsamples as well as down', () => {
    expect(resample(tone(1, 8_000), 8_000, TARGET_RATE).length).toBe(TARGET_RATE)
  })

  it('preserves a tone well inside the new Nyquist limit', () => {
    // 440 Hz is far below 8 kHz, so linear interpolation should barely touch
    // it. If this ever drifts the resampler is broken in a way that matters:
    // speech lives here.
    //
    // 44.1 kHz rather than 48: 48/16 is exactly 3, so every output sample
    // lands on an input sample and interpolation is never exercised at all.
    // The first version of this test used 48 kHz and passed against a
    // nearest-neighbour resampler, which is to say it tested nothing.
    const from = 44_100
    const input = tone(0.5, from, 440)
    const out = resample(input, from, TARGET_RATE)
    const expected = tone(0.5, TARGET_RATE, 440)

    let error = 0
    // Skip the last few samples, where the interpolator clamps to the final
    // input sample and has no successor to interpolate towards.
    for (let i = 0; i < out.length - 4; i++) error = Math.max(error, Math.abs(out[i]! - expected[i]!))
    expect(error).toBeLessThan(0.02)
  })

  it('handles an empty buffer', () => {
    expect(resample(new Float32Array(0), 48_000, TARGET_RATE).length).toBe(0)
  })
})

describe('rms', () => {
  it('is zero for silence and non-zero for a tone', () => {
    expect(rms(silence(0.1))).toBe(0)
    expect(rms(tone(0.1, TARGET_RATE))).toBeGreaterThan(0.3)
  })

  it('is the amplitude over root two for a sine wave', () => {
    expect(rms(tone(0.5, TARGET_RATE, 440, 0.8))).toBeCloseTo(0.8 / Math.SQRT2, 2)
  })

  it('is zero rather than NaN for an empty frame', () => {
    expect(rms(new Float32Array(0))).toBe(0)
  })
})

describe('Segmenter', () => {
  it('closes a segment after a pause once it is long enough', () => {
    const seg = new Segmenter()
    const closed = feed(seg, tone(4, TARGET_RATE))
    expect(closed).toHaveLength(0)

    const after = feed(seg, silence(1))
    expect(after).toHaveLength(1)
    // 4s of speech plus the pause that ended it. The pause travels with the
    // segment rather than being trimmed: Whisper uses trailing silence to
    // decide a sentence has ended.
    expect(after[0]!.length / TARGET_RATE).toBeGreaterThan(4)
  })

  it('does not close on a pause shorter than the threshold', () => {
    const seg = new Segmenter()
    feed(seg, tone(4, TARGET_RATE))
    expect(feed(seg, silence(0.4))).toHaveLength(0)
  })

  it('ignores a pause while the segment is still too short to be worth a pass', () => {
    // The failure this prevents: a clinician saying "température" then pausing
    // to read the thermometer hands Whisper one word with no context.
    const seg = new Segmenter()
    feed(seg, tone(1, TARGET_RATE))
    expect(feed(seg, silence(1.5))).toHaveLength(0)

    // It closes as soon as there is enough audio and another pause.
    feed(seg, tone(3, TARGET_RATE))
    expect(feed(seg, silence(1))).toHaveLength(1)
  })

  it('closes at the maximum length even with no pause at all', () => {
    // Whisper's window is 30 seconds. A segment that never closes would be
    // silently truncated inside the model, losing the end of the sentence.
    const seg = new Segmenter()
    const closed = feed(seg, tone(30, TARGET_RATE))
    expect(closed).toHaveLength(1)
    expect(closed[0]!.length / TARGET_RATE).toBeLessThanOrEqual(25.5)
  })

  it('hands over whatever is buffered on flush', () => {
    const seg = new Segmenter()
    feed(seg, tone(1.2, TARGET_RATE))
    const out = seg.flush()
    expect(out).not.toBeNull()
    // Below minSeconds, so a pause would not have closed it, but the user
    // pressing stop is not a pause and their words must not be dropped.
    expect(out!.length / TARGET_RATE).toBeCloseTo(1.2, 1)
  })

  it('returns nothing from a flush of pure silence', () => {
    // Whisper hallucinates on silent input; it is documented to emit whole
    // sentences from room tone. Never sending it silence is the fix.
    const seg = new Segmenter()
    feed(seg, silence(6))
    expect(seg.flush()).toBeNull()
  })

  it('returns nothing when the maximum length is reached with no speech in it', () => {
    const seg = new Segmenter()
    expect(feed(seg, silence(30))).toHaveLength(0)
  })

  it('starts clean after a segment closes', () => {
    const seg = new Segmenter()
    feed(seg, tone(4, TARGET_RATE))
    const first = feed(seg, silence(1))
    expect(first).toHaveLength(1)

    feed(seg, tone(4, TARGET_RATE))
    const second = feed(seg, silence(1))
    expect(second).toHaveLength(1)
    // Not cumulative: the second segment must not carry the first one's audio.
    // It is longer by exactly the pre-roll, which is deliberate.
    const preRoll = 0.25 * TARGET_RATE
    expect(second[0]!.length - first[0]!.length).toBeGreaterThan(0)
    expect(second[0]!.length - first[0]!.length).toBeLessThanOrEqual(preRoll + 1024)
  })

  it('does not carry a long silence into the next segment', () => {
    // The defect this exists for. The pause that closes one segment keeps
    // running into the next, so buffering silence before the first voiced
    // frame meant a clinician who stopped for a minute opened the following
    // segment with a minute of leading silence — and the maximum-length cut
    // then fired part-way through their first sentence, losing the end of it.
    const seg = new Segmenter()
    feed(seg, tone(4, TARGET_RATE))
    feed(seg, silence(1))

    feed(seg, silence(60))
    const closed = feed(seg, tone(4, TARGET_RATE))
    // Nothing closed during the silence, and nothing closed early inside the
    // speech that followed it.
    expect(closed).toHaveLength(0)

    const out = seg.flush()!
    const seconds = out.length / TARGET_RATE
    expect(seconds).toBeGreaterThan(4)
    expect(seconds).toBeLessThan(4.5)
  })

  it('reassembles frames in order', () => {
    // The segment is stitched from many small frames; getting the order or the
    // offsets wrong would scramble the audio into noise and still produce a
    // buffer of the right length.
    const seg = new Segmenter({ minSeconds: 0.05, silenceSeconds: 0.05, sampleRate: 100 })
    const ramp = new Float32Array(40)
    for (let i = 0; i < ramp.length; i++) ramp[i] = 0.5
    seg.push(ramp)
    const out = seg.flush()!
    expect([...out]).toEqual([...ramp])
  })

  it('takes a quiet room as silence and normal speech as voice', () => {
    const seg = new Segmenter()
    // Room tone at an amplitude below the threshold must not hold a segment open.
    feed(seg, tone(5, TARGET_RATE, 200, 0.004))
    expect(seg.flush()).toBeNull()
  })

  it('ignores empty frames', () => {
    const seg = new Segmenter()
    expect(seg.push(new Float32Array(0))).toBeNull()
    expect(seg.flush()).toBeNull()
  })
})

import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  installedPack,
  isHallucination,
  isPackAvailable,
  LocalWhisperRecogniser,
  packSupports,
  type FromWorker,
  type ToWorker,
} from './asr'
import { TARGET_RATE } from './audio'

/* ------------------------------------------------------------------ *
 * Availability
 * ------------------------------------------------------------------ */

/** A fetch that answers only for the paths it is given. */
function fakeFetch(routes: Record<string, unknown>): typeof fetch {
  return (async (url: string) => {
    const body = routes[String(url)]
    if (body === undefined) return { ok: false, json: async () => ({}) }
    if (body === 'html') {
      // What a single-page app actually serves for an unknown path: HTTP 200
      // and a page of HTML. This is the case the probe exists for.
      return {
        ok: true,
        json: async () => {
          throw new SyntaxError('Unexpected token <')
        },
      }
    }
    return { ok: true, json: async () => body }
  }) as unknown as typeof fetch
}

describe('isPackAvailable', () => {
  it('is true for a real whisper config', async () => {
    const fetchImpl = fakeFetch({
      '/models/whisper-base/config.json': { model_type: 'whisper' },
    })
    expect(await isPackAvailable('whisper-base', fetchImpl)).toBe(true)
  })

  it('is false when the SPA answers 200 with HTML', async () => {
    // The bug this is written against: a HEAD request, or a status check
    // alone, reports the model as installed when nothing was ever vendored,
    // and the app then tells the facility that audio stays on the device.
    const fetchImpl = fakeFetch({ '/models/whisper-base/config.json': 'html' })
    expect(await isPackAvailable('whisper-base', fetchImpl)).toBe(false)
  })

  it('is false for a config belonging to some other model', async () => {
    // public/models/ holds the de-identification model too. Pointing the ASR
    // pipeline at a BERT config would fail deep inside transformers.js.
    const fetchImpl = fakeFetch({
      '/models/whisper-base/config.json': { model_type: 'bert', id2label: {} },
    })
    expect(await isPackAvailable('whisper-base', fetchImpl)).toBe(false)
  })

  it('is false when the request fails outright', async () => {
    const fetchImpl = (async () => {
      throw new TypeError('network')
    }) as unknown as typeof fetch
    expect(await isPackAvailable('whisper-base', fetchImpl)).toBe(false)
  })
})

describe('installedPack', () => {
  it('prefers base over tiny when both are present', async () => {
    const fetchImpl = fakeFetch({
      '/models/whisper-base/config.json': { model_type: 'whisper' },
      '/models/whisper-tiny/config.json': { model_type: 'whisper' },
    })
    expect(await installedPack(fetchImpl)).toBe('whisper-base')
  })

  it('falls back to tiny when it is the only one', async () => {
    const fetchImpl = fakeFetch({
      '/models/whisper-tiny/config.json': { model_type: 'whisper' },
    })
    expect(await installedPack(fetchImpl)).toBe('whisper-tiny')
  })

  it('is null when nothing is vendored', async () => {
    expect(await installedPack(fakeFetch({}))).toBeNull()
  })
})

describe('packSupports', () => {
  it('covers the two clinical languages', () => {
    expect(packSupports('fr-FR')).toBe(true)
    expect(packSupports('en-US')).toBe(true)
  })

  it('excludes Malagasy', () => {
    // Whisper has almost no Malagasy and does not fail on it: it produces
    // fluent, confident French instead. A wrong transcription is worse than
    // none, because neither the extractor nor a hurried reader can tell.
    expect(packSupports('mg-MG')).toBe(false)
  })
})

describe('isHallucination', () => {
  it('catches the subtitle artefacts Whisper emits on silence', () => {
    expect(isHallucination("Sous-titres réalisés par la communauté d'Amara.org")).toBe(true)
    expect(isHallucination('Sous-titrage Société Radio-Canada')).toBe(true)
    expect(isHallucination('Merci.')).toBe(true)
    expect(isHallucination("Merci d'avoir regardé cette vidéo !")).toBe(true)
    expect(isHallucination('Thanks for watching!')).toBe(true)
    expect(isHallucination('[Musique]')).toBe(true)
    expect(isHallucination('you')).toBe(true)
  })

  it('treats empty and whitespace as nothing said', () => {
    expect(isHallucination('')).toBe(true)
    expect(isHallucination('   \n ')).toBe(true)
  })

  it('leaves real clinical speech alone', () => {
    // The risk of a blocklist is that it eats real text. These are the
    // sentences this app exists to capture.
    expect(isHallucination('température 38,9 degrés, pouls 96')).toBe(false)
    expect(isHallucination('paludisme simple, artéméther luméfantrine')).toBe(false)
    expect(isHallucination('Merci de revenir dans trois jours')).toBe(false)
    expect(isHallucination('the patient reports fever for three days')).toBe(false)
  })
})

/* ------------------------------------------------------------------ *
 * The recogniser
 * ------------------------------------------------------------------ */

/** A worker that records what it was sent and replies on command. */
class FakeWorker {
  sent: ToWorker[] = []
  transfers: unknown[][] = []
  onmessage: ((e: MessageEvent<FromWorker>) => void) | null = null
  onerror: (() => void) | null = null
  terminated = false

  postMessage(message: ToWorker, transfer?: unknown[]) {
    this.sent.push(message)
    this.transfers.push(transfer ?? [])
  }
  terminate() {
    this.terminated = true
  }
  reply(message: FromWorker) {
    this.onmessage?.(new MessageEvent('message', { data: message }))
  }
}

/** A microphone that hands over frames on demand. */
class FakeMic {
  stopped = 0
  private process: ((e: unknown) => void) | null = null
  readonly stream = {
    getTracks: () => [{ stop: () => this.stopped++ }],
  } as unknown as MediaStream

  /** Installs the globals `LocalWhisperRecogniser.start` reaches for. */
  install(sampleRate = TARGET_RATE) {
    const mic = this
    vi.stubGlobal(
      'AudioContext',
      class {
        destination = {}
        createMediaStreamSource() {
          return { connect: () => {} }
        }
        createScriptProcessor() {
          const node = {
            onaudioprocess: null as ((e: unknown) => void) | null,
            connect: () => {},
            disconnect: () => {},
          }
          // The recogniser assigns onaudioprocess after creating the node, so
          // read it lazily rather than capturing it now.
          Object.defineProperty(node, 'onaudioprocess', {
            get: () => mic.process,
            set: (fn) => {
              mic.process = fn
            },
          })
          return node
        }
        close() {
          return Promise.resolve()
        }
      },
    )
    this.sampleRate = sampleRate
  }

  private sampleRate = TARGET_RATE

  /** Deliver one frame of audio, as the browser would. */
  emit(frame: Float32Array) {
    this.process?.({
      inputBuffer: { getChannelData: () => frame, sampleRate: this.sampleRate },
    })
  }
}

function tone(seconds: number, rate = TARGET_RATE, amplitude = 0.5): Float32Array {
  const out = new Float32Array(Math.round(seconds * rate))
  for (let i = 0; i < out.length; i++) out[i] = amplitude * Math.sin((2 * Math.PI * 440 * i) / rate)
  return out
}

function silence(seconds: number, rate = TARGET_RATE): Float32Array {
  return new Float32Array(Math.round(seconds * rate))
}

/** Feed audio through the fake microphone in browser-sized frames. */
function speak(mic: FakeMic, audio: Float32Array, frame = 4096) {
  for (let at = 0; at < audio.length; at += frame) {
    mic.emit(audio.slice(at, Math.min(at + frame, audio.length)))
  }
}

describe('LocalWhisperRecogniser', () => {
  let worker: FakeWorker
  let mic: FakeMic

  beforeEach(() => {
    vi.unstubAllGlobals()
    worker = new FakeWorker()
    mic = new FakeMic()
    mic.install()
  })

  function build(overrides: { onResult?: (r: unknown) => void } = {}) {
    const results: string[] = []
    const errors: string[] = []
    const asr = new LocalWhisperRecogniser('whisper-base', {
      createWorker: () => worker as unknown as Worker,
      openMicrophone: async () => mic.stream,
    })
    const onResult = (r: { transcript: string }) => {
      results.push(r.transcript)
      overrides.onResult?.(r)
    }
    return { asr, results, errors, onResult, onError: (e: string) => errors.push(e) }
  }

  it('loads the pack it was constructed with', async () => {
    const { asr, onResult, onError } = build()
    await asr.start('fr-FR', onResult, onError)
    expect(worker.sent[0]).toEqual({ type: 'load', pack: 'whisper-base' })
    asr.dispose()
  })

  it('refuses a language the model would answer wrongly', async () => {
    const { asr, onResult, onError, errors } = build()
    await asr.start('mg-MG', onResult, onError)
    expect(errors).toEqual(['unsupported-language'])
    // Nothing opened: no worker, no microphone, no model load.
    expect(worker.sent).toHaveLength(0)
    asr.dispose()
  })

  it('sends a segment for transcription when the clinician pauses', async () => {
    const { asr, onResult, onError } = build()
    await asr.start('fr-FR', onResult, onError)

    speak(mic, tone(5))
    expect(worker.sent.filter((m) => m.type === 'transcribe')).toHaveLength(0)

    speak(mic, silence(1))
    const sent = worker.sent.filter((m) => m.type === 'transcribe')
    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({ id: 1, language: 'french' })
    asr.dispose()
  })

  it('transfers the audio rather than copying it', async () => {
    // A 25-second segment is 1.6 MB. Structured-cloning that on every pause is
    // visible jank on the phones this targets.
    const { asr, onResult, onError } = build()
    await asr.start('fr-FR', onResult, onError)
    speak(mic, tone(5))
    speak(mic, silence(1))

    const at = worker.sent.findIndex((m) => m.type === 'transcribe')
    expect(worker.transfers[at]).toHaveLength(1)
    asr.dispose()
  })

  it('surfaces transcribed text as a final result', async () => {
    const { asr, onResult, onError, results } = build()
    await asr.start('fr-FR', onResult, onError)

    worker.reply({ type: 'text', id: 1, text: '  température 38,9 degrés  ' })
    expect(results).toEqual(['température 38,9 degrés'])
    asr.dispose()
  })

  it('drops a hallucinated transcript instead of writing it to the record', async () => {
    const { asr, onResult, onError, results, errors } = build()
    await asr.start('fr-FR', onResult, onError)

    worker.reply({ type: 'text', id: 1, text: "Sous-titres réalisés par la communauté d'Amara.org" })
    expect(results).toEqual([])
    // Not an error either: the model simply had nothing to say.
    expect(errors).toEqual([])
    asr.dispose()
  })

  it('transcribes the tail when the user stops mid-sentence', async () => {
    // The words spoken between the last pause and the stop button are the end
    // of the consultation. Dropping them would be silent data loss.
    const { asr, onResult, onError } = build()
    await asr.start('fr-FR', onResult, onError)

    speak(mic, tone(1.5))
    expect(worker.sent.filter((m) => m.type === 'transcribe')).toHaveLength(0)

    asr.stop('fr-FR')
    expect(worker.sent.filter((m) => m.type === 'transcribe')).toHaveLength(1)
    asr.dispose()
  })

  it('sends nothing on a stop after silence', async () => {
    const { asr, onResult, onError } = build()
    await asr.start('fr-FR', onResult, onError)
    speak(mic, silence(3))
    asr.stop('fr-FR')
    expect(worker.sent.filter((m) => m.type === 'transcribe')).toHaveLength(0)
    asr.dispose()
  })

  it('releases the microphone on stop', async () => {
    const { asr, onResult, onError } = build()
    await asr.start('fr-FR', onResult, onError)
    expect(mic.stopped).toBe(0)
    asr.stop()
    // A live track keeps the recording indicator lit, which a clinician reads
    // as the app still listening to them.
    expect(mic.stopped).toBe(1)
    asr.dispose()
  })

  it('releases the microphone when stopped during the permission prompt', async () => {
    // The user presses the button, sees the browser prompt, changes their mind
    // and presses stop. `getUserMedia` then resolves into a recogniser that
    // already believes it is stopped, and the stream has no other owner.
    let release!: (s: MediaStream) => void
    const pending = new Promise<MediaStream>((resolve) => {
      release = resolve
    })
    const asr = new LocalWhisperRecogniser('whisper-base', {
      createWorker: () => worker as unknown as Worker,
      openMicrophone: () => pending,
    })

    const started = asr.start(
      'fr-FR',
      () => {},
      () => {},
    )
    asr.stop()
    release(mic.stream)
    await started

    expect(mic.stopped).toBe(1)
    asr.dispose()
  })

  it('reports a denied microphone as such', async () => {
    const asr = new LocalWhisperRecogniser('whisper-base', {
      createWorker: () => worker as unknown as Worker,
      openMicrophone: async () => {
        throw Object.assign(new Error('denied'), { name: 'NotAllowedError' })
      },
    })
    const errors: string[] = []
    await asr.start('fr-FR', () => {}, (e) => errors.push(e))
    expect(errors).toEqual(['not-allowed'])
    asr.dispose()
  })

  it('passes worker errors through', async () => {
    const { asr, onResult, onError, errors } = build()
    await asr.start('fr-FR', onResult, onError)
    worker.reply({ type: 'error', message: 'load: model not found' })
    expect(errors).toEqual(['load: model not found'])
    asr.dispose()
  })

  it('resamples a microphone that ignored the requested rate', async () => {
    // `new AudioContext({ sampleRate: 16000 })` is a request. Safari and some
    // Android builds hand back the hardware rate instead, and a segment at the
    // wrong rate is transcribed as gibberish at the wrong speed.
    mic.install(48_000)
    const { asr, onResult, onError } = build()
    await asr.start('fr-FR', onResult, onError)

    speak(mic, tone(5, 48_000), 4096)
    speak(mic, silence(1, 48_000), 4096)

    const sent = worker.sent.find((m) => m.type === 'transcribe')
    expect(sent).toBeDefined()
    const seconds = (sent as { audio: Float32Array }).audio.length / TARGET_RATE
    // Six seconds of 48 kHz audio must arrive as roughly six seconds at 16 kHz,
    // not as eighteen.
    expect(seconds).toBeGreaterThan(5)
    expect(seconds).toBeLessThan(7)
    asr.dispose()
  })

  it('stops feeding the segmenter once stopped', async () => {
    const { asr, onResult, onError } = build()
    await asr.start('fr-FR', onResult, onError)
    asr.stop('fr-FR')
    const before = worker.sent.length
    speak(mic, tone(5))
    speak(mic, silence(1))
    expect(worker.sent).toHaveLength(before)
    asr.dispose()
  })

  it('reuses one worker across dictations', async () => {
    // Creating a worker per start leaked the previous one, still holding a
    // parsed 80 MB graph, and paid the load cost again. It also orphaned the
    // tail segment `stop` had just sent to the old worker, so the last
    // sentence of the previous dictation vanished.
    let built = 0
    const asr = new LocalWhisperRecogniser('whisper-base', {
      createWorker: () => {
        built++
        return worker as unknown as Worker
      },
      openMicrophone: async () => mic.stream,
    })
    const results: string[] = []
    const onResult = (r: { transcript: string }) => results.push(r.transcript)

    await asr.start('fr-FR', onResult, () => {})
    speak(mic, tone(4))
    asr.stop('fr-FR')

    await asr.start('fr-FR', onResult, () => {})
    expect(built).toBe(1)

    // The tail from the first dictation still lands, because the worker that
    // was given it is the same one now listening.
    worker.reply({ type: 'text', id: 1, text: 'fièvre depuis trois jours' })
    expect(results).toEqual(['fièvre depuis trois jours'])
    asr.dispose()
  })

  it('terminates the worker on dispose', async () => {
    const { asr, onResult, onError } = build()
    await asr.start('fr-FR', onResult, onError)
    asr.dispose()
    expect(worker.terminated).toBe(true)
  })
})

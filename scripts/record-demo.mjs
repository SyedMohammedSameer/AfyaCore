#!/usr/bin/env node
/**
 * Record the ML4H demo video: the real application, driven and captured.
 *
 * ## Why this is not `video/`
 *
 * `video/render.mjs` builds a *promotional* film — still screenshots with
 * captions, cut to music. The ML4H Demo Track asks for something different and
 * incompatible: a video showing "the system accepting an input, performing or
 * invoking its ML-enabled functionality, and producing an output", and it lists
 * "a presentation consisting primarily of slides, figures" among the
 * submissions that are not sufficient. Stills cannot show a thing run.
 *
 * So this drives the production build in a real browser and captures the
 * screen continuously. Nothing is composited, nothing is sped up, and the
 * pauses where the app is thinking are left in, because those pauses are the
 * evidence.
 *
 *   npm run build
 *   npx vite preview --port 4173     # in another shell
 *   npm run record:demo
 *
 * ## Dictation, and the fake microphone
 *
 * The one input that cannot be synthesised is speech. Chrome can be handed a
 * WAV file in place of a microphone, which is what `--audio` does here: the
 * file is fed to `getUserMedia`, Whisper transcribes it on the device exactly
 * as it would a live clinician, and the fields populate for real. Record about
 * ten seconds of the line in docs/ml4h/VIDEO-SCRIPT.md and pass it in.
 *
 * Without `--audio` the dictation beat is skipped rather than faked. A
 * simulated transcript in a video submitted as evidence that the system works
 * would be a lie, and the beat is the one the submission rests on.
 *
 * ## Requirements
 *
 *   npm run vendor:whisper    # else dictation uses the browser's cloud API
 *   npm run vendor:ocr        # for the photo beat
 *
 * The script refuses to record a dictation beat when the model is absent,
 * because what it would capture is the cloud fallback — the opposite of the
 * claim being made.
 */
import { mkdtemp, rm, writeFile, mkdir, access } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer-core'
import { findChrome, LAUNCH_ARGS } from './find-chrome.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const BASE = process.env.AFYACORE_URL ?? 'http://localhost:4173'
const OUT = join(root, 'docs', 'ml4h', 'demo-recording.webm')

/** Capture size. Phone-shaped on purpose: this is a phone application. */
const VIEW = { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
/** Output framerate. The screencast is variable-rate; frames are resampled. */
const FPS = 15

const args = process.argv.slice(2)
const flag = (name) => {
  const i = args.indexOf(`--${name}`)
  return i === -1 ? undefined : args[i + 1]
}
const audioFile = flag('audio') ? resolve(flag('audio')) : undefined

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/* ------------------------------------------------------------------ *
 * Driving helpers. Deliberately slow: this is a recording, not a test.
 * ------------------------------------------------------------------ */

/** Click the first element whose trimmed text matches, then let it settle. */
async function tap(page, pattern, { settle = 900 } = {}) {
  const handle = await page.evaluateHandle((src) => {
    const re = new RegExp(src, 'i')
    return (
      [...document.querySelectorAll('button, a, [role="button"]')].find((el) =>
        re.test((el.textContent ?? '').trim()),
      ) ?? null
    )
  }, pattern.source ?? pattern)
  const el = handle.asElement()
  if (!el) throw new Error(`nothing matching ${pattern}`)
  await el.click()
  await sleep(settle)
}

/** Type into an input, at a human rate so the viewer can read it. */
async function type(page, selector, text, delay = 90) {
  const el = await page.$(selector)
  if (!el) throw new Error(`no input ${selector}`)
  await el.click()
  await el.type(text, { delay })
}

async function unlock(page, pin = '4729') {
  const locked = await page.evaluate(() =>
    [...document.querySelectorAll('button')].some(
      (b) => (b.textContent ?? '').trim().toLowerCase() === 'unlock',
    ),
  )
  if (!locked) return
  for (const digit of pin) {
    await page.evaluate((d) => {
      ;[...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === d)?.click()
    }, digit)
    await sleep(160)
  }
  await tap(page, /^unlock$/, { settle: 1800 })
}

/* ------------------------------------------------------------------ *
 * Capture
 * ------------------------------------------------------------------ */

/**
 * Start a CDP screencast, collecting frames with their arrival time.
 *
 * The screencast is event-driven: Chrome emits a frame when something changes,
 * so a still screen produces nothing at all. Holding the timestamps lets the
 * encoder below rebuild a constant-rate video by repeating the last frame
 * through the quiet stretches, which is what keeps a two-second pause looking
 * like a pause rather than a jump cut.
 */
async function startCapture(page, dir) {
  const client = await page.createCDPSession()
  const frames = []
  let n = 0

  client.on('Page.screencastFrame', async ({ data, sessionId, metadata }) => {
    const file = join(dir, `raw-${String(n++).padStart(5, '0')}.jpg`)
    frames.push({ file, at: metadata.timestamp })
    await writeFile(file, Buffer.from(data, 'base64'))
    try {
      await client.send('Page.screencastFrameAck', { sessionId })
    } catch {
      /* the cast was stopped between frames */
    }
  })

  /*
   * JPEG, not PNG, and that is forced rather than chosen.
   *
   * The only ffmpeg on this machine is Playwright's, built
   * `--disable-everything` with exactly one image path enabled: the
   * `image2pipe` demuxer and the `mjpeg` decoder. It can *write* PNG and it
   * cannot *read* one, and it has no `image2` demuxer at all, so a numbered
   * sequence on disk is not something it can open. Frames therefore have to be
   * JPEG and have to arrive on stdin.
   */
  await client.send('Page.startScreencast', {
    format: 'jpeg',
    quality: 92,
    everyNthFrame: 1,
    maxWidth: VIEW.width * VIEW.deviceScaleFactor,
    maxHeight: VIEW.height * VIEW.deviceScaleFactor,
  })

  return {
    frames,
    stop: async () => {
      await client.send('Page.stopScreencast')
      await sleep(400)
      return frames
    },
  }
}

/** Playwright ships the only ffmpeg here with an encoder; find it. */
async function findFfmpeg() {
  const candidates = [
    process.env.FFMPEG_PATH,
    '/opt/pw-browsers/ffmpeg-1011/ffmpeg-linux',
    '/usr/bin/ffmpeg',
    '/usr/local/bin/ffmpeg',
  ].filter(Boolean)
  for (const c of candidates) {
    try {
      await access(c)
      return c
    } catch {
      /* next */
    }
  }
  throw new Error('no ffmpeg found; set FFMPEG_PATH')
}

const run = (cmd, argv) =>
  new Promise((res, rej) => {
    const p = spawn(cmd, argv, { stdio: ['ignore', 'ignore', 'pipe'] })
    let err = ''
    p.stderr.on('data', (d) => (err += d))
    p.on('close', (code) => (code === 0 ? res() : rej(new Error(err.slice(-1500)))))
  })

/**
 * Resample variable-rate frames onto a constant grid, then encode.
 *
 * The screencast only emits a frame when the page changes, so a still screen
 * produces nothing and a two-second pause would otherwise become a jump cut.
 * Each output slot takes the most recent frame at or before its timestamp,
 * which turns the gaps back into pauses.
 *
 * ffmpeg's `fps` filter would do the same job, but this build has almost no
 * filters, so the resampling happens here and the frames are streamed in over
 * stdin as MJPEG — the one input format it was compiled to accept.
 */
async function encode(frames, out) {
  if (frames.length === 0) throw new Error('no frames captured')
  const ffmpeg = await findFfmpeg()
  const { readFile } = await import('node:fs/promises')

  const start = frames[0].at
  const end = frames[frames.length - 1].at
  const total = Math.max(1, Math.round((end - start) * FPS))

  const order = []
  let cursor = 0
  for (let i = 0; i < total; i++) {
    const t = start + i / FPS
    while (cursor + 1 < frames.length && frames[cursor + 1].at <= t) cursor++
    order.push(frames[cursor].file)
  }

  const proc = spawn(
    ffmpeg,
    [
      '-y',
      '-f', 'image2pipe',
      '-c:v', 'mjpeg',
      '-r', String(FPS),
      '-i', 'pipe:0',
      '-c:v', 'libvpx',
      '-b:v', '3M',
      '-crf', '10',
      '-deadline', 'good',
      '-cpu-used', '2',
      '-an',
      out,
    ],
    { stdio: ['pipe', 'ignore', 'pipe'] },
  )

  let err = ''
  proc.stderr.on('data', (d) => (err += d))
  const done = new Promise((res, rej) => {
    proc.on('close', (code) => (code === 0 ? res() : rej(new Error(err.slice(-1500)))))
    proc.on('error', rej)
  })

  // Cached: a still stretch repeats the same file many times over, and at
  // fifteen frames a second a five-second pause is seventy-five reads of one
  // JPEG.
  const cache = new Map()
  for (const file of order) {
    if (!cache.has(file)) cache.set(file, await readFile(file))
    if (!proc.stdin.write(cache.get(file))) {
      await new Promise((r) => proc.stdin.once('drain', r))
    }
  }
  proc.stdin.end()
  await done

  return { total, seconds: total / FPS }
}

/* ------------------------------------------------------------------ *
 * The take
 * ------------------------------------------------------------------ */

async function main() {
  const hasWhisper = await access(join(root, 'public/models/whisper-base/config.json'))
    .then(() => true)
    .catch(() => false)

  if (audioFile && !hasWhisper) {
    throw new Error(
      'audio supplied but public/models/whisper-base is missing.\n' +
        'Run `npm run vendor:whisper` first — without it the dictation beat\n' +
        'would record the browser\'s cloud fallback, which is the opposite of\n' +
        'the claim the video is making.',
    )
  }

  const executablePath = await findChrome()
  const launchArgs = [...LAUNCH_ARGS, '--autoplay-policy=no-user-gesture-required']
  if (audioFile) {
    // Hand Chrome a WAV in place of a microphone. getUserMedia returns it, and
    // Whisper transcribes it on the device exactly as it would a live voice.
    launchArgs.push(
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      `--use-file-for-fake-audio-capture=${audioFile}%noloop`,
    )
  }

  const browser = await puppeteer.launch({ executablePath, args: launchArgs })
  const page = await browser.newPage()
  await page.setViewport(VIEW)

  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))

  const dir = await mkdtemp(join(tmpdir(), 'afyacore-rec-'))
  let capture

  try {
    // Set up off-camera: account, demo data. The recording starts at the lock
    // screen, which is where a clinician's day starts.
    await page.goto(BASE, { waitUntil: 'networkidle2' })
    await sleep(1200)

    const inputs = await page.$$('input')
    for (const [i, v] of ['Dr Ranaivo', '4729', '4729'].entries()) {
      await inputs[i].click({ clickCount: 3 })
      await inputs[i].type(v)
    }
    await tap(page, /create account/, { settle: 2500 })
    await page.waitForSelector('main', { timeout: 30_000 })

    await tap(page, /load demo workspace/, { settle: 3000 }).catch(async () => {
      await page.goto(`${BASE}/settings`, { waitUntil: 'networkidle2' })
      await sleep(1200)
      await unlock(page)
      await tap(page, /load demo/, { settle: 3000 })
    })

    // Back to the lock screen for the opening shot.
    await page.goto(BASE, { waitUntil: 'networkidle2' })
    await sleep(1500)

    console.log('recording…')
    capture = await startCapture(page, dir)
    await sleep(1500)

    // 1. Unlock.
    await unlock(page)
    await sleep(1500)

    // 2. Roster and search.
    await page.evaluate(() => {
      ;[...document.querySelectorAll('a')]
        .find((a) => /^patients$/i.test((a.textContent ?? '').trim()))
        ?.click()
    })
    await sleep(1600)
    const search = await page.$('input')
    if (search) {
      await search.click()
      await search.type('rasoa', { delay: 220 })
    }
    await sleep(1800)

    // 3. A patient, and the WHO growth chart: an output that changes a
    //    decision, computed on the device from recorded weights.
    await page.evaluate(() => {
      ;[...document.querySelectorAll('a[href^="/patient/"]')]
        .find((a) => /RASOANAIVO/i.test(a.textContent ?? ''))
        ?.click()
    })
    await sleep(2600)
    await page.evaluate(() => window.scrollBy({ top: 380, behavior: 'smooth' }))
    await sleep(2800)

    // 4. Dictation — the beat the submission rests on. Skipped, never faked,
    //    when there is no audio to feed the fake microphone.
    if (audioFile) {
      await tap(page, /new consultation/, { settle: 2200 })
      await tap(page, /dicter|dictate|speak/, { settle: 1200 }).catch(() => {})
      // Long enough for the clip to play and for Whisper to finish.
      await sleep(22_000)
      await page.evaluate(() => window.scrollBy({ top: 300, behavior: 'smooth' }))
      await sleep(4000)
    } else {
      console.log('  (no --audio: dictation beat skipped rather than simulated)')
    }

    /*
     * 5. A different patient for the record and the instruction sheet.
     *
     * The paediatric patient carries the growth chart but her last visit has
     * no prescription, so her instruction sheet reads "no medicines given" —
     * true, and the least interesting version of that screen. The malaria
     * consultation has two drugs on it, which is what makes the dosing icons
     * and the translated sheet worth showing.
     */
    await page.evaluate(() => {
      ;[...document.querySelectorAll('a')]
        .find((a) => /^patients$/i.test((a.textContent ?? '').trim()))
        ?.click()
    })
    await sleep(1600)
    await page.evaluate(() => {
      ;[...document.querySelectorAll('a[href^="/patient/"]')]
        .find((a) => /RAKOTOARISOA/i.test(a.textContent ?? ''))
        ?.click()
    })
    await sleep(2200)

    // The consultation record itself: every field carries where it came from,
    // and a value the extractor was unsure of has to be confirmed.
    await page.evaluate(() => {
      ;[...document.querySelectorAll('a[href*="/encounter/"]')][0]?.click()
    })
    await sleep(2400)
    await page.evaluate(() => window.scrollBy({ top: 420, behavior: 'smooth' }))
    await sleep(2600)

    // 6. What the patient leaves with. The dosing icons carry the instruction
    //    for someone who cannot read the sheet.
    await tap(page, /consignes patient|patient instructions|toromarika/, { settle: 2800 }).catch(
      () => {},
    )
    await page.evaluate(() => window.scrollBy({ top: 340, behavior: 'smooth' }))
    await sleep(2600)

    // 7. The monthly return the ministry expects, generated from confirmed
    //    consultations and de-identified on the way out.
    await page.goto(`${BASE}/settings`, { waitUntil: 'networkidle2' })
    await sleep(1400)
    await unlock(page)
    await page.evaluate(() => {
      const el = [...document.querySelectorAll('*')].find((n) =>
        /^REPORTING$/i.test((n.textContent ?? '').trim()),
      )
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    })
    await sleep(2600)

    // 8. Offline. The service worker claim, demonstrated rather than asserted.
    await page.setOfflineMode(true)
    await sleep(900)
    await page.reload({ waitUntil: 'domcontentloaded' })
    await sleep(2200)
    await unlock(page)
    await sleep(2400)
    await page.setOfflineMode(false)

    await sleep(1200)
  } finally {
    let frames = []
    if (capture) frames = await capture.stop()
    await browser.close()

    if (frames.length) {
      console.log(`  ${frames.length} frames captured, encoding…`)
      await mkdir(dirname(OUT), { recursive: true })
      const { seconds } = await encode(frames, OUT)
      console.log(`  -> ${OUT}  ${seconds.toFixed(1)}s @ ${FPS}fps`)
    }
    await rm(dir, { recursive: true, force: true })
    if (errors.length) console.error(`  page errors: ${errors.join(' | ')}`)
  }
}

main().catch((err) => {
  console.error(`record-demo failed: ${err.message}`)
  process.exit(1)
})

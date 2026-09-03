#!/usr/bin/env node
/**
 * Build the looping preview that plays inline in the README.
 *
 * ## Why not just embed the video
 *
 * GitHub renders a relative `.mp4` as a link, not a player — a reader has to
 * click, wait for 6 MB and lose their place in the page. An animated WebP in
 * an `<img>` plays where it sits, so the README shows the app moving before
 * anyone decides whether to watch the whole thing.
 *
 * ## Why it is a montage rather than the whole video
 *
 * The full cut is 99 seconds. As an animation that is roughly a thousand
 * frames, and no amount of tuning makes that a reasonable thing to put at the
 * top of a README: it would dwarf the source video it is advertising, on a
 * page people open to read.
 *
 * So this takes a couple of seconds out of each beat and loops them. Each
 * sample starts after the beat's entrance animation has settled, which is what
 * keeps the cuts from looking like glitches, and the result is about a
 * seventh of the length at a fraction of the size. It is a trailer, and the
 * link to the full render sits underneath it.
 *
 *   npm run demo:preview
 *
 * Regenerate it whenever `docs/demo.mp4` changes. The sample points are read
 * out of `video/src/Demo.tsx` at run time, so adding or reordering a beat
 * needs no change here.
 */
import { spawn } from 'node:child_process'
import { stat, access, mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const SOURCE = join(root, 'docs', 'demo.mp4')
const OUT = join(root, 'docs', 'demo-preview.webp')

const CLIP_SECONDS = 1.8

/**
 * How far into a beat to start sampling, in seconds.
 *
 * Not at the boundary. A beat opens with a spring and a fade, so a sample
 * taken at its edge catches the shot mid-arrival and reads as a stutter once
 * the montage loops.
 */
const SETTLE = 2.5

/**
 * Read the beat lengths out of the composition rather than restating them.
 *
 * This was a hand-maintained list of timestamps with a comment saying "if the
 * beats change, these have to". Adding one beat in the middle silently shifted
 * every sample after it into the wrong shot, and nothing would have complained
 * — the preview would just have shown the same beat twice and skipped another.
 * That is the same failure the screenshots had: an artefact that stays
 * plausible after the thing it describes has moved.
 *
 * `Demo.tsx` already holds the durations in the only place they can be right,
 * so this parses them from there. It throws rather than guessing if the shape
 * it expects is gone.
 */
async function sampleTimes() {
  const source = await readFile(join(root, 'video', 'src', 'Demo.tsx'), 'utf8')
  const durations = [...source.matchAll(/d:\s*s\((\d+(?:\.\d+)?)\)/g)].map((m) => Number(m[1]))
  if (durations.length === 0) {
    throw new Error('no beat durations found in video/src/Demo.tsx; has `d: s(n)` changed shape?')
  }

  const samples = []
  let at = 0
  for (const duration of durations) {
    // Clamp so a beat shorter than the settle time plus the clip still yields
    // frames from inside itself rather than spilling into the next one.
    const latest = Math.max(0, duration - CLIP_SECONDS - 0.2)
    samples.push(Number((at + Math.min(SETTLE, latest)).toFixed(2)))
    at += duration
  }
  return samples
}
const FPS = 10
const WIDTH = 800

/**
 * The ffmpeg the video package already downloaded.
 *
 * Not a system ffmpeg: this repo does not ask anyone to install one, and the
 * Remotion compositor ships a static build that is already on disk after
 * `npm --prefix video install`.
 */
async function findFfmpeg() {
  const candidates = [
    process.env.FFMPEG_PATH,
    join(root, 'video', 'node_modules', '@remotion', 'compositor-linux-x64-gnu', 'ffmpeg'),
    join(root, 'video', 'node_modules', '@remotion', 'compositor-linux-x64-musl', 'ffmpeg'),
    join(root, 'video', 'node_modules', '@remotion', 'compositor-darwin-arm64', 'ffmpeg'),
    join(root, 'video', 'node_modules', '@remotion', 'compositor-darwin-x64', 'ffmpeg'),
    join(root, 'video', 'node_modules', '@remotion', 'compositor-win32-x64-msvc', 'ffmpeg.exe'),
    '/opt/homebrew/bin/ffmpeg',
    '/usr/local/bin/ffmpeg',
    '/usr/bin/ffmpeg',
  ].filter(Boolean)

  for (const path of candidates) {
    try {
      await access(path)
      return path
    } catch {
      // next
    }
  }
  throw new Error(
    'No ffmpeg found. Run `npm --prefix video install`, or set FFMPEG_PATH.\n\nTried:\n  ' +
      candidates.join('\n  '),
  )
}

/**
 * Decode one clip to numbered PNG frames in `dir`.
 *
 * PNG files rather than raw frames piped to stdout: the ffmpeg the Remotion
 * compositor ships is a trimmed build with no `rawvideo` muxer, and a preview
 * script is not a good reason to make anyone install a second ffmpeg.
 */
function decode(ffmpeg, from, height, dir, index) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpeg, [
      '-loglevel', 'error',
      // Before `-i`, so ffmpeg seeks rather than decoding from the start.
      '-ss', String(from),
      '-t', String(CLIP_SECONDS),
      '-i', SOURCE,
      // `-r` rather than the `fps` filter, and `-s` rather than `scale`: the
      // compositor's ffmpeg is a trimmed build that registers neither filter,
      // and both options do the same job through the encoder instead.
      '-r', String(FPS),
      '-s', `${WIDTH}x${height}`,
      // Zero-padded and prefixed by clip, so a plain sort puts every frame of
      // the montage in the order it was sampled.
      join(dir, `${String(index).padStart(2, '0')}-%03d.png`),
    ])
    let stderr = ''
    child.stderr.on('data', (c) => (stderr += c))
    child.on('error', reject)
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(`ffmpeg exited ${code}: ${stderr}`))
      resolve()
    })
  })
}

async function main() {
  const ffmpeg = await findFfmpeg()
  try {
    await access(SOURCE)
  } catch {
    throw new Error(`${SOURCE} not found. Render it first: npm --prefix video run render:web`)
  }

  // The source is 16:9; deriving the height keeps this correct if that ever
  // changes rather than hard-coding 450 and silently squashing the frame.
  const height = Math.round((WIDTH * 1080) / 1920)
  const SAMPLES = await sampleTimes()

  console.log(`building the README preview from docs/demo.mp4`)
  console.log(`  ${SAMPLES.length} samples x ${CLIP_SECONDS}s at ${FPS} fps, ${WIDTH}x${height}\n`)

  const dir = await mkdtemp(join(tmpdir(), 'afyacore-preview-'))
  let pages = 0
  try {
    for (const [i, at] of SAMPLES.entries()) {
      const before = (await readdir(dir)).length
      await decode(ffmpeg, at, height, dir, i)
      const count = (await readdir(dir)).length - before
      if (count === 0) {
        throw new Error(`no frames at ${at}s. Is docs/demo.mp4 shorter than the beat list?`)
      }
      console.log(`  ${String(i + 1).padStart(2)}  t=${String(at).padStart(5)}s  ${count} frames`)
    }

    const files = (await readdir(dir)).sort().map((f) => join(dir, f))
    pages = files.length

    await sharp(files, { join: { animated: true } })
      .webp({ quality: 55, effort: 6, loop: 0, delay: Math.round(1000 / FPS) })
      .toFile(OUT)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }

  const { size } = await stat(OUT)
  console.log(
    `\n  -> docs/demo-preview.webp  ${pages} frames, ${(pages / FPS).toFixed(1)}s, ` +
      `${(size / 1024 / 1024).toFixed(1)} MB`,
  )
}

main().catch((err) => {
  console.error(`\ndemo-preview failed: ${err.message}`)
  process.exit(1)
})

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
 * Regenerate it whenever `docs/demo.mp4` changes; the timings below are read
 * from the beat boundaries in `video/src/Demo.tsx`, so they have to move
 * together.
 */
import { spawn } from 'node:child_process'
import { stat, access, mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const SOURCE = join(root, 'docs', 'demo.mp4')
const OUT = join(root, 'docs', 'demo-preview.webp')

/**
 * Where to sample, in seconds into the finished render.
 *
 * These sit a couple of seconds inside each beat rather than at its edge. A
 * beat opens with a spring and a fade, so a sample taken at the boundary
 * catches the shot mid-arrival and reads as a stutter once it loops.
 *
 * Beat boundaries, from `video/src/Demo.tsx`: 0, 6, 15, 24, 34, 45, 55, 68,
 * 78, 92. If those change, these have to.
 */
const SAMPLES = [
  2.5, // title
  9, // open it and start
  18, // find anyone in seconds
  27, // speak the consultation
  37, // you stay in charge
  48, // the patient takes it home
  60, // offline
  71, // reports the ministry expects
  82, // the numbers
  94, // open source
]

const CLIP_SECONDS = 1.8
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

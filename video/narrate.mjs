#!/usr/bin/env node
/**
 * A scratch voice-over, so a narrated cut exists before anyone records one.
 *
 *   node video/narrate.mjs                     # synthesise from docs/ml4h/voiceover.md
 *   node video/narrate.mjs --voice my.m4a      # use a recording instead
 *
 * Reads the table in docs/ml4h/voiceover.md, speaks each line with the macOS
 * voice at the beat's start time, and writes public/narration.m4a for the
 * composition to lay under the picture. The result is a synthetic voice and
 * sounds like one; it is here so the timing can be checked and so a deadline
 * cannot be missed for want of a microphone. Record the real one.
 */
import { execFile } from 'node:child_process'
import { copyFile, mkdir, readFile, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

const run = promisify(execFile)
const here = dirname(fileURLToPath(import.meta.url))
const out = join(here, 'public', 'narration.m4a')
const VOICE = process.env.NARRATION_VOICE ?? 'Daniel'
const RATE = Number(process.env.NARRATION_RATE ?? 172)
const SAMPLE_RATE = 48_000

const provided = process.argv.indexOf('--voice')
if (provided !== -1) {
  const src = process.argv[provided + 1]
  if (!src) throw new Error('--voice needs a file')
  await mkdir(dirname(out), { recursive: true })
  if (src.endsWith('.m4a')) await copyFile(src, out)
  else await run('afconvert', ['-f', 'm4af', '-d', 'aac', '-b', '128000', src, out])
  console.log(`narration <- ${src}`)
  process.exit(0)
}

const script = await readFile(join(here, '..', 'docs', 'ml4h', 'voiceover.md'), 'utf8')
const lines = [...script.matchAll(/^\| (\d+):(\d\d) \| [^|]+ \| ([^|]+) \|$/gm)].map((m) => ({
  at: Number(m[1]) * 60 + Number(m[2]),
  text: m[3].trim(),
}))
if (lines.length === 0) throw new Error('no timed lines found in voiceover.md')

const work = join(here, '.narrate')
await rm(work, { recursive: true, force: true })
await mkdir(work, { recursive: true })

/** Speak one line to 48 kHz mono PCM, and read back how long it ran. */
async function speak(text, i) {
  const aiff = join(work, `${i}.aiff`)
  const wav = join(work, `${i}.wav`)
  await run('say', ['-v', VOICE, '-r', String(RATE), '-o', aiff, text])
  await run('afconvert', ['-f', 'WAVE', '-d', `LEI16@${SAMPLE_RATE}`, '-c', '1', aiff, wav])
  const buf = await readFile(wav)
  return { buf, seconds: pcmSamples(buf) / SAMPLE_RATE }
}

function pcmSamples(buf) {
  let offset = 12
  while (offset + 8 <= buf.length) {
    const id = buf.toString('ascii', offset, offset + 4)
    const size = buf.readUInt32LE(offset + 4)
    if (id === 'data') return Math.floor(size / 2)
    offset += 8 + size
  }
  throw new Error('no data chunk')
}

function pcmData(buf) {
  let offset = 12
  while (offset + 8 <= buf.length) {
    const id = buf.toString('ascii', offset, offset + 4)
    const size = buf.readUInt32LE(offset + 4)
    if (id === 'data') return buf.subarray(offset + 8, offset + 8 + size)
    offset += 8 + size
  }
  throw new Error('no data chunk')
}

// Lay each line at its beat time on a silent timeline. Two seconds of lead-in
// so the first words do not land on the very first frame.
const LEAD = 1.0
/** Breath between two lines when the first has run past the next beat. */
const GAP = 0.35
const clips = []
let total = 0
let previousEnd = 0
for (const [i, line] of lines.entries()) {
  const { buf, seconds } = await speak(line.text, i)
  // A line never starts before its beat, and never over the end of the line
  // before it: two voices at once is worse than a late start. The drift this
  // introduces is printed so the script can be cut where it accumulates.
  const start = Math.max(line.at + LEAD, previousEnd + GAP)
  clips.push({ start, data: pcmData(buf) })
  previousEnd = start + seconds
  const drift = start - (line.at + LEAD)
  const flag = drift > 2 ? `  <- starts ${drift.toFixed(1)}s late; cut the lines before this one` : drift > 0 ? `  (+${drift.toFixed(1)}s)` : ''
  console.log(`  ${String(line.at).padStart(4)}s  ${seconds.toFixed(1).padStart(5)}s  ${line.text.slice(0, 60)}${flag}`)
  total = Math.max(total, previousEnd)
}

const samples = Math.ceil((total + 1) * SAMPLE_RATE)
const pcm = Buffer.alloc(samples * 2)
for (const clip of clips) clip.data.copy(pcm, Math.floor(clip.start * SAMPLE_RATE) * 2)

const header = Buffer.alloc(44)
header.write('RIFF', 0)
header.writeUInt32LE(36 + pcm.length, 4)
header.write('WAVE', 8)
header.write('fmt ', 12)
header.writeUInt32LE(16, 16)
header.writeUInt16LE(1, 20)
header.writeUInt16LE(1, 22)
header.writeUInt32LE(SAMPLE_RATE, 24)
header.writeUInt32LE(SAMPLE_RATE * 2, 28)
header.writeUInt16LE(2, 32)
header.writeUInt16LE(16, 34)
header.write('data', 36)
header.writeUInt32LE(pcm.length, 40)
const wavPath = join(work, 'narration.wav')
await import('node:fs/promises').then((fs) => fs.writeFile(wavPath, Buffer.concat([header, pcm])))
await mkdir(dirname(out), { recursive: true })
await run('afconvert', ['-f', 'm4af', '-d', 'aac', '-b', '128000', wavPath, out])
await rm(work, { recursive: true, force: true })
console.log(`\n  -> ${out}  (${total.toFixed(1)}s, ${VOICE}). A scratch track: record the real one.`)

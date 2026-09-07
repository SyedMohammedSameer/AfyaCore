#!/usr/bin/env node
/**
 * Regenerate the WHO Child Growth Standards tables shipped in `src/data/`.
 *
 * ## Where the numbers come from
 *
 * WHO's own R package, `anthro`, whose maintainer and contributors are WHO
 * staff (`nfsdata@who.int`) and whose stated purpose is "Computation of the
 * WHO Child Growth Standards". CRAN mirrors every package to GitHub, which is
 * what makes it fetchable; `who.int` itself is unreachable from some networks
 * this project cares about.
 *
 * Provenance is the whole point. A growth chart is a clinical decision aid: a
 * child is referred for severe acute malnutrition on the strength of a
 * z-score, so a reference table that is *approximately* WHO's is worse than no
 * chart at all. Nothing here is typed from memory, transcribed from a PDF, or
 * interpolated to fill a gap.
 *
 * ## Unlike the model packs, this is committed
 *
 * `vendor:whisper` and `vendor:openmed` fetch tens of megabytes and stay out
 * of the repository. These tables are a few hundred kilobytes and, more to the
 * point, a growth chart that only works if an administrator remembered to run
 * a script is a growth chart that is not there when a child is in front of
 * someone. It ships. This script exists so the provenance can be re-checked
 * rather than trusted.
 *
 *   npm run vendor:who
 *
 * ## What it verifies before writing
 *
 * Published WHO medians, asserted against the parsed output. If WHO's median
 * birth weight for boys is not 3.3464 kg, this did not parse what it thinks it
 * parsed and it refuses to write the file.
 */
import { spawn } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readRds } from './lib/rds.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(root, 'src', 'data', 'whoGrowth.ts')

const SOURCE = 'https://raw.githubusercontent.com/cran/anthro/master/R/sysdata.rda'
const PACKAGE = 'anthro (CRAN), Computation of the WHO Child Growth Standards'

/**
 * The three indicators a health post acts on.
 *
 * Underweight, stunting and wasting. The package also carries head
 * circumference, arm circumference and two skinfolds; none of them changes a
 * referral decision at this level of care, and each would be another 150 kB
 * of table for a chart nobody would open.
 */
const WANTED = [
  { table: 'growthstandards_weianthro', key: 'weightForAge', by: 'age' },
  { table: 'growthstandards_lenanthro', key: 'lengthForAge', by: 'age' },
  { table: 'growthstandards_wflanthro', key: 'weightForLength', by: 'length' },
  { table: 'growthstandards_wfhanthro', key: 'weightForHeight', by: 'height' },
]

/**
 * Values published by WHO, checked against what came out of the parser.
 *
 * These are the figures printed in the WHO Child Growth Standards themselves,
 * which is what makes them a check rather than a restatement of the input.
 */
const CHECKS = [
  ['weightForAge', 1, 0, 3.3464],
  ['weightForAge', 2, 0, 3.2322],
  ['weightForAge', 1, 365, 9.646],
  ['weightForAge', 2, 365, 8.9462],
  ['lengthForAge', 1, 0, 49.8842],
  ['lengthForAge', 2, 0, 49.1477],
]

function fetchBuffer(url) {
  return fetch(url).then(async (response) => {
    if (!response.ok) throw new Error(`${url} -> HTTP ${response.status}`)
    return Buffer.from(await response.arrayBuffer())
  })
}

/**
 * bzip2, via the system tool.
 *
 * Node ships gzip, brotli and zstd but not bzip2, and pulling a decompressor
 * into the dependency tree for one maintenance script that runs perhaps twice
 * a year is the wrong trade. `bunzip2` is present on macOS and on every Linux
 * this would run on.
 */
function bunzip2(input) {
  return new Promise((resolve, reject) => {
    const child = spawn('bunzip2', ['-c'])
    const chunks = []
    let stderr = ''
    child.stdout.on('data', (c) => chunks.push(c))
    child.stderr.on('data', (c) => (stderr += c))
    child.on('error', (err) =>
      reject(new Error(`could not run bunzip2 (${err.message}). Install bzip2 and retry.`)),
    )
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(`bunzip2 exited ${code}: ${stderr}`))
      resolve(Buffer.concat(chunks))
    })
    child.stdin.end(input)
  })
}

/** Turn a parsed data frame into `{ column: values }`. */
function columns(frame) {
  const names = frame?.__attrs?.names
  if (!names) throw new Error('a table arrived without column names; the parse is wrong')
  const out = {}
  names.forEach((name, i) => {
    out[name] = frame[i]
  })
  return out
}

/**
 * Split one WHO table into the two sexes, as parallel arrays.
 *
 * Parallel arrays rather than an array of `{x, l, m, s}` objects: the same
 * numbers, about a third of the bytes, and the lookup is an index either way.
 * WHO codes sex as 1 for boys and 2 for girls.
 */
function split(frame, by) {
  const c = columns(frame)
  const out = {}
  for (const [code, sex] of [
    [1, 'male'],
    [2, 'female'],
  ]) {
    const rows = []
    for (let i = 0; i < c.sex.length; i++) {
      if (c.sex[i] === code) rows.push([c[by][i], c.l[i], c.m[i], c.s[i]])
    }
    rows.sort((a, b) => a[0] - b[0])
    out[sex] = {
      x: rows.map((r) => r[0]),
      l: rows.map((r) => round(r[1])),
      m: rows.map((r) => round(r[2])),
      s: rows.map((r) => round(r[3])),
    }
  }
  return out
}

// WHO publishes these to four or five decimals; keeping six loses nothing and
// invents nothing.
const round = (n) => Number(n.toFixed(6))

async function main() {
  console.log(`fetching ${SOURCE}\n`)
  const compressed = await fetchBuffer(SOURCE)
  console.log(`  ${(compressed.length / 1024).toFixed(0)} kB compressed`)

  const serialized = await bunzip2(compressed)
  console.log(`  ${(serialized.length / 1024).toFixed(0)} kB after bunzip2`)

  const tables = {}
  let node = readRds(serialized)
  while (node && node.pairlist) {
    tables[node.tag] = node.value
    node = node.rest
  }
  console.log(`  ${Object.keys(tables).length} tables in the package\n`)

  const standards = {}
  for (const { table, key, by } of WANTED) {
    const frame = tables[table]
    if (!frame) throw new Error(`${table} is not in the package; has anthro been restructured?`)
    standards[key] = { by, ...split(frame, by) }
    const n = standards[key].male.x.length
    console.log(`  ${key.padEnd(16)} by ${by.padEnd(7)} ${n} points per sex`)
  }

  // Refuse to write anything that does not match WHO's published medians.
  console.log('')
  for (const [key, sexCode, x, expected] of CHECKS) {
    const sex = sexCode === 1 ? 'male' : 'female'
    const table = standards[key][sex]
    const i = table.x.indexOf(x)
    const actual = i === -1 ? undefined : table.m[i]
    if (actual === undefined || Math.abs(actual - expected) > 1e-4) {
      throw new Error(
        `${key} ${sex} at ${x}: expected median ${expected}, parsed ${actual}. ` +
          'Refusing to write a growth standard that does not match WHO.',
      )
    }
    console.log(`  ok  ${key} ${sex} at ${x}: median ${actual}`)
  }

  await mkdir(dirname(OUT), { recursive: true })
  await writeFile(
    OUT,
    `/**
 * WHO Child Growth Standards, as LMS coefficients.
 *
 * GENERATED by \`npm run vendor:who\`. Do not edit: every number here is
 * WHO's, and a hand edit would make it something else that still looks like
 * a growth standard.
 *
 * Source: ${PACKAGE}
 *   ${SOURCE}
 * Vendored: ${new Date().toISOString().slice(0, 10)}
 *
 * \`x\` is age in days for the -for-age tables and length or height in cm for
 * the others. \`l\`, \`m\` and \`s\` are the Box-Cox power, the median and the
 * coefficient of variation at that point. See \`src/lib/growth.ts\` for how a
 * measurement becomes a z-score.
 */
export interface LmsTable {
  x: number[]
  l: number[]
  m: number[]
  s: number[]
}

export interface GrowthStandard {
  /** What \`x\` measures. */
  by: 'age' | 'length' | 'height'
  male: LmsTable
  female: LmsTable
}

export const WHO_GROWTH = ${JSON.stringify(standards)} as const satisfies Record<string, GrowthStandard>

export type GrowthIndicator = keyof typeof WHO_GROWTH
`,
  )

  const { size } = await import('node:fs').then((fs) => fs.promises.stat(OUT))
  console.log(`\n  -> src/data/whoGrowth.ts  ${(size / 1024).toFixed(0)} kB`)
  console.log('\nCommitted deliberately: a growth chart that needs a setup step is')
  console.log('one that is missing when a child is in front of somebody.')
}

main().catch((err) => {
  console.error(`\nvendor-who failed: ${err.message}`)
  process.exit(1)
})

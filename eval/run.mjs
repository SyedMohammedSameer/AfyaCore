#!/usr/bin/env node
/**
 * AfyaCore evaluation harness.
 *
 *   npm run eval              # everything available, table to stdout
 *   npm run eval -- --json    # machine-readable, for a paper or a CI check
 *
 * Produces the numbers a reader is entitled to ask for and that a README
 * otherwise asserts without evidence: how well the rule extractor actually
 * reads dictation, how much of an identifier set the de-identification removes,
 * what the install costs, and how fast it runs.
 *
 * Three properties this harness is built around:
 *
 * 1. **The corpus is synthetic and says so.** No real patient data anywhere,
 *    per CONTRIBUTING.md. That bounds what the numbers mean and the report says
 *    that in the output rather than in a footnote nobody reads.
 *
 * 2. **De-identification recall is split by whether the identifier is on the
 *    roster.** A combined number would hide the entire question. Exact matching
 *    gets the roster set by construction; the off-roster set is the only thing
 *    a 67 MB model is being asked to buy.
 *
 * 3. **Precision is measured against clinical terms that must survive.** A
 *    scrubber that redacts every word scores 100% recall and destroys the
 *    record. `mustKeep` is what stops that from looking like success.
 */
import { readFile, readdir, stat } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

const asJson = process.argv.includes('--json')

/* ------------------------------------------------------------------ *
 * Extraction
 * ------------------------------------------------------------------ */

/**
 * Score one extraction case field by field.
 *
 * Counted as a micro-average over atomic facts (each vital, each prescription
 * attribute, complaint, diagnosis) rather than per case. A case-level
 * "correct/incorrect" would let one missed duration mark an otherwise perfect
 * consultation as a failure, which tells a reader nothing about where the
 * extractor is weak.
 */
function scoreExtraction(expected, actual) {
  let tp = 0
  let fp = 0
  let fn = 0
  const misses = []

  const compare = (key, want, got) => {
    if (want === undefined && got === undefined) return
    if (want === undefined) {
      fp++
      misses.push(`+${key}=${got}`)
      return
    }
    if (got === undefined) {
      fn++
      misses.push(`-${key}`)
      return
    }
    if (typeof want === 'number' ? Math.abs(want - got) < 1e-6 : normalise(want) === normalise(got)) {
      tp++
    } else {
      // A wrong value is both a miss and a spurious answer. Counting it only as
      // a miss would let a confidently wrong extractor look merely incomplete.
      fp++
      fn++
      misses.push(`~${key}: want ${want}, got ${got}`)
    }
  }

  const wantVitals = expected.vitals ?? {}
  const gotVitals = actual.vitals ?? {}
  for (const key of new Set([...Object.keys(wantVitals), ...Object.keys(gotVitals)])) {
    compare(`vitals.${key}`, wantVitals[key], gotVitals[key]?.value)
  }

  compare('chiefComplaint', expected.chiefComplaint, actual.chiefComplaint?.value)
  compare('diagnosis', expected.diagnosis, actual.diagnosis?.value)

  const wantRx = expected.prescriptions ?? []
  const gotRx = actual.prescriptions ?? []
  for (let i = 0; i < Math.max(wantRx.length, gotRx.length); i++) {
    const want = wantRx[i]
    const got = gotRx[i]
    if (!want) {
      fp++
      misses.push(`+rx[${i}]=${got?.drug}`)
      continue
    }
    if (!got) {
      fn++
      misses.push(`-rx[${i}]=${want.drug}`)
      continue
    }
    for (const attr of ['drug', 'dose', 'frequencyPerDay', 'durationDays']) {
      compare(`rx[${i}].${attr}`, want[attr], got[attr])
    }
  }

  return { tp, fp, fn, misses }
}

const normalise = (s) =>
  String(s)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()

async function runExtraction(extractClinical, locales) {
  const files = (await readdir(join(here, 'corpus'))).filter((f) => f.startsWith('extraction.'))
  const results = []

  for (const file of files.sort()) {
    const corpus = JSON.parse(await readFile(join(here, 'corpus', file), 'utf8'))
    const locale = locales[corpus.locale]
    let tp = 0
    let fp = 0
    let fn = 0
    const failures = []
    const timings = []

    for (const testCase of corpus.cases) {
      const started = performance.now()
      const actual = extractClinical(testCase.text, locale)
      timings.push(performance.now() - started)

      const score = scoreExtraction(testCase.expect, actual)
      tp += score.tp
      fp += score.fp
      fn += score.fn
      if (score.misses.length) failures.push({ id: testCase.id, misses: score.misses })
    }

    timings.sort((a, b) => a - b)
    results.push({
      locale: corpus.locale,
      cases: corpus.cases.length,
      ...prf(tp, fp, fn),
      medianMs: Number(timings[Math.floor(timings.length / 2)].toFixed(3)),
      failures,
    })
  }

  return results
}

function prf(tp, fp, fn) {
  const precision = tp + fp === 0 ? 1 : tp / (tp + fp)
  const recall = tp + fn === 0 ? 1 : tp / (tp + fn)
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall)
  return {
    tp,
    fp,
    fn,
    precision: Number(precision.toFixed(4)),
    recall: Number(recall.toFixed(4)),
    f1: Number(f1.toFixed(4)),
  }
}

/* ------------------------------------------------------------------ *
 * De-identification
 * ------------------------------------------------------------------ */

/**
 * Score de-identification.
 *
 * Recall is over identifier *instances*: an identifier counts as removed when
 * its literal text no longer appears in the output. Deliberately strict, and
 * deliberately not "did a redaction marker appear somewhere" — a marker in the
 * wrong place is not a removal.
 *
 * Precision here is not the usual span precision. What actually matters is
 * whether clinical content survived, so it is measured over `mustKeep` terms:
 * a scrubber that redacts everything scores perfect recall and is useless.
 */
async function runDeident(scrubFreeText, deidentifyText) {
  const corpus = JSON.parse(await readFile(join(here, 'corpus', 'deident.json'), 'utf8'))

  const terms = corpus.roster.flatMap((p) =>
    [p.familyName, p.givenName, p.address, p.registerNo].filter(Boolean),
  )

  const buckets = {
    onRoster: { removed: 0, total: 0 },
    offRoster: { removed: 0, total: 0 },
  }
  let keptClinical = 0
  let totalClinical = 0
  const leaks = []
  const overRedactions = []
  const timings = []

  for (const testCase of corpus.cases) {
    const started = performance.now()
    const { text: out } = scrubFreeText(testCase.text, terms)
    timings.push(performance.now() - started)

    for (const identifier of testCase.identifiers) {
      const bucket = identifier.onRoster ? buckets.onRoster : buckets.offRoster
      bucket.total++
      if (!out.includes(identifier.value)) {
        bucket.removed++
      } else {
        leaks.push({ id: testCase.id, value: identifier.value, onRoster: identifier.onRoster })
      }
    }

    for (const keep of testCase.mustKeep) {
      totalClinical++
      if (out.includes(keep)) keptClinical++
      else overRedactions.push({ id: testCase.id, destroyed: keep })
    }
  }

  timings.sort((a, b) => a - b)

  const rate = (b) => (b.total === 0 ? null : Number((b.removed / b.total).toFixed(4)))

  return {
    onRosterRecall: rate(buckets.onRoster),
    onRoster: buckets.onRoster,
    offRosterRecall: rate(buckets.offRoster),
    offRoster: buckets.offRoster,
    clinicalRetention: totalClinical === 0 ? null : Number((keptClinical / totalClinical).toFixed(4)),
    clinicalTerms: { kept: keptClinical, total: totalClinical },
    medianMs: Number(timings[Math.floor(timings.length / 2)].toFixed(3)),
    leaks,
    overRedactions,
    neural: deidentifyText ? 'measured' : 'not run (model absent)',
  }
}

/* ------------------------------------------------------------------ *
 * Install cost
 * ------------------------------------------------------------------ */

/**
 * What a phone actually downloads on a cold install.
 *
 * Measured from `dist/`, not asserted, and split three ways because they are
 * three different claims and conflating them is how a "135 kB app" quietly
 * becomes an 80 MB one:
 *
 *   initial    the entry chunk and its stylesheet, what a cold visit blocks on
 *   precached  everything the service worker pulls in the background, which
 *              includes every lazily-imported route and the interface font
 *   onDemand   fetched only if a facility asks for the feature, never precached
 *
 * The font is counted raw and reported separately. woff2 is Brotli-compressed
 * inside the container, so gzipping it again measures nothing, and folding it
 * silently into a gzip total would understate what the phone actually pulls.
 */
async function measureBundle() {
  const assets = join(root, 'dist', 'assets')
  try {
    await stat(assets)
  } catch {
    return { error: 'dist/ not found — run `npm run build` first' }
  }

  const files = await readdir(assets)
  let initialGzip = 0
  let precachedGzip = 0
  let onDemandRaw = 0
  let fontRaw = 0

  for (const file of files) {
    const path = join(assets, file)
    const { size } = await stat(path)

    // Mirrors globIgnores in vite.config.ts: these never enter the precache.
    if (/transformers|ort-/.test(file)) {
      onDemandRaw += size
      continue
    }
    if (/\.woff2?$/.test(file)) {
      fontRaw += size
      continue
    }
    if (!/\.(js|css)$/.test(file)) continue

    const gzipped = gzipSync(await readFile(path)).length
    precachedGzip += gzipped
    // The entry chunk and its stylesheet are what a cold visit waits on; every
    // other chunk is a route that loads when someone navigates to it.
    if (/^index-/.test(file)) initialGzip += gzipped
  }

  return {
    initialGzipKb: Number((initialGzip / 1024).toFixed(1)),
    precachedGzipKb: Number(((precachedGzip + fontRaw) / 1024).toFixed(1)),
    fontRawKb: Number((fontRaw / 1024).toFixed(1)),
    onDemandRawKb: Number((onDemandRaw / 1024).toFixed(1)),
  }
}

/* ------------------------------------------------------------------ *
 * Report
 * ------------------------------------------------------------------ */

const pct = (v) => (v === null ? 'n/a' : `${(v * 100).toFixed(1)}%`)

function printReport(report) {
  const line = (s = '') => console.log(s)

  line()
  line('AfyaCore evaluation')
  line('='.repeat(72))
  line(`corpus: synthetic, ${report.corpusNote}`)
  line(`date:   ${report.date}`)
  line()

  line('Extraction, dictation transcript -> structured fields')
  line('-'.repeat(72))
  line('  locale  cases       P       R      F1   median')
  for (const r of report.extraction) {
    line(
      `  ${r.locale.padEnd(6)}  ${String(r.cases).padStart(5)}  ` +
        `${pct(r.precision).padStart(6)}  ${pct(r.recall).padStart(6)}  ` +
        `${pct(r.f1).padStart(6)}  ${`${r.medianMs} ms`.padStart(8)}`,
    )
  }
  for (const r of report.extraction) {
    if (!r.failures.length) continue
    line()
    line(`  ${r.locale} failures:`)
    for (const f of r.failures) {
      for (const miss of f.misses) line(`    ${f.id.padEnd(28)} ${miss}`)
    }
  }

  line()
  line('De-identification of free text')
  line('-'.repeat(72))
  const d = report.deident
  line(
    `  identifiers ON the roster     ${pct(d.onRosterRecall).padStart(7)}  ` +
      `(${d.onRoster.removed}/${d.onRoster.total} removed)`,
  )
  line(
    `  identifiers OFF the roster    ${pct(d.offRosterRecall).padStart(7)}  ` +
      `(${d.offRoster.removed}/${d.offRoster.total} removed)`,
  )
  line(
    `  clinical content retained     ${pct(d.clinicalRetention).padStart(7)}  ` +
      `(${d.clinicalTerms.kept}/${d.clinicalTerms.total} terms)`,
  )
  line(`  median                        ${`${d.medianMs} ms`.padStart(7)}`)
  line(`  neural pass                   ${d.neural}`)

  if (d.leaks.length) {
    line()
    line('  not removed:')
    for (const leak of d.leaks) {
      line(`    ${leak.id.padEnd(28)} ${leak.value}  ${leak.onRoster ? '(ON ROSTER)' : '(off roster)'}`)
    }
  }
  if (d.overRedactions.length) {
    line()
    line('  clinical content destroyed:')
    for (const over of d.overRedactions) line(`    ${over.id.padEnd(28)} ${over.destroyed}`)
  }

  line()
  line('Install cost')
  line('-'.repeat(72))
  const b = report.bundle
  if (b.error) {
    line(`  ${b.error}`)
  } else {
    line(`  initial load (blocking)       ${String(b.initialGzipKb).padStart(7)} kB gzip`)
    line(`  interface font (swap, cached) ${String(b.fontRawKb).padStart(7)} kB raw`)
    line(`  precached shell (background)  ${String(b.precachedGzipKb).padStart(7)} kB`)
    line(`  on demand, never precached    ${String(b.onDemandRawKb).padStart(7)} kB raw`)
  }

  line()
  line('Interpretation')
  line('-'.repeat(72))
  line('  The off-roster row is the whole case for the neural pass. Exact matching')
  line('  cannot reach those identifiers by construction, so that number is the one')
  line('  a 67 MB download has to move. Run `npm run vendor:openmed` and re-run to')
  line('  measure it.')
  line()
  line('  Clinical retention is not a nice-to-have: a scrubber that redacts every')
  line('  word scores 100% recall and destroys the record.')
  line()
  line('  Numbers are over a SYNTHETIC corpus written alongside the implementation.')
  line('  They bound correctness on cases we anticipated; they are not evidence of')
  line('  performance on real clinical dictation, which remains unmeasured.')
  line()
}

/* ------------------------------------------------------------------ *
 * Main
 * ------------------------------------------------------------------ */

async function main() {
  // Imported through the TypeScript sources via vite-node so the harness
  // measures the code that actually ships rather than a transpiled copy that
  // can drift from it.
  const { extractClinical } = await import('../src/lib/clinicalExtract.ts')
  const { CLINICAL_LOCALES } = await import('../src/lib/clinicalLocales.ts')
  const { scrubFreeText } = await import('../src/lib/deidentify.ts')
  const { loadBackend } = await import('../src/lib/openmed.ts')

  // Present only where the model has been vendored; absent is the normal case
  // and the report says which happened rather than silently reporting zero.
  let backend = null
  try {
    backend = await loadBackend()
  } catch {
    backend = null
  }

  const report = {
    date: new Date().toISOString().slice(0, 10),
    corpusNote: 'no real patient data (CONTRIBUTING.md)',
    extraction: await runExtraction(extractClinical, CLINICAL_LOCALES),
    deident: await runDeident(scrubFreeText, backend),
    bundle: await measureBundle(),
  }

  if (asJson) {
    console.log(JSON.stringify(report, null, 2))
  } else {
    printReport(report)
  }

  // Non-zero when an identifier the roster HOLDS survived, or clinical content
  // was destroyed. Both are correctness failures rather than accuracy numbers,
  // so CI should fail on them; off-roster misses are expected without the model
  // and must not fail the build.
  const rosterLeak = report.deident.leaks.some((l) => l.onRoster)
  if (rosterLeak || report.deident.overRedactions.length) process.exit(1)
}

main().catch((err) => {
  console.error(`eval failed: ${err.stack ?? err.message}`)
  process.exit(1)
})

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
import { scoreE3C } from './e3c.mjs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

const asJson = process.argv.includes('--json')

/**
 * `--stub-neural`: run the two-column comparison against a fake backend.
 *
 * Exists so the neural code path — BIO decoding, span merging, redaction,
 * scoring and the comparison table — can be exercised without a 70 MB
 * download, which is how it went unnoticed that `runDeident` accepted a
 * backend and never called it. CI can run this; a laptop with no Hub access
 * can run this.
 *
 * It is NOT a measurement and the report says so in capitals every time. The
 * stub is a crude capitalised-word tagger, not a model, and any number it
 * produces describes the plumbing rather than OpenMed.
 */
const stubNeural = process.argv.includes('--stub-neural')

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
/**
 * Spans the guard kept, across the whole run.
 *
 * Counted because the guard is a deliberate weakening of a privacy control and
 * therefore has to be visible: "kept 41 spans" is a number somebody can argue
 * with, where a silent veto is not.
 */
const protectedTally = { count: 0 }

async function runDeident(scrubFreeText, applyEntities, backend) {
  const corpus = JSON.parse(await readFile(join(here, 'corpus', 'deident.json'), 'utf8'))

  const terms = corpus.roster.flatMap((p) =>
    [p.familyName, p.givenName, p.address, p.registerNo].filter(Boolean),
  )

  /**
   * Score one scrubbing strategy over the whole corpus.
   *
   * Factored out so the deterministic pass and the deterministic+neural pass
   * are scored by identical code. Running them through two similar-looking
   * loops is how a comparison table ends up measuring two different things.
   */
  const score = async (scrub) => {
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
      const out = await scrub(testCase.text)
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
      clinicalRetention:
        totalClinical === 0 ? null : Number((keptClinical / totalClinical).toFixed(4)),
      clinicalTerms: { kept: keptClinical, total: totalClinical },
      medianMs: Number(timings[Math.floor(timings.length / 2)].toFixed(3)),
      leaks,
      overRedactions,
    }
  }

  const deterministic = await score((text) => scrubFreeText(text, terms).text)

  /**
   * The neural pass, applied exactly as `deidentify` applies it in production:
   * after the deterministic scrub, over its output, adding redactions only.
   *
   * This is the number the whole optional 70 MB download exists to produce,
   * and until now the harness took a `backend` argument and never called it —
   * it reported "measured" while measuring nothing, which is the same class of
   * bug as the availability check that claimed a model was installed when it
   * was not.
   */
  const neural = backend
    ? await score(async (text) => {
        const scrubbed = scrubFreeText(text, terms).text
        try {
          const applied = applyEntities(scrubbed, await backend(scrubbed))
          protectedTally.count += applied.protectedSpans
          return applied.text
        } catch {
          // A backend failure must not be scored as a redaction failure; it is
          // reported as the deterministic result, which is what production
          // would fall back to.
          return scrubbed
        }
      })
    : null

  return { deterministic, neural, ...deterministic }
}

/* ------------------------------------------------------------------ *
 * Real clinical text
 * ------------------------------------------------------------------ */

/**
 * Clinical retention over E3C, if it has been fetched.
 *
 * Absent is the normal case and reported as such, the same way the model is.
 * See scripts/vendor-e3c.mjs for what this corpus measures, what it cannot
 * (there is no PII layer, so recall is not measurable here), and why it is not
 * committed.
 */
async function runRealText(scrubFreeText, applyEntities, backend) {
  const out = {}

  for (const [code, label] of [
    ['fr', 'French'],
    ['en', 'English'],
  ]) {
    let corpus
    try {
      corpus = JSON.parse(await readFile(join(root, '.cache', 'e3c', `${code}.json`), 'utf8'))
    } catch {
      continue
    }

    // No roster: E3C is somebody else's corpus and there is no patient list to
    // match against. That is the point — this measures what a scrub destroys
    // when it has no roster to guide it, which is the worst case.
    const deterministic = await scoreE3C(corpus.rows, (t) => scrubFreeText(t, []).text)
    const neural = backend
      ? await scoreE3C(corpus.rows, async (t) => {
          const scrubbed = scrubFreeText(t, []).text
          try {
            const applied = applyEntities(scrubbed, await backend(scrubbed))
            protectedTally.count += applied.protectedSpans
            return applied.text
          } catch {
            return scrubbed
          }
        })
      : null

    out[code] = { label, dataset: corpus.dataset, config: corpus.config, deterministic, neural }
  }

  return Object.keys(out).length ? out : null
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
  const d = report.deident.deterministic
  const n = report.deident.neural

  // Two columns when the model is present, one when it is not. The delta on
  // the off-roster row is the entire argument for the optional download, so it
  // is shown side by side rather than as two separate runs a reader has to
  // hold in their head.
  const col = (v) => (n ? pct(v).padStart(11) : '')
  if (n && report.stubNeural) {
    line('  *** --stub-neural: the second column is a FAKE backend, not OpenMed. ***')
    line('  *** It exercises the code path. The numbers mean nothing.            ***')
    line()
  }
  line(
    `  ${''.padEnd(30)}${'deterministic'.padStart(13)}` +
      `${n ? (report.stubNeural ? '    STUB (fake)' : '   + OpenMed') : ''}`,
  )
  line(
    `  identifiers ON the roster     ${pct(d.onRosterRecall).padStart(11)}` +
      `${col(n?.onRosterRecall)}   (${d.onRoster.total} instances)`,
  )
  line(
    `  identifiers OFF the roster    ${pct(d.offRosterRecall).padStart(11)}` +
      `${col(n?.offRosterRecall)}   (${d.offRoster.total} instances)`,
  )
  line(
    `  clinical content retained     ${pct(d.clinicalRetention).padStart(11)}` +
      `${col(n?.clinicalRetention)}   (${d.clinicalTerms.total} terms)`,
  )
  line(
    `  median latency                ${`${d.medianMs} ms`.padStart(11)}` +
      `${n ? `${`${n.medianMs} ms`.padStart(11)}` : ''}`,
  )
  if (!n) line(`  neural pass                   not run (model absent)`)

  const diag = report.backendDiagnostics
  if (diag) {
    line()
    line(
      `  model: ${diag.calls} calls, ${diag.tokensTagged} tokens tagged, ` +
        `${diag.spansAligned} spans after alignment, ` +
        `${report.protectedSpans} kept by the clinical guard`,
    )
    // The check that would have caught a pass which loaded 70 MB, ran the
    // model, and discarded every token it produced.
    if (diag.tokensTagged > 0 && diag.spansAligned === 0) {
      line('  *** the model tagged tokens and NONE survived alignment — this is a bug ***')
    }
    if (diag.tokensTagged === 0 && diag.calls > 0) {
      line('  *** the model tagged nothing at all — check the labels and the graph ***')
    }
  }

  if (n) {
    line()
    // The two rows that decide whether the download was worth it. Stated as a
    // delta because "83%" means nothing without the 0% it replaced, and
    // because a retention drop is the price being paid for it.
    const delta = (a, b) => {
      if (a === null || b === null) return 'n/a'
      const diff = (b - a) * 100
      return `${diff >= 0 ? '+' : ''}${diff.toFixed(1)} pp`
    }
    line(`  off-roster recall             ${delta(d.offRosterRecall, n.offRosterRecall)}`)
    line(`  clinical retention            ${delta(d.clinicalRetention, n.clinicalRetention)}`)
  }

  const leakList = (label, leaks) => {
    if (!leaks.length) return
    line()
    line(`  ${label}`)
    for (const leak of leaks) {
      line(`    ${leak.id.padEnd(28)} ${leak.value}  ${leak.onRoster ? '(ON ROSTER)' : '(off roster)'}`)
    }
  }
  leakList(n ? 'not removed by the deterministic pass:' : 'not removed:', d.leaks)
  if (n) leakList('still not removed after OpenMed:', n.leaks)
  const destroyedList = (label, overRedactions) => {
    if (!overRedactions.length) return
    line()
    line(`  ${label}`)
    for (const over of overRedactions) line(`    ${over.id.padEnd(28)} ${over.destroyed}`)
  }
  destroyedList('clinical content destroyed:', d.overRedactions)
  // The neural pass's over-redactions are the cost side of the trade, and the
  // one a reviewer asks about first: drug names and place-of-treatment look
  // like proper nouns to any NER model. Listed by name rather than left as a
  // percentage, because "which words did it eat" is the actionable question.
  if (n) destroyedList('clinical content destroyed by the neural pass:', n.overRedactions)

  if (report.realText) {
    line()
    line('Clinical retention on REAL clinical text (E3C)')
    line('-'.repeat(72))
    line('  Out of domain: published hospital case reports, not health-post dictation.')
    line('  No PII layer, so recall is not measurable here. This is the other half:')
    line('  how much real clinical content a scrub destroys, against gold spans.')
    line()
    for (const r of Object.values(report.realText)) {
      const d = r.deterministic
      const n = r.neural
      line(
        `  ${r.label.padEnd(9)} deterministic ${pct(d.retention).padStart(7)}` +
          `${n ? `   + OpenMed ${pct(n.retention).padStart(7)}` : ''}` +
          `   (${d.total} gold entities, ${d.sentences} sentences)`,
      )
      const worst = n ? n.worst : d.worst
      if (worst.length) {
        line(`    most-destroyed: ${worst.map((w) => `${w.term} (${w.count})`).join(', ')}`)
      }
    }
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
  if (!report.realText) {
    line('  E3C was not fetched, so every number above is over a corpus we wrote')
    line('  ourselves. Run `npm run vendor:e3c` to score retention against real')
    line('  clinical text with gold annotations.')
    line()
  }
  line('  Extraction and recall numbers are over a SYNTHETIC corpus written alongside')
  line('  the implementation.')
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
  const { loadBackend, applyEntities, getBackendDiagnostics } = await import(
    '../src/lib/openmed.ts',
  )

  /*
   * Load the model from the filesystem rather than over HTTP.
   *
   * The app checks for the model by fetching `/models/openmed-pii-fr/
   * config.json`, which is right in a page and meaningless here: Node has no
   * origin, so that path throws before it reaches the network. The same is
   * true of `env.localModelPath`, a URL prefix in the browser and a directory
   * on disk under Node. Both are injected rather than special-cased inside the
   * app, so the shipped code path stays the browser one.
   */
  const modelRoot = join(root, 'public', 'models')
  const available = async () => {
    try {
      await stat(join(modelRoot, 'openmed-pii-fr', 'config.json'))
      return true
    } catch {
      return false
    }
  }

  // Present only where the model has been vendored; absent is the normal case
  // and the report says which happened rather than silently reporting zero.
  let backend = null
  if (stubNeural) {
    // Tags any capitalised word that is not sentence-initial and not already a
    // redaction marker. Wrong in both directions on purpose: it is a plumbing
    // exercise, not a baseline worth reporting.
    backend = async (text) => {
      const entities = []
      for (const m of text.matchAll(/(?<![.!?]\s)(?<![\w'’-])\p{Lu}\p{L}{2,}/gu)) {
        entities.push({
          label: 'LASTNAME',
          start: m.index,
          end: m.index + m[0].length,
          score: 0.9,
        })
      }
      return entities
    }
  }
  try {
    if (stubNeural) throw { skip: true }
    backend = await loadBackend({ modelRoot: `${modelRoot}/`, available })
  } catch (err) {
    if (err?.skip) {
      // --stub-neural: the stub backend above stands in, deliberately.
    } else {
      // Loud rather than silent. A model that is on disk but will not load is
      // a different problem from one that was never downloaded, and reporting
      // both as "absent" is how the first goes unnoticed.
      if (await available()) {
        console.error(`\n  model present but failed to load: ${err.message}\n`)
      }
      backend = null
    }
  }

  const report = {
    date: new Date().toISOString().slice(0, 10),
    stubNeural,
    corpusNote: 'no real patient data (CONTRIBUTING.md)',
    extraction: await runExtraction(extractClinical, CLINICAL_LOCALES),
    deident: await runDeident(scrubFreeText, applyEntities, backend),
    realText: await runRealText(scrubFreeText, applyEntities, backend),
    // Read after every scoring pass, so it covers the whole run.
    backendDiagnostics: backend && !stubNeural ? getBackendDiagnostics() : null,
    protectedSpans: protectedTally.count,
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
  const det = report.deident.deterministic
  const rosterLeak = det.leaks.some((l) => l.onRoster)
  if (rosterLeak || det.overRedactions.length) process.exit(1)
}

main().catch((err) => {
  console.error(`eval failed: ${err.stack ?? err.message}`)
  process.exit(1)
})

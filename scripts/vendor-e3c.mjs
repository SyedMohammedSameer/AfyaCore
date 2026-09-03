#!/usr/bin/env node
/**
 * Fetch the E3C clinical corpus into `.cache/e3c/`, for evaluation only.
 *
 * ## Why a real corpus at all
 *
 * Every number this project reports comes from a corpus we wrote ourselves,
 * alongside the code it tests. That bounds correctness on cases we anticipated
 * and is worth exactly nothing as evidence about text we did not anticipate,
 * which is the only kind that matters. A reviewer will say so, and they will
 * be right.
 *
 * E3C — the European Clinical Case Corpus (Minard et al., FBK, 2021) — is real
 * clinical narrative in French and English, published, already pseudonymised
 * at source, and annotated for clinical entities by people with no interest in
 * how our scrubber performs. That last part is the point.
 *
 * ## What it can and cannot measure
 *
 * It has **no PII annotation layer**, so it cannot measure de-identification
 * recall. It has gold `CLINENTITY` spans, so it can measure the other half,
 * which is the half our own corpus is least able to judge honestly: how much
 * real clinical content a scrubber destroys. A redactor that removes
 * everything scores perfect recall; this is the number that catches it, on
 * text nobody on this project wrote.
 *
 * It is also **out of domain**, and that is stated everywhere the numbers are:
 * these are hospital case reports, not a nurse dictating vitals at a health
 * post. Treat the result as a stress test, not a validation.
 *
 * ## Why it is not committed
 *
 * The licence could not be established from a primary source: the corpus
 * homepage and the ELG catalogue were unreachable, and secondary sources
 * disagree between CC BY 4.0 and CC BY-NC 4.0. Rather than guess — the same
 * rule this project applies to retention periods and breach deadlines — the
 * corpus is fetched by the person running the evaluation and never
 * redistributed here. Evaluation with attribution is fine under either
 * reading; redistribution is the part that differs, so we simply do not.
 *
 *   npm run vendor:e3c
 *
 * Cite:
 *   Minard, Zanoli, Altuna, Speranza, Magnini, Lavelli (2021).
 *   European Clinical Case Corpus, v2.0.0. Fondazione Bruno Kessler.
 *   https://doi.org/10.57771/dey2-g751
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, '.cache', 'e3c')

const DATASET = 'DrBenchmark/E3C'
const SPLIT = 'test'
// French first: it is the clinical language of five of the nine country
// profiles and the one the vendored OpenMed model is trained for.
const CONFIGS = [
  ['French_clinical', 'fr'],
  ['English_clinical', 'en'],
]

// The rows API caps a page at 100.
const PAGE = 100

async function fetchConfig(config) {
  const rows = []
  for (let offset = 0; ; offset += PAGE) {
    const url =
      `https://datasets-server.huggingface.co/rows?dataset=${encodeURIComponent(DATASET)}` +
      `&config=${encodeURIComponent(config)}&split=${SPLIT}&offset=${offset}&length=${PAGE}`
    const res = await fetch(url)
    if (!res.ok) throw new Error(`${config} offset ${offset} -> HTTP ${res.status}`)
    const body = await res.json()
    const page = body.rows ?? []
    for (const entry of page) {
      const r = entry.row
      // Keep only what the harness scores. The corpus carries more; storing it
      // would be redistributing more of someone else's data than we need.
      if (r?.text && Array.isArray(r.tokens) && Array.isArray(r.ner_tags)) {
        rows.push({ id: String(r.id), text: r.text, tokens: r.tokens, nerTags: r.ner_tags })
      }
    }
    process.stdout.write(`\r  ${config}: ${rows.length} rows`)
    if (page.length < PAGE) break
  }
  process.stdout.write('\n')
  return rows
}

async function main() {
  await mkdir(outDir, { recursive: true })
  console.log(`fetching ${DATASET} (${SPLIT} split), evaluation use only\n`)

  for (const [config, code] of CONFIGS) {
    const rows = await fetchConfig(config)
    await writeFile(
      join(outDir, `${code}.json`),
      `${JSON.stringify({ dataset: DATASET, config, split: SPLIT, rows }, null, 0)}\n`,
    )
  }

  console.log(`\n  -> ${outDir}`)
  console.log('\nNot committed, and not redistributed: see the header of this file for why.')
  console.log('Run `npm run eval` to score against it.')
}

main().catch((err) => {
  console.error(`\nvendor-e3c failed: ${err.message}`)
  console.error('\nThe evaluation still runs without it, over the synthetic corpus only.')
  process.exit(1)
})

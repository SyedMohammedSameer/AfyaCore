/**
 * The OCR language mapping.
 *
 * There is no unit test here for recognition itself: that would be testing
 * Tesseract, in a headless environment, over a fixture image, which measures
 * somebody else's model and takes twelve megabytes to do it. What is worth
 * pinning is the wiring, because the wiring is what was wrong — the app read
 * every photograph with the French model regardless of country, and nothing
 * failed when it did.
 *
 * Two invariants, both of which would have caught that:
 *
 *   1. Every clinical language the extractor parses has an OCR model.
 *   2. Every model the client can ask for is one the build actually vendors.
 *
 * The second reads `scripts/vendor-ocr.mjs` as text rather than importing it,
 * because that script downloads ~12 MB on import. Coarse, and it still fails
 * for the right reason: adding a clinical language without adding its
 * `.traineddata` is the mistake being guarded against.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { TESSERACT_LANG } from './ocr'
import { CLINICAL_LOCALES } from './clinicalLocales'

describe('OCR language selection', () => {
  it('has a model for every clinical language the extractor parses', () => {
    for (const lang of Object.keys(CLINICAL_LOCALES)) {
      expect(TESSERACT_LANG[lang as keyof typeof TESSERACT_LANG]).toBeTruthy()
    }
  })

  it('asks only for models the build vendors', () => {
    const script = readFileSync(join(process.cwd(), 'scripts', 'vendor-ocr.mjs'), 'utf8')
    const declared = /const LANGS = \[([^\]]*)\]/.exec(script)
    expect(declared, 'LANGS not found in vendor-ocr.mjs').toBeTruthy()

    const vendored = declared![1]!.match(/'([a-z]{3})'/g)?.map((s) => s.slice(1, -1)) ?? []
    for (const code of Object.values(TESSERACT_LANG)) {
      expect(vendored, `${code} is requested at runtime but never vendored`).toContain(code)
    }
  })

  it('does not map any clinical language to Malagasy', () => {
    // Tesseract has no `mlg` model. If one is ever added here it will 404 at
    // load and OCR will silently stop working for that deployment, so the
    // absence is asserted rather than left as a comment.
    expect(Object.values(TESSERACT_LANG)).not.toContain('mlg')
  })
})

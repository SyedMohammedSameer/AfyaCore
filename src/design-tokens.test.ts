/**
 * Every colour utility in the app names a token that exists.
 *
 * This is here because of a bug that no type check and no unit test could have
 * caught: the growth chart drew its ±3 SD reference bands in `stroke-warn-400`,
 * and there is no `--color-warn-400`. Tailwind emits nothing for a class it
 * cannot resolve, SVG's default stroke is `none`, and the result was a chart
 * whose caption said "below −3: refer" beside two lines that were not drawn.
 * It compiled, it passed 506 tests, and it was only visible in a screenshot.
 *
 * A misspelt token is silent everywhere it appears — text with no colour
 * inherits and looks plausible, a background with no colour is transparent and
 * looks intentional. So the check is a source scan rather than a render: it
 * costs milliseconds and it covers every component at once, including the ones
 * with no test of their own.
 *
 * The trade for that reach is that only static class names are seen. A class
 * assembled at runtime from a variable is invisible here, which is one more
 * reason this codebase writes them out in full in a lookup object.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = new URL('.', import.meta.url).pathname
const CSS = readFileSync(join(SRC, 'index.css'), 'utf8')

/** `--color-brand-600: …` in the theme block. */
const TOKENS = new Set([...CSS.matchAll(/--color-([a-z0-9-]+)\s*:/g)].map((m) => m[1]!))
/** `@utility bg-brand-gradient { … }` — a hand-written utility, equally real. */
const UTILITIES = new Set([...CSS.matchAll(/@utility\s+([a-z0-9-]+)/g)].map((m) => m[1]!))

/**
 * Utilities that take a palette colour. Deliberately not every Tailwind
 * property: the families listed are the ones this app uses, and an unknown
 * prefix should be added here rather than silently skipped.
 */
const PROPERTIES =
  'stroke|fill|text|bg|border|ring|from|to|via|outline|decoration|accent|caret|divide|placeholder|shadow'
const FAMILIES = 'brand|ink|line|warn|danger|ok|sunken|surface|paper|accent'
const USE = new RegExp(String.raw`\b(?:${PROPERTIES})-((?:${FAMILIES})(?:-[a-z0-9]+)*)\b`, 'g')

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path))
    else if (/\.tsx$/.test(path)) out.push(path)
  }
  return out
}

describe('colour utilities', () => {
  it('has tokens to scan, so a broken regex fails loudly rather than passing', () => {
    expect(TOKENS.size).toBeGreaterThan(20)
    expect(TOKENS.has('brand-600')).toBe(true)
    expect(UTILITIES.has('bg-brand-gradient')).toBe(true)
  })

  it('never names a colour the stylesheet does not define', () => {
    const missing: string[] = []
    for (const file of sourceFiles(SRC)) {
      const source = readFileSync(file, 'utf8')
      for (const match of source.matchAll(USE)) {
        const name = match[1]!
        if (TOKENS.has(name) || UTILITIES.has(match[0])) continue
        missing.push(`${file.slice(SRC.length)}: ${match[0]}`)
      }
    }
    expect(missing, 'these render as nothing at all').toEqual([])
  })
})

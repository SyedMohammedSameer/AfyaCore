/**
 * Recovering drug names from a recogniser's spelling of them.
 *
 * Measured, not imagined: `npm run eval:asr` runs the vendored Whisper pack
 * over spoken versions of the extraction corpus, and the first run scored
 * 36% field F1 in French against 100% on clean text. Most of the loss was
 * drug names. The model has no idea what "paracétamol" is and writes what it
 * heard: "par assez tamol", "paraissait à mol", "a mux ici une" for
 * amoxicilline, "artémété lume et fantrine". The dose, the frequency and the
 * duration after each of them were transcribed perfectly and thrown away,
 * because the exact-match formulary lookup found no drug to attach them to.
 *
 * So, a second pass. Runs of one to four words are joined without spaces and
 * compared with each formulary entry by edit distance, and a close enough
 * run becomes a candidate. Two guards keep this from inventing medication:
 *
 *  1. **Context.** A candidate counts only when a dose, a frequency or a
 *     duration follows it, the way one follows a drug in dictation and does
 *     not follow an ordinary word. "Quinze jours" is two edits from quinine
 *     and is never a prescription; "quinine 300 mg trois fois par jour" is.
 *  2. **Confidence.** A recovered name is scored 0.5, below the review
 *     threshold, so it is flagged "Check this" and, with per-field review,
 *     cannot reach the record until a clinician has ticked it with the raw
 *     phrase beside it. The canonical name is offered; the transcript is
 *     kept. A clinician who dictated something not on the formulary sees
 *     exactly what happened.
 *
 * Nothing here is a model. It is a distance and two rules, it runs in
 * microseconds, and it is scored by the same harness that found the problem.
 */

/** Plain Levenshtein distance over code units, with an early exit at `limit`. */
export function editDistance(a: string, b: string, limit = Infinity): number {
  if (a === b) return 0
  if (Math.abs(a.length - b.length) > limit) return limit + 1
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const current = [i]
    let rowMin = i
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      current[j] = Math.min(previous[j]! + 1, current[j - 1]! + 1, previous[j - 1]! + cost)
      if (current[j]! < rowMin) rowMin = current[j]!
    }
    if (rowMin > limit) return limit + 1
    previous = current
  }
  return previous[b.length]!
}

/** Letters only, so "artémété lume et fantrine" and "artemetherlumefantrine" compare like for like. */
export function squash(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '')
}

/** How many edits a string of this length may be from a formulary entry and still be it. */
export function allowedEdits(length: number): number {
  return Math.ceil(length * 0.34)
}

/** Shortest squashed string worth comparing. Below this, coincidence is too cheap. */
export const MIN_SQUASHED = 8

/** Longest run of words a single drug name may have been split into. */
export const MAX_WINDOW = 4

export interface FuzzyHit {
  /** The canonical formulary entry, folded, as the formulary stores it. */
  drug: string
  start: number
  end: number
  distance: number
}

interface Word {
  text: string
  start: number
  end: number
}

function words(text: string): Word[] {
  const out: Word[] = []
  const re = /[a-z0-9]+(?:'[a-z0-9]+)?/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) out.push({ text: m[0], start: m.index, end: m.index + m[0].length })
  return out
}

export interface FuzzyOptions {
  /** Spans already claimed by an exact match; no candidate may overlap one. */
  taken?: { start: number; end: number }[]
  /**
   * Whether a run of words is really a number ("quinze", "twenty five").
   * A number is never a drug, however close its letters fall to one.
   */
  isNumber?: (run: string) => boolean
  /**
   * Whether what follows the candidate reads like a prescription: a dose, a
   * frequency or a duration. The context guard. Without it, this would turn
   * any long enough word into medication.
   */
  hasPrescriptionContext: (end: number) => boolean
}

/**
 * Find formulary entries a recogniser has misspelt.
 *
 * `text` is the folded transcript (lowercase, accents stripped, hyphens
 * spaced), the same string the exact match runs on, so the positions line up
 * with its claims.
 */
export function fuzzyDrugHits(text: string, formulary: readonly string[], options: FuzzyOptions): FuzzyHit[] {
  const { taken = [], isNumber = () => false, hasPrescriptionContext } = options
  const entries = formulary
    .map((drug) => ({ drug, squashed: squash(drug) }))
    .filter((e) => e.squashed.length >= MIN_SQUASHED)
  if (entries.length === 0) return []

  const tokens = words(text)
  const candidates: FuzzyHit[] = []

  for (let i = 0; i < tokens.length; i++) {
    for (let size = 1; size <= MAX_WINDOW && i + size <= tokens.length; size++) {
      const first = tokens[i]!
      const last = tokens[i + size - 1]!
      if (taken.some((t) => first.start < t.end && last.end > t.start)) continue

      const window = tokens.slice(i, i + size)
      // A drug name has no digits in it. A window that reaches into "500mg"
      // or "bd4" is a window that has swallowed the dose or the frequency,
      // and the longest-first ranking below would then prefer it.
      if (window.some((w) => /\d/.test(w.text))) continue
      const run = window.map((w) => w.text).join('')
      if (run.length < MIN_SQUASHED) continue
      if (isNumber(text.slice(first.start, last.end))) continue

      let best: FuzzyHit | null = null
      for (const entry of entries) {
        // The allowance follows the longer of the two: a recogniser adds
        // syllables as often as it drops them ("paraissait à mol" is three
        // letters longer than paracétamol), and the guards below, not the
        // arithmetic here, are what keep this from inventing medication.
        if (Math.abs(run.length - entry.squashed.length) > 4) continue
        const limit = allowedEdits(Math.max(entry.squashed.length, run.length))
        const distance = editDistance(run, entry.squashed, limit)
        if (distance > limit) continue
        if (!best || distance < best.distance) {
          best = { drug: entry.drug, start: first.start, end: last.end, distance }
        }
      }
      if (best && hasPrescriptionContext(best.end)) candidates.push(best)
    }
  }

  // Longest first, then closest. A long run landing within a third of its
  // length of an entry is stronger evidence than a short one, and it is the
  // fixed-dose combinations that split into the most words: "artémété lume et
  // fantrine" must be one prescription, not artemether beside lumefantrine.
  // A run already covered by a chosen candidate is dropped.
  candidates.sort((a, b) => b.end - b.start - (a.end - a.start) || a.distance - b.distance)
  const chosen: FuzzyHit[] = []
  for (const c of candidates) {
    if (chosen.some((k) => c.start < k.end && c.end > k.start)) continue
    chosen.push(c)
  }
  return chosen.sort((a, b) => a.start - b.start)
}

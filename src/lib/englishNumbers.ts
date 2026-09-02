/**
 * English spoken-number parsing.
 *
 * The counterpart to frenchNumbers.ts. Recognisers hand back "thirty eight
 * point five" as often as "38.5", and a clinician saying a temperature aloud in
 * English gets the same treatment as one saying it in French.
 *
 * Simpler than the French case: English has no equivalent of the
 * soixante-dix / quatre-vingt-dix compounds, so a plain additive scan suffices.
 */

const UNITS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
  eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13,
  fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18,
  nineteen: 19,
}

const TENS: Record<string, number> = {
  twenty: 20, thirty: 30, forty: 40, fifty: 50,
  sixty: 60, seventy: 70, eighty: 80, ninety: 90,
}

export const EN_NUMBER_WORDS = [
  ...Object.keys(UNITS), ...Object.keys(TENS),
  'hundred', 'thousand', 'and', 'point', 'half', 'a',
]

function parseWordSequence(tokens: string[]): number | undefined {
  let total = 0
  let current = 0
  let sawAny = false

  for (const t of tokens) {
    if (t in UNITS) {
      current += UNITS[t]!
      sawAny = true
    } else if (t in TENS) {
      current += TENS[t]!
      sawAny = true
    } else if (t === 'hundred') {
      current = (current === 0 ? 1 : current) * 100
      sawAny = true
    } else if (t === 'thousand') {
      total += (current === 0 ? 1 : current) * 1000
      current = 0
      sawAny = true
    } else if (t === 'and' || t === 'a') {
      // "one hundred and twenty" and "a hundred" carry no value of their own.
    } else {
      return undefined
    }
  }

  return sawAny ? total + current : undefined
}

/**
 * Parse an English number expression.
 *
 * Handles: "38.5" | "thirty eight point five" | "thirty-eight and a half"
 *
 * The decimal tail is assembled as a string, not divided, so "point twenty
 * five" is .25 rather than .0025.
 */
export function parseEnglishNumber(input: string): number | undefined {
  const text = input.toLowerCase().trim()
  if (!text) return undefined

  const digits = text.match(/^-?\d+(?:[.,]\d+)?$/)
  if (digits) return Number.parseFloat(text.replace(',', '.'))

  const halfMatch = text.match(/^(.*?)\s+and\s+a\s+half$/)
  if (halfMatch) {
    const whole = parseEnglishNumber(halfMatch[1]!)
    return whole === undefined ? undefined : whole + 0.5
  }

  const [wholePart, ...rest] = text.split(/\s+point\s+/)
  const tokenise = (s: string) => s.split(/[\s-]+/).filter(Boolean)

  const whole = /^\d+$/.test(wholePart!.trim())
    ? Number.parseInt(wholePart!.trim(), 10)
    : parseWordSequence(tokenise(wholePart!))
  if (whole === undefined) return undefined
  if (rest.length === 0) return whole

  const fractionRaw = rest.join(' ').trim()
  const fraction = /^\d+$/.test(fractionRaw)
    ? Number.parseInt(fractionRaw, 10)
    : parseWordSequence(tokenise(fractionRaw))
  if (fraction === undefined) return whole

  return Number.parseFloat(`${whole}.${fraction}`)
}

/**
 * Longest word first.
 *
 * Regex alternation is first-match-wins, so listing `nine` before `ninety`
 * makes "ninety two" match as `nine`, leaving "ty two" behind and yielding 9.
 * Sorting by length removes the whole class of bug.
 */
const ALT = [...EN_NUMBER_WORDS].sort((a, b) => b.length - a.length).join('|')

/**
 * The trailing `\b` matters for the same reason it does in the French pattern:
 * a number word that prefixes a unit word ("ten" in "tenderness", "one" in
 * "onset") would otherwise be swallowed into the number run and change the
 * value that gets parsed.
 */
export const EN_NUMBER_PATTERN = `(?:\\d+(?:[.,]\\d+)?|(?:${ALT})(?:[\\s-]+(?:${ALT}))*)\\b`

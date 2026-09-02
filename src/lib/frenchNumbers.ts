/**
 * French spoken-number parsing.
 *
 * Speech recognisers hand back French numerals as words far more often than as
 * digits, "trente-huit virgule cinq", not "38,5", so anything that wants to
 * read a temperature out of dictation has to understand written French numbers
 * first. This is pure, deterministic, and runs offline in microseconds, which is
 * why it is worth doing properly rather than delegating to a model.
 */

const UNITS: Record<string, number> = {
  zero: 0, un: 1, une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, six: 6, sept: 7,
  huit: 8, neuf: 9, dix: 10, onze: 11, douze: 12, treize: 13, quatorze: 14,
  quinze: 15, seize: 16,
}

const TENS: Record<string, number> = {
  vingt: 20, vingts: 20, trente: 30, quarante: 40, cinquante: 50, soixante: 60,
}

/** Every token that may legally appear inside a spoken number. */
export const NUMBER_WORDS = [
  ...Object.keys(UNITS), ...Object.keys(TENS),
  'cent', 'cents', 'mille', 'et', 'virgule', 'demi', 'demie',
]

function stripAccents(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '')
}

/**
 * Parse a run of French number words into a value.
 * Returns `undefined` if the tokens do not form a number.
 */
function parseWordSequence(tokens: string[]): number | undefined {
  let total = 0
  let current = 0
  let sawAny = false
  let i = 0

  while (i < tokens.length) {
    const t = tokens[i]!
    const next = tokens[i + 1]

    // 70 and 90 are additive compounds in standard French ("soixante-dix",
    // "quatre-vingt-dix"). Consume the compound head, then let the normal
    // additive loop pick up any trailing unit: quatre-vingt-dix-sept -> 80+10+7.
    if (t === 'quatre' && next !== undefined && (next === 'vingt' || next === 'vingts')) {
      current += 80
      sawAny = true
      i += 2
      continue
    }
    if (t === 'soixante' && next === 'dix') {
      current += 70
      sawAny = true
      i += 2
      continue
    }

    if (t in UNITS) {
      current += UNITS[t]!
      sawAny = true
    } else if (t in TENS) {
      current += TENS[t]!
      sawAny = true
    } else if (t === 'cent' || t === 'cents') {
      current = (current === 0 ? 1 : current) * 100
      sawAny = true
    } else if (t === 'mille') {
      total += (current === 0 ? 1 : current) * 1000
      current = 0
      sawAny = true
    } else if (t === 'et') {
      // "vingt et un", purely connective, carries no value.
    } else {
      return undefined
    }
    i++
  }

  return sawAny ? total + current : undefined
}

/**
 * Parse a full French number expression, including decimals and halves.
 *
 * Handles: "38,5" | "38.5" | "trente-huit virgule cinq" | "trente-huit et demi"
 *
 * The decimal part is assembled as a *string* rather than divided, because
 * "virgule vingt-cinq" means .25, not .0025.
 */
export function parseFrenchNumber(input: string): number | undefined {
  const text = stripAccents(input).toLowerCase().trim()
  if (!text) return undefined

  // Plain digits, with either decimal separator.
  const digits = text.match(/^-?\d+(?:[.,]\d+)?$/)
  if (digits) return Number.parseFloat(text.replace(',', '.'))

  // "trente-huit et demi" -> 38.5
  const halfMatch = text.match(/^(.*?)\s+et\s+demi[e]?$/)
  if (halfMatch) {
    const whole = parseFrenchNumber(halfMatch[1]!)
    return whole === undefined ? undefined : whole + 0.5
  }

  const [wholePart, ...rest] = text.split(/\s+virgule\s+|\s*,\s*/)
  const tokenise = (s: string) => s.split(/[\s-]+/).filter(Boolean)

  const whole = /^\d+$/.test(wholePart!.trim())
    ? Number.parseInt(wholePart!.trim(), 10)
    : parseWordSequence(tokenise(wholePart!))
  if (whole === undefined) return undefined
  if (rest.length === 0) return whole

  const fractionRaw = rest.join(' ').trim()
  const fraction = /^\d+$/.test(fractionRaw) ? Number.parseInt(fractionRaw, 10) : parseWordSequence(tokenise(fractionRaw))
  if (fraction === undefined) return whole

  return Number.parseFloat(`${whole}.${fraction}`)
}

/**
 * Regex fragment matching either digits or a run of French number words.
 * Exported so the clinical extractor can compose it into larger patterns.
 *
 * Sorted longest-first because alternation is first-match-wins: listing `un`
 * before `une` would match only the "un" of "une" and strand the rest.
 */
const ALT = [...NUMBER_WORDS].sort((a, b) => b.length - a.length).join('|')

/**
 * The trailing `\b` is load-bearing, not decoration.
 *
 * `cent` is a number word and `centimetres` begins with it, so without a
 * boundary the run matches "quatre-vingt-quinze cent" out of
 * "quatre-vingt-quinze centimetres" and parses as 95 x 100 = 9500. That is
 * exactly the height case: the value then fails the plausibility check and the
 * measurement is silently dropped. Found by the eval harness, which is the only
 * reason anyone noticed, since the failure mode is a missing field rather than
 * a visibly wrong one.
 *
 * With the boundary, the greedy match backtracks off `cent` and settles on
 * "quatre-vingt-quinze", which is the intended reading.
 */
export const NUMBER_PATTERN = `(?:\\d+(?:[.,]\\d+)?|(?:${ALT})(?:[\\s-]+(?:${ALT}))*)\\b`

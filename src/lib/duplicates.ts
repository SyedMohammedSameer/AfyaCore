/**
 * Catching the same patient being registered twice.
 *
 * ## Why this is the defining data problem of a paper register
 *
 * A health post register accumulates the same person under three spellings,
 * two ages and a transposed name, because each entry is made by a different
 * person under time pressure from a name they heard rather than read. Once it
 * has happened the damage compounds: the consultation history splits, the
 * clinician sees a first visit for someone on their third course of treatment,
 * and the monthly return counts one patient as three.
 *
 * Digitising the register without addressing this simply produces the same
 * mess faster. The moment to catch it is the only moment when someone who
 * knows the patient is standing there: registration.
 *
 * ## What it is careful about
 *
 * Two mistakes are possible and they are not symmetrical.
 *
 * A **false negative** creates a duplicate, which is recoverable: the merge
 * flow exists, and the records can be joined later by anyone who notices.
 *
 * A **false positive** tells a clinician that the person in front of them is
 * somebody else. If it is believed, the wrong record gets a consultation
 * appended to it, which is a clinical safety event; if it is not believed, it
 * trains everyone to dismiss the warning, which destroys the feature. So this
 * suggests and never blocks, always shows *why* it matched, and requires more
 * than a common name before it says anything at all.
 *
 * Names in this setting are genuinely repetitive — RAKOTO- prefixes an
 * enormous share of Malagasy family names — so a name alone is deliberately
 * not enough to raise a `likely` match.
 */
import type { Patient, Sex } from '../db/schema'
import { normalise } from '../db/repo'

/** How much the two records agree, and on what. */
export interface DuplicateMatch {
  patient: Patient
  /** 0 to 1. Only ever compared against the thresholds below. */
  score: number
  confidence: 'likely' | 'possible'
  /** Human-readable, in the order they should be shown. Each is a fact. */
  reasons: DuplicateReason[]
}

export type DuplicateReason =
  | 'same-register-no'
  | 'same-phone'
  | 'same-name'
  | 'similar-name'
  | 'swapped-name'
  | 'same-age'
  | 'same-village'

/** What the registration form has so far. Every field may be missing. */
export interface Candidate {
  givenName?: string
  familyName?: string
  sex?: Sex
  phone?: string
  registerNo?: string
  address?: string
  approximateAge?: number
  birthDate?: string
}

const LIKELY = 0.72
const POSSIBLE = 0.45

/**
 * Years of age difference beyond which two records cannot be one person.
 *
 * Generous on purpose. `approximateAge` exists because most patients do not
 * know their birth date, and an estimate taken by eye is routinely out by
 * five years for an adult. Twelve is past anything an estimate explains.
 */
const AGE_GAP_VETO = 12

/**
 * Levenshtein distance, iterative and bounded to two rows.
 *
 * Written out rather than pulled in: this runs over every patient in the
 * register on each keystroke-settled change, on a phone, and a dependency for
 * forty lines of arithmetic is not a trade worth making in a 139 kB bundle.
 */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0
  if (a.length === 0) return b.length
  if (b.length === 0) return a.length

  let previous = Array.from({ length: b.length + 1 }, (_, i) => i)
  let current = new Array<number>(b.length + 1)

  for (let i = 1; i <= a.length; i++) {
    current[0] = i
    for (let j = 1; j <= b.length; j++) {
      const substitution = previous[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1)
      current[j] = Math.min(current[j - 1]! + 1, previous[j]! + 1, substitution)
    }
    ;[previous, current] = [current, previous]
  }
  return previous[b.length]!
}

/** 1 for identical, 0 for nothing in common. */
export function nameSimilarity(a: string, b: string): number {
  const x = normalise(a)
  const y = normalise(b)
  if (!x || !y) return 0
  if (x === y) return 1
  const longest = Math.max(x.length, y.length)
  return Math.max(0, 1 - editDistance(x, y) / longest)
}

/**
 * Digits only, and only the last eight of them.
 *
 * The same phone is written `034 12 345 67`, `+261 34 12 345 67` and
 * `0341234567` by three different people. Comparing the tail skips the country
 * code and the trunk zero without needing to know either country's rules,
 * which matters because this app ships nine of them.
 */
function phoneKey(phone: string | undefined): string {
  if (!phone) return ''
  const digits = phone.replace(/\D/g, '')
  return digits.length >= 8 ? digits.slice(-8) : ''
}

/** Age in years from whichever of the two fields the record actually has. */
export function ageOf(p: Pick<Patient, 'birthDate' | 'approximateAge'>, now = Date.now()): number | undefined {
  if (p.birthDate) {
    const born = new Date(p.birthDate).getTime()
    if (Number.isFinite(born)) return Math.floor((now - born) / (365.2425 * 24 * 3600 * 1000))
  }
  return p.approximateAge
}

/**
 * Score one existing patient against what is being typed.
 *
 * Exported so the thresholds can be reasoned about in isolation; `findDuplicates`
 * is what the form calls.
 */
export function scoreAgainst(
  candidate: Candidate,
  existing: Patient,
  now = Date.now(),
): { score: number; reasons: DuplicateReason[] } {
  const reasons: DuplicateReason[] = []
  let score = 0

  // A register number is assigned by the facility and is meant to be unique,
  // so a collision is nearly always the same person or a clerical error worth
  // surfacing either way.
  if (candidate.registerNo && existing.registerNo) {
    if (normalise(candidate.registerNo) === normalise(existing.registerNo)) {
      score += 0.75
      reasons.push('same-register-no')
    }
  }

  const phone = phoneKey(candidate.phone)
  if (phone && phone === phoneKey(existing.phone)) {
    // Households share a phone, so this is strong but not conclusive on its
    // own. A mother and her child legitimately have the same number.
    score += 0.4
    reasons.push('same-phone')
  }

  const given = nameSimilarity(candidate.givenName ?? '', existing.givenName)
  const family = nameSimilarity(candidate.familyName ?? '', existing.familyName)
  const straight = (given + family) / 2

  // Given and family name swapped between the two columns is the single most
  // common register error, because the form's column order is not the order
  // the name is spoken in.
  const swapped =
    (nameSimilarity(candidate.givenName ?? '', existing.familyName) +
      nameSimilarity(candidate.familyName ?? '', existing.givenName)) /
    2

  const name = Math.max(straight, swapped)
  if (candidate.givenName && candidate.familyName) {
    if (name >= 0.999) {
      score += 0.55
      reasons.push(swapped > straight ? 'swapped-name' : 'same-name')
    } else if (name >= 0.82) {
      // Two or three characters different across a full name: a spelling
      // taken down by ear.
      score += 0.32
      reasons.push(swapped > straight ? 'swapped-name' : 'similar-name')
    }
  }

  const candidateAge = ageOf(candidate, now)
  const existingAge = ageOf(existing, now)
  if (candidateAge !== undefined && existingAge !== undefined) {
    const gap = Math.abs(candidateAge - existingAge)
    if (gap <= 1) {
      // Ages here are frequently estimated, so a year apart is agreement.
      score += 0.2
      reasons.push('same-age')
    } else if (gap > AGE_GAP_VETO) {
      /*
       * Categorical, not a penalty.
       *
       * An estimated age can be wrong by several years. It cannot be wrong by
       * twelve. Beyond that the two records are different people whatever else
       * they share, and everything else they share is exactly what a family
       * does: a grandmother and her granddaughter carry the same name, live at
       * the same address and answer the same phone. Scored rather than vetoed,
       * that trio outweighed the contradiction and the app accused a
       * four-year-old of being her grandmother.
       */
      return { score: 0, reasons: [] }
    } else if (gap > 2) {
      // Enough to doubt, not enough to rule out.
      score -= 0.3
    }
  }

  if (candidate.address && existing.address) {
    if (normalise(candidate.address) === normalise(existing.address)) {
      score += 0.15
      reasons.push('same-village')
    }
  }

  // Sex never adds confidence — half the register agrees with any given
  // patient — but disagreeing is a strong signal these are different people.
  if (candidate.sex && existing.sex && candidate.sex !== existing.sex) {
    score -= 0.4
  }

  return { score: Math.max(0, Math.min(1, score)), reasons }
}

export interface FindOptions {
  now?: number
  /** Cap on what is shown. More than a handful is noise, not help. */
  limit?: number
}

/**
 * Existing patients who might be the person being registered.
 *
 * Sorted strongest first. Returns nothing at all until the form holds enough
 * to be meaningful: a lone given name matches half a register, and a warning
 * that appears on every registration is one nobody reads by the second day.
 */
export function findDuplicates(
  candidate: Candidate,
  patients: Patient[],
  options: FindOptions = {},
): DuplicateMatch[] {
  const now = options.now ?? Date.now()
  /*
   * An early exit, not a safety check.
   *
   * Mutation testing removed this and nothing failed, which is the truth: the
   * thresholds already make it unreachable. Age and village together are the
   * most a nameless, unidentified candidate can score, and 0.35 is below
   * `POSSIBLE`, so no such candidate could ever be reported.
   *
   * It stays because it is a cheap way to avoid walking the whole register on
   * every keystroke while the form is still nearly empty, which is most of the
   * time somebody is typing into it. Kept for what it does, described as what
   * it is.
   */
  const hasName = Boolean(candidate.givenName?.trim() && candidate.familyName?.trim())
  const hasIdentifier = Boolean(phoneKey(candidate.phone) || candidate.registerNo?.trim())
  if (!hasName && !hasIdentifier) return []

  const matches: DuplicateMatch[] = []
  for (const existing of patients) {
    const { score, reasons } = scoreAgainst(candidate, existing, now)
    // Both halves are deliberate even though the second subsumes the first
    // today: every positive contribution pushes a reason, so a score above
    // zero always has one. The explicit check states the invariant the UI
    // depends on — a match is never shown without saying why — rather than
    // leaving it as an accident of the weights.
    if (reasons.length === 0 || score < POSSIBLE) continue
    matches.push({
      patient: existing,
      score,
      confidence: score >= LIKELY ? 'likely' : 'possible',
      reasons,
    })
  }

  return matches
    .sort((a, b) => b.score - a.score || a.patient.familyName.localeCompare(b.patient.familyName))
    .slice(0, options.limit ?? 5)
}

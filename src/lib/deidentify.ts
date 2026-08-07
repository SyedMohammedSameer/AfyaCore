/**
 * De-identification for exports.
 *
 * Records leaving the device currently carry names, phone numbers and villages.
 * For monthly reporting, research, or handing a dataset to a partner, none of
 * that is needed, the clinical content is. This module strips identifiers
 * before an export is produced.
 *
 * Why this is deterministic rather than model-driven: we hold the patient
 * roster, so the dominant leak, a patient's own name appearing in a free-text
 * note, can be removed by exact matching against names we already know. That
 * is 100% recall on the common case, at zero megabytes, verifiable in a unit
 * test. A neural PII model (see docs/MODEL-RESEARCH.md §4b) only adds value for
 * names we do *not* hold, such as a relative mentioned in passing, and it slots
 * in behind `scrubFreeText` as an optional extra pass rather than replacing any
 * of this.
 *
 * The design principle throughout: redaction is subtractive and auditable. When
 * a rule is unsure, it removes rather than keeps.
 */
import type { Encounter, Patient } from '../db/schema'
import { patientAge } from '../db/repo'

export type DeidentLevel =
  /** No change. Identifiers included. */
  | 'identified'
  /** Identifiers removed; a stable code lets the same patient be recognised across exports. */
  | 'pseudonymous'
  /** Identifiers removed and linkage broken; nothing ties two exports together. */
  | 'anonymous'

export interface DeidentOptions {
  level: DeidentLevel
  /**
   * Secret used to derive pseudonyms. The same salt yields the same codes, so a
   * facility can link exports over time; a different salt makes that impossible.
   * `anonymous` ignores this and uses fresh randomness.
   */
  salt?: string
  /** Reduce encounter dates to the first of the month. */
  generaliseDates?: boolean
}

export interface DeidentResult {
  patients: Patient[]
  encounters: Encounter[]
  /** What was applied, recorded alongside the export so the recipient knows. */
  manifest: {
    level: DeidentLevel
    generalisedDates: boolean
    patientsProcessed: number
    encountersProcessed: number
    fieldsRemoved: string[]
    freeTextRedactions: number
  }
}

/** SHA-256 → short uppercase code. Available in browsers and Node 18+. */
async function derivePseudonym(id: string, salt: string): Promise<string> {
  const data = new TextEncoder().encode(`${salt}:${id}`)
  const digest = await crypto.subtle.digest('SHA-256', data)
  const bytes = new Uint8Array(digest)
  let out = ''
  // Base32-ish alphabet without vowels or look-alikes, so a code can be read
  // aloud over a phone without ambiguity.
  const ALPHABET = '0123456789BCDFGHJKLMNPQRSTVWXZ'
  for (let i = 0; i < 8; i++) out += ALPHABET[bytes[i]! % ALPHABET.length]
  return out
}

function randomSalt(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Ages above 89 are re-identifying on their own in a small population, which is
 * why HIPAA Safe Harbor caps them. The same logic applies with more force in a
 * rural commune of a few thousand people.
 */
export function bandAge(age: number | undefined): number | undefined {
  if (age === undefined) return undefined
  return age >= 90 ? 90 : age
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Strip diacritics for matching, preserving length so nothing shifts. */
function fold(s: string): string {
  return s
    .replace(/[àáâãäå]/gi, 'a')
    .replace(/[èéêë]/gi, 'e')
    .replace(/[ìíîï]/gi, 'i')
    .replace(/[òóôõö]/gi, 'o')
    .replace(/[ùúûü]/gi, 'u')
    .replace(/[ç]/gi, 'c')
    .toLowerCase()
}

export const REDACTED = '[…]'

/**
 * Remove identifiers from free text.
 *
 * `terms` must cover every identifier on the roster, not just the current
 * patient's: a note routinely mentions another patient ("frère de RAKOTO"), and
 * a scrub limited to one record would miss it.
 *
 * Villages belong in this list as firmly as names do. Removing the `address`
 * field but leaving "village Ambohimanga" in a note removes nothing, a
 * fokontany of a few hundred people, plus an age and a sex, identifies someone.
 * (HIPAA Safe Harbor removes geography below state level for the same reason.)
 * Register numbers likewise: too short for the long-digit rule to catch, and a
 * direct key back into the paper file.
 *
 * Short tokens are skipped: a three-letter name would match half the French in
 * the note and redact the clinical content along with the identifier.
 */
export function scrubFreeText(text: string, terms: string[]): { text: string; redactions: number } {
  if (!text) return { text, redactions: 0 }
  let out = text
  let redactions = 0

  const replace = (pattern: RegExp) => {
    out = out.replace(pattern, () => {
      redactions++
      return REDACTED
    })
  }

  // Longest names first, so "RAKOTOARISOA" is not half-consumed by "RAKOTO".
  const tokens = [...new Set(terms.flatMap((n) => n.split(/[\s,]+/)))]
    .map((n) => n.trim())
    .filter((n) => n.length >= 4)
    .sort((a, b) => b.length - a.length)

  for (const token of tokens) {
    // Match accent- and case-insensitively by testing the folded form, but
    // splice out of the original so surrounding text keeps its accents.
    const folded = fold(token)
    const re = new RegExp(`\\b${escapeRegExp(folded)}\\b`, 'g')
    let match: RegExpExecArray | null
    const foldedOut = fold(out)
    const spans: [number, number][] = []
    while ((match = re.exec(foldedOut)) !== null) {
      spans.push([match.index, match.index + match[0].length])
    }
    for (const [start, end] of spans.reverse()) {
      out = out.slice(0, start) + REDACTED + out.slice(end)
      redactions++
    }
  }

  // Phone numbers: Malagasy mobiles are 10 digits, commonly written in groups.
  replace(/\b(?:\+?261[\s.-]?)?0?\d{2}[\s.-]?\d{2}[\s.-]?\d{3}[\s.-]?\d{2}\b/g)
  // Any other long digit run, register numbers, national ID fragments.
  replace(/\b\d{7,}\b/g)

  return { text: out, redactions }
}

/**
 * Produce a de-identified copy of the dataset.
 *
 * Returns new objects; the local database is never modified. Draft encounters
 * are the caller's concern, the exporters already exclude them.
 */
export async function deidentify(
  patients: Patient[],
  encounters: Encounter[],
  options: DeidentOptions,
): Promise<DeidentResult> {
  const { level } = options

  if (level === 'identified') {
    return {
      patients,
      encounters,
      manifest: {
        level,
        generalisedDates: false,
        patientsProcessed: patients.length,
        encountersProcessed: encounters.length,
        fieldsRemoved: [],
        freeTextRedactions: 0,
      },
    }
  }

  // `anonymous` burns a fresh salt so two exports cannot be joined on the code.
  const salt = level === 'anonymous' ? randomSalt() : (options.salt ?? randomSalt())
  const generaliseDates = options.generaliseDates ?? level === 'anonymous'

  const idMap = new Map<string, string>()
  for (const p of patients) idMap.set(p.id, await derivePseudonym(p.id, salt))

  // Every identifier held anywhere on the roster, names, villages and register
  // numbers, scrubbed from every record's free text.
  const allTerms = patients.flatMap((p) =>
    [p.familyName, p.givenName, p.address, p.registerNo].filter((v): v is string => Boolean(v)),
  )

  let freeTextRedactions = 0
  const scrub = (value: string | undefined): string | undefined => {
    if (!value) return value
    const { text, redactions } = scrubFreeText(value, allTerms)
    freeTextRedactions += redactions
    return text
  }

  const outPatients: Patient[] = patients.map((p) => {
    const code = idMap.get(p.id)!
    const age = bandAge(patientAge(p))
    return {
      ...p,
      id: code,
      familyName: code,
      givenName: '',
      // A birth date is a direct identifier; the age band carries the clinical
      // signal that actually matters.
      birthDate: undefined,
      birthDatePrecision: undefined,
      approximateAge: age,
      phone: undefined,
      address: undefined,
      registerNo: undefined,
      searchKey: code.toLowerCase(),
      syncedAt: undefined,
    }
  })

  const outEncounters: Encounter[] = encounters.map((e) => {
    const occurredAt = generaliseDates
      ? new Date(new Date(e.occurredAt).getFullYear(), new Date(e.occurredAt).getMonth(), 1).getTime()
      : e.occurredAt

    return {
      ...e,
      // An encounter for an unknown patient keeps a placeholder rather than the
      // real id, so an orphan row can never leak a link back to the roster.
      patientId: idMap.get(e.patientId) ?? 'UNKNOWN',
      occurredAt,
      chiefComplaint: scrub(e.chiefComplaint),
      diagnosis: scrub(e.diagnosis),
      notes: scrub(e.notes),
      // Provenance holds the raw dictation and OCR text verbatim, the single
      // richest source of stray identifiers in the whole record.
      provenance: Object.fromEntries(
        Object.entries(e.provenance).map(([k, v]) => [k, { ...v, rawText: scrub(v.rawText) }]),
      ),
      // Photographs of paper records are unredactable by any means we have.
      attachmentIds: [],
      syncedAt: undefined,
    }
  })

  return {
    patients: outPatients,
    encounters: outEncounters,
    manifest: {
      level,
      generalisedDates: generaliseDates,
      patientsProcessed: outPatients.length,
      encountersProcessed: outEncounters.length,
      fieldsRemoved: [
        'givenName',
        'familyName',
        'birthDate',
        'phone',
        'address',
        'registerNo',
        'attachments',
      ],
      freeTextRedactions,
    },
  }
}

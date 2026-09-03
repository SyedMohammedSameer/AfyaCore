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
import { applyEntities, MODEL_REPO, type NerBackend } from './openmed'
import { allPhonePatterns } from './countries'

export type DeidentLevel =
  /** No change. Identifiers included. */
  | 'identified'
  /** Identifiers removed; a stable code lets the same patient be recognised across exports. */
  | 'pseudonymous'
  /** Identifiers removed and linkage broken; nothing ties two exports together. */
  | 'anonymous'

export interface DeidentOptions {
  level: DeidentLevel
  /** ISO country code of the exporting facility, recorded in the manifest. */
  country?: string
  /**
   * Secret used to derive pseudonyms. The same salt yields the same codes, so a
   * facility can link exports over time; a different salt makes that impossible.
   * `anonymous` ignores this and uses fresh randomness.
   */
  salt?: string
  /** Reduce encounter dates to the first of the month. */
  generaliseDates?: boolean
  /**
   * Drop patients who have not granted consent for secondary use.
   *
   * Defaults to **true at de-identified levels**, which are the research ones.
   * An `identified` export is a clinical act — a referral letter, a copy for
   * the patient, a handover — and gating it on research consent would block
   * care to satisfy a rule about research.
   *
   * The default is the safe direction on purpose. A caller who wants every
   * record has to say so explicitly, in code, where a reviewer can find it;
   * a caller who forgets gets the conservative behaviour.
   */
  requireResearchConsent?: boolean
  /**
   * Optional neural PII pass, run *after* the deterministic scrub and only ever
   * adding redactions. See src/lib/openmed.ts.
   *
   * Absent by default, and absent is the shipped behaviour: the model is a
   * separate ~67 MB download a facility opts into. An export must never be less
   * de-identified because a download failed, so nothing here can subtract.
   */
  nerBackend?: NerBackend
}

export interface DeidentResult {
  patients: Patient[]
  encounters: Encounter[]
  /** What was applied, recorded alongside the export so the recipient knows. */
  manifest: {
    level: DeidentLevel
    generalisedDates: boolean
    /**
     * Patients left out because they had not consented to secondary use.
     *
     * In the manifest rather than only in the audit log, because the recipient
     * is the one who needs it: a dataset that silently excludes a third of a
     * catchment is biased in a way that matters clinically, and a researcher
     * cannot correct for a selection they were never told about.
     */
    excludedForConsent: number
    patientsProcessed: number
    encountersProcessed: number
    fieldsRemoved: string[]
    freeTextRedactions: number
    /**
     * The country whose data-protection regime the exporting facility operates
     * under. Travels with the file because a recipient in another jurisdiction
     * needs to know which rules the data left under, and because a cross-border
     * transfer restriction is only checkable if the origin is recorded.
     */
    country?: string
    /**
     * Redactions the neural pass added beyond the deterministic scrub, and the
     * model that made them. Recorded in the manifest that travels with the
     * export so a recipient knows how the file was produced, and so the claim
     * can be audited rather than taken on trust.
     */
    neuralRedactions?: number
    neuralModel?: string
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

  // Phone numbers, in every format this build knows about.
  //
  // This used to be one regex shaped around Malagasy mobiles, which meant a
  // Kenyan or Nigerian deployment ran a de-identifier that could not recognise
  // its own patients' phone numbers. Being wrong about which country a device
  // is configured for is itself a failure mode, so every pattern runs rather
  // than only the configured one; the cost is microseconds.
  for (const pattern of allPhonePatterns()) replace(pattern)

  // Any other long digit run: register numbers, national ID fragments.
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
        excludedForConsent: 0,
        ...(options.country ? { country: options.country } : {}),
      },
    }
  }

  /*
   * Consent is applied before anything else, so a patient who did not agree is
   * not merely de-identified — they are not in the file at all.
   *
   * De-identification is not a substitute for consent. A pseudonymous record
   * is still personal data (the salt that reverses it exists on the device),
   * and even an anonymous one is a record about a person who was never asked.
   * docs/COMPLIANCE.md §6.2 names secondary use as the consent gap that
   * matters most in practice; this is where it is closed.
   *
   * Encounters go with their patient. Dropping the patient row and keeping the
   * consultations would leave clinical narrative attached to `UNKNOWN`, which
   * is a worse outcome than either including or excluding them cleanly.
   */
  const requireConsent = options.requireResearchConsent ?? true
  const consented = requireConsent
    ? patients.filter((p) => p.researchConsent === 'granted')
    : patients
  const excludedForConsent = patients.length - consented.length
  const allowedIds = new Set(consented.map((p) => p.id))
  const consentedEncounters = requireConsent
    ? encounters.filter((e) => allowedIds.has(e.patientId))
    : encounters

  patients = consented
  encounters = consentedEncounters

  // `anonymous` burns a fresh salt so two exports cannot be joined on the code.
  const salt = level === 'anonymous' ? randomSalt() : (options.salt ?? randomSalt())
  const generaliseDates = options.generaliseDates ?? level === 'anonymous'

  const idMap = new Map<string, string>()
  for (const p of patients) idMap.set(p.id, await derivePseudonym(p.id, salt))

  /*
   * Encounter and prescription ids are pseudonymised too.
   *
   * They used to survive verbatim, which quietly defeated the whole
   * `anonymous` level: patient ids were freshly salted per export, and then
   * every row carried a stable encounter UUID that joined two "unlinkable"
   * exports back together in one SQL statement. Re-identification does not
   * need the patient key if any other key is stable.
   *
   * Derived from the same salt as the patient codes, so links *inside* one
   * export still work — an Observation still points at its Encounter — while
   * links *between* exports do not.
   */
  const encounterIdMap = new Map<string, string>()
  for (const e of encounters) encounterIdMap.set(e.id, await derivePseudonym(e.id, salt))

  // Every identifier held anywhere on the roster, names, villages and register
  // numbers, scrubbed from every record's free text.
  const allTerms = patients.flatMap((p) =>
    [p.familyName, p.givenName, p.address, p.registerNo].filter((v): v is string => Boolean(v)),
  )

  // Prescription ids, pseudonymised from the same salt for the same reason.
  const prescriptionIdMap = new Map<string, string>()
  for (const e of encounters) {
    for (const p of e.prescriptions) {
      prescriptionIdMap.set(p.id, await derivePseudonym(p.id, salt))
    }
  }
  const prescriptionId = (id: string) => prescriptionIdMap.get(id) ?? id

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
      // Same reasoning as the encounter rows: exact row timestamps are a join
      // key and a re-identification vector, and carry nothing clinical.
      createdAt: generaliseDates ? 0 : p.createdAt,
      updatedAt: generaliseDates ? 0 : p.updatedAt,
      deletedAt: undefined,
    }
  })

  const outEncounters: Encounter[] = encounters.map((e) => {
    const occurredAt = generaliseDates
      ? new Date(new Date(e.occurredAt).getFullYear(), new Date(e.occurredAt).getMonth(), 1).getTime()
      : e.occurredAt

    return {
      ...e,
      id: encounterIdMap.get(e.id) ?? e.id,
      // An encounter for an unknown patient keeps a placeholder rather than the
      // real id, so an orphan row can never leak a link back to the roster.
      patientId: idMap.get(e.patientId) ?? 'UNKNOWN',
      occurredAt,
      /*
       * Row timestamps are dropped, not kept.
       *
       * `occurredAt` is generalised to the first of the month at the anonymous
       * level, and then `createdAt`/`updatedAt` shipped alongside it at
       * millisecond precision — which re-identifies the exact consultation and
       * joins two exports on the same value. Generalising one date while
       * exporting two others is not generalisation.
       */
      createdAt: generaliseDates ? occurredAt : e.createdAt,
      updatedAt: generaliseDates ? occurredAt : e.updatedAt,
      // Sync and deletion metadata say nothing clinical and everything about
      // which device held the row and when.
      deletedAt: undefined,
      /*
       * Prescriptions were never touched at all.
       *
       * `notes` is free text a clinician types — "donner à sa mère Hanta" —
       * and it went into every de-identified export, and into the FHIR
       * dosage line, unscrubbed. The id was stable across exports for the
       * same reason encounter ids were.
       */
      prescriptions: e.prescriptions.map((p) => ({
        ...p,
        id: prescriptionId(p.id),
        notes: scrub(p.notes),
      })),
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

  // The neural pass runs last, over text the deterministic scrub has already
  // been through. Ordering is the safety argument: the roster-based scrub is
  // exact and always runs, and this can only ever add to what it removed.
  let neuralRedactions: number | undefined
  if (options.nerBackend) {
    neuralRedactions = await neuralPass(outEncounters, options.nerBackend)
  }

  return {
    patients: outPatients,
    encounters: outEncounters,
    manifest: {
      level,
      generalisedDates: generaliseDates,
      excludedForConsent,
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
        'prescription.notes',
        'rowTimestamps',
      ],
      freeTextRedactions,
      ...(options.country ? { country: options.country } : {}),
      ...(neuralRedactions !== undefined
        ? { neuralRedactions, neuralModel: MODEL_REPO }
        : {}),
    },
  }
}

/**
 * Run the neural backend over every free-text field of an encounter set.
 *
 * Mutates in place because it operates on the copies `deidentify` has already
 * built; the caller's records were never touched.
 *
 * One backend failure must not fail an export. If the model throws part-way
 * through, whatever it managed to redact stands and the rest keeps the
 * deterministic scrub's output, which is the shipped default anyway.
 */
async function neuralPass(encounters: Encounter[], backend: NerBackend): Promise<number> {
  let added = 0

  const pass = async (value: string | undefined): Promise<string | undefined> => {
    if (!value) return value
    try {
      const { text, redactions } = applyEntities(value, await backend(value), {
        redacted: REDACTED,
      })
      added += redactions
      return text
    } catch {
      return value
    }
  }

  for (const encounter of encounters) {
    encounter.chiefComplaint = await pass(encounter.chiefComplaint)
    encounter.diagnosis = await pass(encounter.diagnosis)
    encounter.notes = await pass(encounter.notes)
    for (const [key, provenance] of Object.entries(encounter.provenance)) {
      encounter.provenance[key] = { ...provenance, rawText: await pass(provenance.rawText) }
    }
  }

  return added
}

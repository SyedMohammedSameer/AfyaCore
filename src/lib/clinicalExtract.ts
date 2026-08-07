/**
 * Deterministic extraction of structured clinical data from dictation.
 *
 * Why rules and not a model: a 20% word error rate on free prose is unusable,
 * but a 20% error rate against a *constrained* target (eight vital signs, a
 * bounded formulary, a handful of frequency idioms) is very usable, because the
 * output is a small set of fields a clinician confirms in two seconds. This runs
 * offline, in microseconds, in zero megabytes, and it fails predictably.
 *
 * Everything language-specific lives in clinicalLocales.ts. This file is the
 * engine: it knows how to find a trigger, read a number after it, scope a
 * prescription and reject an implausible reading, in any language whose
 * conventions a pack describes.
 *
 * Nothing here is diagnostic. It transcribes what was said into fields; it does
 * not infer, suggest, or decide anything clinical.
 */
import { VITAL_RANGES, type VitalKey } from '../db/schema'
import { FR_LOCALE, type ClinicalLocale } from './clinicalLocales'

export interface ExtractedField<T> {
  value: T
  /** The exact span of dictation this came from, for audit and correction. */
  rawText: string
  /** Strength of the *rule match*, not a model probability. 0 to 1. */
  confidence: number
}

export interface ExtractedPrescription {
  drug: string
  dose?: string
  frequencyPerDay?: number
  durationDays?: number
  rawText: string
  confidence: number
}

export interface ExtractionResult {
  vitals: Partial<Record<VitalKey, ExtractedField<number>>>
  prescriptions: ExtractedPrescription[]
  chiefComplaint?: ExtractedField<string>
  diagnosis?: ExtractedField<string>
  /** Everything no rule claimed. Becomes the free-text clinical note. */
  remainder: string
}

/**
 * Accent folding that preserves string length, so match indices computed on the
 * folded text still slice correctly out of the original.
 */
const FOLD_PAIRS: [RegExp, string][] = [
  [/[àáâãäå]/g, 'a'], [/[èéêë]/g, 'e'], [/[ìíîï]/g, 'i'],
  [/[òóôõö]/g, 'o'], [/[ùúûü]/g, 'u'], [/[ç]/g, 'c'],
  [/[ñ]/g, 'n'], [/[ÿý]/g, 'y'], [/[œ]/g, 'e'], [/[æ]/g, 'a'],
]

function fold(s: string): string {
  let out = s.toLowerCase()
  for (const [re, to] of FOLD_PAIRS) out = out.replace(re, to)
  return out
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

interface Claim {
  start: number
  end: number
}

/** Try each candidate number match until one actually parses. */
function firstParsableNumber(
  folded: string,
  original: string,
  pattern: RegExp,
  parse: (s: string) => number | undefined,
): { value: number; rawText: string; claim: Claim; fromDigits: boolean } | undefined {
  pattern.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = pattern.exec(folded)) !== null) {
    const numStr = m[1]
    if (numStr === undefined) continue
    const value = parse(numStr)
    if (value === undefined) continue
    return {
      value,
      rawText: original.slice(m.index, m.index + m[0].length).trim(),
      claim: { start: m.index, end: m.index + m[0].length },
      fromDigits: /^\d/.test(numStr.trim()),
    }
  }
  return undefined
}

function plausible(key: VitalKey, value: number): boolean {
  const r = VITAL_RANGES[key]
  return value >= r.min && value <= r.max
}

export function extractClinical(text: string, locale: ClinicalLocale = FR_LOCALE): ExtractionResult {
  const original = text
  const folded = fold(text)
  const claims: Claim[] = []
  const vitals: Partial<Record<VitalKey, ExtractedField<number>>> = {}
  const N = locale.numberPattern

  // --- Blood pressure -------------------------------------------------------
  for (const trigger of locale.bpTriggers) {
    const re = new RegExp(`\\b${trigger}\\b[^\\d\\w]{0,12}(${N})\\s*(?:sur|over|/)\\s*(${N})`, 'g')
    const m = re.exec(folded)
    if (!m) continue
    let sys = locale.parseNumber(m[1]!)
    let dia = locale.parseNumber(m[2]!)
    if (sys === undefined || dia === undefined) continue

    // French clinicians dictate tension in cmHg ("douze sur huit" = 120/80), so
    // a systolic under 30 there is a unit convention, not a dying patient.
    const inCmHg = locale.bpMayBeCmHg && sys < 30
    if (inCmHg) {
      sys *= 10
      dia *= 10
    }
    if (!plausible('systolic', sys) || !plausible('diastolic', dia)) continue

    const rawText = original.slice(m.index, m.index + m[0].length).trim()
    // Unit inference is an assumption, so it is scored lower and shown to the
    // clinician as something to check.
    const confidence = inCmHg ? 0.8 : 0.9
    vitals.systolic = { value: sys, rawText, confidence }
    vitals.diastolic = { value: dia, rawText, confidence }
    claims.push({ start: m.index, end: m.index + m[0].length })
    break
  }

  // --- Scalar vitals --------------------------------------------------------
  for (const { key, triggers } of locale.vitalTriggers) {
    if (vitals[key]) continue
    for (const trigger of triggers) {
      const re = new RegExp(
        `\\b${escapeRegExp(trigger)}\\b[^\\d\\w]{0,12}(?:de\\s+|a\\s+|of\\s+|is\\s+)?(${N})`,
        'g',
      )
      const hit = firstParsableNumber(folded, original, re, locale.parseNumber)
      if (!hit || !plausible(key, hit.value)) continue
      vitals[key] = {
        value: hit.value,
        rawText: hit.rawText,
        confidence: hit.fromDigits ? 0.9 : 0.75,
      }
      claims.push(hit.claim)
      break
    }
  }

  // --- Prescriptions --------------------------------------------------------
  // Hyphens fold to spaces so "artemether-lumefantrine" and the spaced form are
  // one entry. The replacement is length-preserving, so indices stay aligned.
  const foldedDrugs = folded.replace(/-/g, ' ')

  const hits: { drug: string; start: number; end: number }[] = []
  for (const drug of locale.formulary) {
    const re = new RegExp(`\\b${escapeRegExp(drug)}\\b`, 'g')
    let m: RegExpExecArray | null
    while ((m = re.exec(foldedDrugs)) !== null) {
      hits.push({ drug, start: m.index, end: m.index + m[0].length })
    }
  }

  // Longest match wins at any given position, and no drug may sit inside
  // another, otherwise a fixed-dose combination decomposes into its components.
  hits.sort((a, b) => a.start - b.start || b.end - b.start - (a.end - a.start))
  const drugHits: typeof hits = []
  for (const h of hits) {
    if (drugHits.some((k) => h.start < k.end && h.end > k.start)) continue
    drugHits.push(h)
  }
  drugHits.sort((a, b) => a.start - b.start)

  const prescriptions: ExtractedPrescription[] = []
  drugHits.forEach((hit, i) => {
    // A prescription's modifiers run until the next drug, the end of the
    // sentence, or 90 characters, whichever comes first. Without the next-drug
    // bound, one drug's "morning and evening" is read as the previous drug's
    // frequency.
    const nextDrugStart = drugHits[i + 1]?.start ?? folded.length
    const hardEnd = Math.min(hit.end + 90, nextDrugStart, folded.length)
    const segment = folded.slice(hit.end, hardEnd)
    const stop = segment.search(/[.;]/)
    const scoped = stop === -1 ? segment : segment.slice(0, stop)

    const dose = locale.dose(scoped)
    const frequencyPerDay = locale.frequency(scoped)
    const durationDays = locale.duration(scoped)
    const claimEnd = hit.end + scoped.length

    prescriptions.push({
      drug: original.slice(hit.start, hit.end).trim(),
      dose,
      frequencyPerDay,
      durationDays,
      rawText: original.slice(hit.start, claimEnd).trim(),
      // An unqualified drug name is a weak signal; a full dose, frequency and
      // duration triple is a strong one.
      confidence: 0.5 + 0.5 * ([dose, frequencyPerDay, durationDays].filter((x) => x !== undefined).length / 3),
    })
    claims.push({ start: hit.start, end: claimEnd })
  })

  // --- Narrative fields -----------------------------------------------------
  /**
   * Where a free-text field must stop.
   *
   * Punctuation alone is not enough: speech recognisers routinely omit it, and
   * OCR loses it at line breaks. Without this, "Motif: fievre depuis trois jours
   * Temperature 38.9" captures the temperature as part of the complaint. So a
   * narrative also ends at the next thing that is recognisably a new section.
   */
  const boundaryWords = [
    ...locale.vitalTriggers.flatMap((v) => v.triggers),
    ...locale.bpTriggers,
    ...locale.diagnosisTriggers,
    ...locale.complaintTriggers,
    ...locale.sectionWords,
    ...locale.formulary,
  ].map(escapeRegExp)
  const boundaryRe = new RegExp(`\\b(?:${boundaryWords.join('|')})\\b`)

  function narrative(triggers: string[]): ExtractedField<string> | undefined {
    for (const trigger of triggers) {
      const re = new RegExp(`\\b${escapeRegExp(trigger)}\\b\\s*:?\\s*([^.;\\n]{2,160})`)
      const m = re.exec(folded)
      if (!m || m[1] === undefined) continue

      const start = m.index + m[0].length - m[1].length
      let length = m[1].length

      const boundary = boundaryRe.exec(folded.slice(start, start + length))
      if (boundary) length = boundary.index
      if (length < 2) continue

      const value = original.slice(start, start + length).trim()
      if (!value) continue

      const end = start + length
      claims.push({ start: m.index, end })
      return { value, rawText: original.slice(m.index, end).trim(), confidence: 0.8 }
    }
    return undefined
  }

  const diagnosis = narrative(locale.diagnosisTriggers)
  const chiefComplaint = narrative(locale.complaintTriggers)

  // --- Remainder ------------------------------------------------------------
  const sorted = [...claims].sort((a, b) => a.start - b.start)
  let cursor = 0
  const leftover: string[] = []
  for (const c of sorted) {
    if (c.start > cursor) leftover.push(original.slice(cursor, c.start))
    cursor = Math.max(cursor, c.end)
  }
  if (cursor < original.length) leftover.push(original.slice(cursor))

  // Removing claimed spans strands their punctuation behind, so the leftovers
  // need real cleanup before they can be shown as a clinical note.
  const remainder = leftover
    .map((s) => s.trim())
    .filter((s) => s.replace(/[\s.;,:/-]/g, '').length > 0)
    .join(' ')
    .replace(/\s*([.;,:])/g, '$1')
    .replace(/([.;,:])\s*(?=[.;,:])/g, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s.;,:-]+|[\s.;,:-]+$/g, '')
    .trim()

  return { vitals, prescriptions, chiefComplaint, diagnosis, remainder }
}

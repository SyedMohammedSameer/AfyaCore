import type { LangCode, Prescription, Vitals, VitalKey } from '../db/schema'
import { VITAL_RANGES } from '../db/schema'
import type { Strings } from '../i18n/strings'

/**
 * BCP-47 tag per interface language, for date and number formatting.
 *
 * Malagasy maps to `fr-FR` rather than `mg-MG` on purpose: no browser ships
 * Malagasy Intl data, so `mg-MG` silently falls through to the *device's*
 * locale, which on a phone bought anywhere means an English date under a
 * Malagasy interface. French is the language the facility's paperwork is
 * already in, so it is the coherent fallback rather than an accidental one.
 */
export const DATE_LOCALES: Record<LangCode, string> = { fr: 'fr-FR', mg: 'fr-FR', en: 'en-GB' }
const LOCALES = DATE_LOCALES

export function formatDate(ts: number, lang: LangCode): string {
  return new Date(ts).toLocaleDateString(LOCALES[lang], {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

export function formatDateTime(ts: number, lang: LangCode): string {
  return new Date(ts).toLocaleString(LOCALES[lang], {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function formatVital(key: VitalKey, value: number): string {
  const r = VITAL_RANGES[key]
  return `${value.toFixed(r.decimals)} ${r.unit}`
}

/** Vitals in the order a clinician reads them off, not alphabetically. */
export const VITAL_ORDER: VitalKey[] = [
  'temperature',
  'pulse',
  'systolic',
  'diastolic',
  'respiratoryRate',
  'oxygenSaturation',
  'weight',
  'height',
]

export function vitalLabel(key: VitalKey, t: Strings): string {
  switch (key) {
    case 'temperature': return t.temperature
    case 'pulse': return t.pulse
    // Not `${bloodPressure} (sys)`: that composes to "Blood pressure (sys)",
    // which does not fit a vitals tile in English even though the French
    // "Tension (sys)" did. Each half gets its own string per language.
    case 'systolic': return t.systolic
    case 'diastolic': return t.diastolic
    case 'respiratoryRate': return t.respiratoryRate
    case 'weight': return t.weight
    case 'height': return t.height
    case 'oxygenSaturation': return t.oxygenSaturation
  }
}

/**
 * Human label for a provenance key such as `vitals.systolic` or
 * `prescription.<uuid>`. The review screen shows these to a clinician, so it
 * must never leak an internal field path.
 */
export function provenanceLabel(key: string, t: Strings): string {
  if (key.startsWith('vitals.')) {
    const vital = key.slice('vitals.'.length) as VitalKey
    return VITAL_ORDER.includes(vital) ? vitalLabel(vital, t) : key
  }
  if (key.startsWith('prescription.')) return t.drug
  switch (key) {
    case 'chiefComplaint': return t.chiefComplaint
    case 'diagnosis': return t.diagnosis
    case 'notes': return t.notes
    default: return key
  }
}

/** Trim a quoted source phrase so one long dictation cannot flood the screen. */
export function truncate(text: string, max = 90): string {
  return text.length <= max ? text : `${text.slice(0, max).trimEnd()}…`
}

export function hasAnyVital(v: Vitals): boolean {
  return VITAL_ORDER.some((k) => v[k] !== undefined)
}

/**
 * Malagasy multiplicative numerals ("how many times").
 *
 * These are irregular and cannot be produced by concatenating a digit, "3
 * indray" is not Malagasy, "intelo" is. Dosage frequency is exactly the wrong
 * place to be approximately grammatical, so the common values are spelled out.
 *
 * ⚠️ Unreviewed by a native speaker, see i18n/strings.ts.
 */
const MALAGASY_TIMES: Record<number, string> = {
  1: 'indray mandeha',
  2: 'indroa',
  3: 'intelo',
  4: 'inefatra',
  5: 'indimy',
  6: 'inenina',
}

function malagasyTimes(n: number): string {
  return MALAGASY_TIMES[n] ?? `in-${n}`
}

/**
 * Render a prescription as an instruction a patient can act on.
 *
 * Deliberately produced from the structured fields rather than echoing the
 * clinician's dictation: the patient needs "1 comprimé, 3 fois par jour,
 * pendant 5 jours", not a transcript of a professional talking to themselves.
 *
 * ⚠️ The Malagasy wording here is an unreviewed draft, see i18n/strings.ts.
 */
export function prescriptionInstruction(p: Prescription, lang: LangCode): string {
  const parts: string[] = [p.drug]
  if (p.dose) parts.push(p.dose)

  if (lang === 'mg') {
    if (p.frequencyPerDay) parts.push(`${malagasyTimes(p.frequencyPerDay)} isan'andro`)
    if (p.durationDays) parts.push(`mandritra ny ${p.durationDays} andro`)
  } else if (lang === 'en') {
    if (p.frequencyPerDay) parts.push(`${p.frequencyPerDay} time${p.frequencyPerDay > 1 ? 's' : ''} per day`)
    if (p.durationDays) parts.push(`for ${p.durationDays} day${p.durationDays > 1 ? 's' : ''}`)
  } else {
    if (p.frequencyPerDay) parts.push(`${p.frequencyPerDay} fois par jour`)
    if (p.durationDays) parts.push(`pendant ${p.durationDays} jour${p.durationDays > 1 ? 's' : ''}`)
  }

  return parts.join(', ')
}

/** Total tablets/doses across the course, what to actually hand over. */
export function totalDoses(p: Prescription): number | undefined {
  if (!p.frequencyPerDay || !p.durationDays) return undefined
  return p.frequencyPerDay * p.durationDays
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} kB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

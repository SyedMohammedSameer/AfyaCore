import type { LangCode, Prescription, Vitals, VitalKey } from '../db/schema'
import { patientPack, type PatientLang } from '../i18n/patient'
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
 * Render a prescription as an instruction a patient can act on.
 *
 * Deliberately produced from the structured fields rather than echoing the
 * clinician's dictation: the patient needs "1 comprimé, 3 fois par jour,
 * pendant 5 jours", not a transcript of a professional talking to themselves.
 *
 * The wording comes from the patient pack rather than an if/else chain here,
 * which is what lets a tenth language be an object in one file instead of
 * another branch in a function nobody remembers to update.
 *
 * ⚠️ Only the French and English packs have been read by a speaker. See
 * src/i18n/patient.ts.
 */
export function prescriptionInstruction(p: Prescription, lang: PatientLang): string {
  const pack = patientPack(lang)
  const parts: string[] = [p.drug]
  if (p.dose) parts.push(p.dose)
  if (p.frequencyPerDay) parts.push(pack.timesPerDay(p.frequencyPerDay))
  if (p.durationDays) parts.push(pack.forDays(p.durationDays))
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

import type { LangCode, Patient, Prescription, Vitals, VitalKey } from '../db/schema'
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

/**
 * A date for a dense list, where the year is usually noise.
 *
 * The roster puts age, sex and last visit on one line, and the full date
 * pushed the longest of them past the edge: a patient row read "Last seen
 * 31 Aug 20…", truncating the one part a clinician might have needed. The
 * year is the least useful component of a recent visit and the first thing
 * to drop, so it is kept only when the visit was not this year — which is
 * exactly when it carries information.
 *
 * `now` is a parameter so this is testable without freezing the clock.
 */
export function formatDateCompact(ts: number, lang: LangCode, now = Date.now()): string {
  const date = new Date(ts)
  const sameYear = date.getFullYear() === new Date(now).getFullYear()
  return date.toLocaleDateString(LOCALES[lang], {
    day: '2-digit',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
  })
}

/**
 * A patient's age, in the unit that says something about them.
 *
 * Two problems with the `${years} ${t.years}` this replaces. It read "1 yrs",
 * because English pluralises and a template string does not. And for the
 * patients this app most needs to get right it was close to uninformative: an
 * under-two rounded to whole years is "1", which covers a child who can barely
 * sit up and one who is running, and every clinical threshold between them.
 *
 * So: months up to two years, then years. Months only when a real birth date is
 * known — an `approximateAge` of 1 is a guess in years and reporting it as "12
 * months" would invent a precision nobody gave.
 */
export function formatAge(
  patient: Pick<Patient, 'birthDate' | 'approximateAge'>,
  t: Strings,
  now = Date.now(),
): string | undefined {
  if (patient.birthDate) {
    const born = new Date(patient.birthDate).getTime()
    if (Number.isFinite(born) && born <= now) {
      const months = Math.floor((now - born) / (30.4369 * 86_400_000))
      if (months < 24) return `${months} ${months === 1 ? t.unitMonth : t.unitMonths}`
      const years = Math.floor((now - born) / 31_556_952_000)
      return `${years} ${years === 1 ? t.unitYear : t.unitYears}`
    }
  }
  const approx = patient.approximateAge
  if (approx === undefined) return undefined
  return `${approx} ${approx === 1 ? t.unitYear : t.unitYears}`
}

/** Whole years with the right ending, for the settings screens. */
export function formatYears(years: number, t: Strings): string {
  return `${years} ${years === 1 ? t.unitYear : t.unitYears}`
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

/**
 * Language packs for clinical dictation.
 *
 * The extractor was French-only, which quietly locked the app to francophone
 * countries. Everything language-specific now lives here so adding a locale is
 * a data exercise rather than a rewrite of the parser.
 *
 * A locale is not a translation. Clinical dictation differs by *convention*,
 * not just vocabulary: French clinicians say blood pressure in cmHg ("douze sur
 * huit" = 120/80), and Commonwealth-trained clinicians write frequency as
 * od/bd/tds and duration as "5/7". Those conventions are the substance of a
 * pack; the word lists are the easy part.
 */
import type { VitalKey } from '../db/schema'
import type { LangCode } from '../db/schema'
import { NUMBER_PATTERN, parseFrenchNumber } from './frenchNumbers'
import { EN_NUMBER_PATTERN, parseEnglishNumber } from './englishNumbers'

export type ClinicalLang = 'fr' | 'en'

export interface ClinicalLocale {
  code: ClinicalLang
  /** BCP-47 tag for the speech recogniser. */
  speechLang: 'fr-FR' | 'en-US'
  parseNumber: (s: string) => number | undefined
  numberPattern: string
  /** Ordered longest-first within each group so specific triggers win. */
  vitalTriggers: { key: VitalKey; triggers: string[] }[]
  bpTriggers: string[]
  /**
   * Whether a systolic under 30 should be read as cmHg and multiplied by ten.
   * True for French, where "tension douze sur huit" means 120/80. False for
   * English, where a reading that low is a value to question, not convert.
   */
  bpMayBeCmHg: boolean
  formulary: string[]
  diagnosisTriggers: string[]
  complaintTriggers: string[]
  /** Words that end a free-text field, beyond the shared trigger lists. */
  sectionWords: string[]
  frequency: (segment: string) => number | undefined
  duration: (segment: string) => number | undefined
  dose: (segment: string) => string | undefined
}

// ------------------------------------------------------------------ French --

const FR_N = NUMBER_PATTERN

function frFrequency(segment: string): number | undefined {
  // Explicit statements outrank idioms. If a clinician says both "trois fois
  // par jour" and "matin et soir", the numeral is what they meant.
  const perDay = segment.match(new RegExp(`(${FR_N})\\s*fois\\s*par\\s*jour`))
  if (perDay) {
    const v = parseFrenchNumber(perDay[1]!)
    if (v !== undefined && v >= 1 && v <= 12) return v
  }
  const everyNHours = segment.match(new RegExp(`toutes?\\s+les\\s+(${FR_N})\\s*heures?`))
  if (everyNHours) {
    const h = parseFrenchNumber(everyNHours[1]!)
    if (h !== undefined && h >= 1 && h <= 24) return Math.round(24 / h)
  }
  if (/matin,?\s*(et\s*)?midi,?\s*(et\s*)?soir/.test(segment)) return 3
  if (/matin\s*(,|et)\s*soir/.test(segment)) return 2
  if (/une\s*fois\s*par\s*jour|par\s*jour|\bquotidien/.test(segment)) return 1
  return undefined
}

function frDuration(segment: string): number | undefined {
  const weeks = segment.match(new RegExp(`pendant\\s+(${FR_N})\\s*semaines?`))
  if (weeks) {
    const v = parseFrenchNumber(weeks[1]!)
    if (v !== undefined) return v * 7
  }
  if (/pendant\s+une\s+semaine/.test(segment)) return 7
  const days = segment.match(new RegExp(`pendant\\s+(${FR_N})\\s*jours?`))
  if (days) {
    const v = parseFrenchNumber(days[1]!)
    if (v !== undefined && v >= 1 && v <= 365) return v
  }
  return undefined
}

function frDose(segment: string): string | undefined {
  const m = segment.match(new RegExp(`(${FR_N})\\s*(mg|g|ml|ui|comprimes?|cuilleres?|gouttes?|sachets?)\\b`))
  if (!m) return undefined
  const v = parseFrenchNumber(m[1]!)
  return v === undefined ? undefined : `${v} ${m[2]}`
}

export const FR_LOCALE: ClinicalLocale = {
  code: 'fr',
  speechLang: 'fr-FR',
  parseNumber: parseFrenchNumber,
  numberPattern: FR_N,
  vitalTriggers: [
    { key: 'oxygenSaturation', triggers: ['saturation en oxygene', 'saturation', 'spo2', 'sao2', 'sat'] },
    { key: 'respiratoryRate', triggers: ['frequence respiratoire', 'rythme respiratoire', 'respiration'] },
    { key: 'pulse', triggers: ['frequence cardiaque', 'rythme cardiaque', 'pouls'] },
    { key: 'temperature', triggers: ['temperature', 'fievre a', 'temp'] },
    { key: 'weight', triggers: ['poids', 'pese'] },
    { key: 'height', triggers: ['taille', 'mesure'] },
  ],
  bpTriggers: ['pression arterielle', 'tension arterielle', 'tension', 'ta'],
  bpMayBeCmHg: true,
  diagnosisTriggers: ['diagnostic', 'diagnostique', 'impression'],
  complaintTriggers: ['motif de consultation', 'motif', 'se plaint de', 'vient pour', 'plainte'],
  sectionWords: ['prescrire', 'prescription', 'ordonnance', 'donner', 'traitement'],
  frequency: frFrequency,
  duration: frDuration,
  dose: frDose,
  /**
   * Weighted toward Madagascar's actual burden of disease: malaria, respiratory
   * and diarrhoeal illness, malnutrition and parasitosis. Recognition is a
   * lookup, not a guess, so a word off this list is never treated as a drug.
   * Fixed-dose combinations come first and match greedily.
   */
  formulary: [
    'artemether lumefantrine', 'sulfadoxine pyrimethamine',
    'amoxicilline acide clavulanique', 'sels de rehydratation orale',
    'paracetamol', 'ibuprofene', 'aspirine',
    'artemether', 'lumefantrine', 'artesunate', 'quinine', 'amodiaquine',
    'sulfadoxine', 'pyrimethamine',
    'amoxicilline', 'ampicilline', 'cotrimoxazole', 'ciprofloxacine',
    'azithromycine', 'doxycycline', 'metronidazole', 'gentamicine', 'ceftriaxone',
    'albendazole', 'mebendazole', 'praziquantel', 'ivermectine',
    'fer', 'acide folique', 'zinc', 'vitamine a',
    'sels de rehydratation', 'sro',
    'salbutamol', 'prednisolone', 'dexamethasone',
    'chlorphenamine', 'promethazine',
    'omeprazole', 'ranitidine',
    'amlodipine', 'nifedipine', 'hydrochlorothiazide', 'atenolol', 'enalapril',
    'metformine', 'glibenclamide',
    'isoniazide', 'rifampicine', 'ethambutol', 'pyrazinamide',
    'oxytocine', 'misoprostol', 'magnesium',
  ],
}

// ----------------------------------------------------------------- English --

const EN_N = EN_NUMBER_PATTERN

/**
 * Commonwealth prescribing abbreviations.
 *
 * Standard across anglophone African training and ubiquitous on handwritten
 * charts, so an English pack that cannot read "tds" is close to useless in the
 * places it would be deployed.
 */
const EN_FREQUENCY_ABBREV: Record<string, number> = {
  od: 1, om: 1, on: 1, nocte: 1, mane: 1, daily: 1,
  bd: 2, bid: 2,
  tds: 3, tid: 3,
  qds: 4, qid: 4,
}

function enFrequency(segment: string): number | undefined {
  const perDay = segment.match(new RegExp(`(${EN_N})\\s*times?\\s*(?:a|per|each)?\\s*day|(${EN_N})\\s*times?\\s*daily`))
  if (perDay) {
    const v = parseEnglishNumber((perDay[1] ?? perDay[2] ?? '').trim())
    if (v !== undefined && v >= 1 && v <= 12) return v
  }

  const everyNHours = segment.match(new RegExp(`every\\s+(${EN_N})\\s*(?:hours?|hrs?|h)\\b`))
  if (everyNHours) {
    const h = parseEnglishNumber(everyNHours[1]!)
    if (h !== undefined && h >= 1 && h <= 24) return Math.round(24 / h)
  }

  const abbrev = segment.match(/\b(od|om|on|nocte|mane|bd|bid|tds|tid|qds|qid|daily)\b/)
  if (abbrev) return EN_FREQUENCY_ABBREV[abbrev[1]!]

  if (/\btwice\b/.test(segment)) return 2
  if (/\bthrice\b/.test(segment)) return 3
  if (/\bonce\b/.test(segment)) return 1
  if (/morning,?\s*(and\s*)?noon,?\s*(and\s*)?(night|evening)/.test(segment)) return 3
  if (/morning\s*(,|and)\s*(night|evening)/.test(segment)) return 2
  return undefined
}

function enDuration(segment: string): number | undefined {
  // "5/7" means five days, "2/52" two weeks: standard shorthand on a chart.
  const shorthand = segment.match(/\b(\d{1,3})\s*\/\s*(7|52)\b/)
  if (shorthand) {
    const n = Number.parseInt(shorthand[1]!, 10)
    const unit = shorthand[2] === '7' ? 1 : 7
    if (n >= 1 && n <= 365) return n * unit
  }

  const weeks = segment.match(new RegExp(`for\\s+(${EN_N})\\s*weeks?`))
  if (weeks) {
    const v = parseEnglishNumber(weeks[1]!)
    if (v !== undefined) return v * 7
  }
  if (/for\s+(a|one)\s+week/.test(segment)) return 7

  const days = segment.match(new RegExp(`for\\s+(${EN_N})\\s*days?`))
  if (days) {
    const v = parseEnglishNumber(days[1]!)
    if (v !== undefined && v >= 1 && v <= 365) return v
  }
  return undefined
}

function enDose(segment: string): string | undefined {
  const m = segment.match(
    new RegExp(`(${EN_N})\\s*(mg|g|ml|iu|units?|tablets?|tabs?|capsules?|caps?|drops?|sachets?|spoons?)\\b`),
  )
  if (!m) return undefined
  const v = parseEnglishNumber(m[1]!)
  return v === undefined ? undefined : `${v} ${m[2]}`
}

export const EN_LOCALE: ClinicalLocale = {
  code: 'en',
  speechLang: 'en-US',
  parseNumber: parseEnglishNumber,
  numberPattern: EN_N,
  vitalTriggers: [
    { key: 'oxygenSaturation', triggers: ['oxygen saturation', 'saturation', 'spo2', 'sao2', 'sats', 'sat'] },
    { key: 'respiratoryRate', triggers: ['respiratory rate', 'resp rate', 'breathing rate', 'rr'] },
    { key: 'pulse', triggers: ['heart rate', 'pulse rate', 'pulse', 'hr'] },
    { key: 'temperature', triggers: ['temperature', 'temp', 'fever of'] },
    { key: 'weight', triggers: ['weight', 'weighs'] },
    { key: 'height', triggers: ['height'] },
  ],
  bpTriggers: ['blood pressure', 'bp'],
  // A systolic under 30 in English is a value to question, not to convert.
  bpMayBeCmHg: false,
  diagnosisTriggers: ['diagnosis', 'impression', 'assessment'],
  complaintTriggers: [
    'presenting complaint', 'chief complaint', 'complains of', 'complaining of',
    'reason for visit', 'came for', 'c/o',
  ],
  sectionWords: ['prescribe', 'prescription', 'give', 'treatment', 'plan', 'rx'],
  frequency: enFrequency,
  duration: enDuration,
  dose: enDose,
  formulary: [
    'artemether lumefantrine', 'sulfadoxine pyrimethamine',
    'amoxicillin clavulanic acid', 'oral rehydration salts',
    'paracetamol', 'acetaminophen', 'ibuprofen', 'aspirin',
    'artemether', 'lumefantrine', 'artesunate', 'quinine', 'amodiaquine',
    'sulfadoxine', 'pyrimethamine',
    'amoxicillin', 'ampicillin', 'cotrimoxazole', 'ciprofloxacin',
    'azithromycin', 'doxycycline', 'metronidazole', 'gentamicin', 'ceftriaxone',
    'albendazole', 'mebendazole', 'praziquantel', 'ivermectin',
    'iron', 'folic acid', 'zinc', 'vitamin a',
    'ors',
    'salbutamol', 'prednisolone', 'dexamethasone',
    'chlorphenamine', 'promethazine',
    'omeprazole', 'ranitidine',
    'amlodipine', 'nifedipine', 'hydrochlorothiazide', 'atenolol', 'enalapril',
    'metformin', 'glibenclamide',
    'isoniazid', 'rifampicin', 'ethambutol', 'pyrazinamide',
    'oxytocin', 'misoprostol', 'magnesium',
  ],
}

export const CLINICAL_LOCALES: Record<ClinicalLang, ClinicalLocale> = {
  fr: FR_LOCALE,
  en: EN_LOCALE,
}

/**
 * Which pack to use for a given interface language.
 *
 * Malagasy falls back to French: clinical documentation in Madagascar is
 * written in French, and there is no Malagasy dictation model worth wiring in
 * (docs/MODEL-RESEARCH.md §2.2). Falling back is honest; pretending to parse
 * Malagasy would not be.
 */
export function clinicalLocaleFor(lang: LangCode): ClinicalLocale {
  return lang === 'en' ? EN_LOCALE : FR_LOCALE
}

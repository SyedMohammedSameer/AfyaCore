/**
 * What the patient reads, in the language the patient speaks.
 *
 * ## The gap this closes
 *
 * The app's central claim is that the clinician documents in the clinical
 * language and the patient leaves with something they can actually read. That
 * was true in Madagascar and nowhere else: for eight of the nine country
 * profiles the instruction sheet printed in the *clinician's* language —
 * French in Senegal, Côte d'Ivoire and the DRC, English in Kenya, Nigeria,
 * Ghana, Tanzania and Uganda. A dispensary in Tanzania handed out English.
 * That is precisely the failure the sheet exists to prevent, and the pan-African
 * work generalised everything except it: phone patterns, formularies, statutes
 * and HMIS names all moved, and the patient-facing surface stayed behind.
 *
 * ## Why it stayed behind
 *
 * The sheet rendered from `STRINGS`, the 232-key *interface* dictionary, so
 * adding a patient language meant translating the whole app — every settings
 * label, every error, every audit action — to print four lines on a sheet of
 * paper. The cost model made the gap invisible.
 *
 * It turns out the patient-facing surface is five strings. Interface language
 * and patient language are different things with different audiences and
 * wildly different volumes, and conflating them is what made this expensive.
 * Adding a language is now one object in this file.
 *
 * ## ⚠️ On the translations
 *
 * Only French and English here have been written by someone who speaks them.
 * Every other pack is a best effort and carries `reviewed: false`, which the
 * app displays on the sheet rather than hiding.
 *
 * This is a safety property, not modesty. Dosage wording is the one place in
 * this app where being confidently wrong is worse than being absent: "twice a
 * day" and "every two days" differ by one word in most languages and by a
 * factor of four in the dose delivered. A facility deploying in one of these
 * languages needs a speaker who works in that health system to read the pack —
 * five strings, an afternoon's work — before it is handed to a patient.
 *
 * What holds the sheet up in the meantime is the part that needs no
 * translation: the drug name as written, the numerals, the total count, and
 * the sunrise/midday/night dosing icons. Those were always the load-bearing
 * elements for a patient with limited literacy, and they are identical in
 * every language.
 */

/**
 * Languages a patient instruction sheet can be printed in.
 *
 * Deliberately wider than `LangCode`, which stays the set of *interface*
 * languages. A patient language costs five strings; an interface language
 * costs 232, and the two lists have no reason to be the same.
 */
export type PatientLang =
  | 'fr'
  | 'en'
  | 'mg'
  | 'sw' // Kiswahili — Kenya, Tanzania, Uganda, eastern DRC
  | 'wo' // Wolof — Senegal
  | 'ha' // Hausa — northern Nigeria
  | 'tw' // Twi (Akan) — Ghana
  | 'ln' // Lingala — western DRC
  | 'lg' // Luganda — central Uganda
  | 'dyu' // Dioula (Jula) — Côte d'Ivoire

export interface PatientPack {
  code: PatientLang
  /** The language's own name for itself, which is what staff will look for. */
  name: string
  /**
   * BCP-47 tag for read-aloud, or null where no browser ships a voice.
   *
   * Null is the common case and it is handled rather than hidden: the sheet
   * still prints, and the read-aloud button reports that no voice is
   * available instead of silently doing nothing.
   */
  speechLang: string | null
  /**
   * Whether a speaker who works in this health system has read these strings.
   *
   * False everywhere except French and English. Displayed on the sheet.
   */
  reviewed: boolean
  /** Header above the patient's name. */
  instructionsFor: string
  /** Shown when the consultation prescribed nothing. */
  noPrescriptions: string
  /**
   * "3 times a day". Digits rather than spelled-out numerals throughout: a
   * numeral is legible to someone who reads little, and it is the same
   * numeral in every language on this list.
   */
  timesPerDay: (n: number) => string
  /** "for 5 days" */
  forDays: (n: number) => string
}

export const PATIENT_PACKS: Record<PatientLang, PatientPack> = {
  fr: {
    code: 'fr',
    name: 'Français',
    speechLang: 'fr-FR',
    reviewed: true,
    instructionsFor: 'Consignes pour',
    noPrescriptions: 'Aucun médicament prescrit.',
    timesPerDay: (n) => `${n} fois par jour`,
    forDays: (n) => `pendant ${n} jour${n > 1 ? 's' : ''}`,
  },

  en: {
    code: 'en',
    name: 'English',
    speechLang: 'en-US',
    reviewed: true,
    instructionsFor: 'Instructions for',
    noPrescriptions: 'No medicine prescribed.',
    timesPerDay: (n) => `${n} time${n > 1 ? 's' : ''} per day`,
    forDays: (n) => `for ${n} day${n > 1 ? 's' : ''}`,
  },

  mg: {
    code: 'mg',
    name: 'Malagasy',
    speechLang: 'mg-MG',
    reviewed: false,
    instructionsFor: 'Torolàlana ho an’i',
    noPrescriptions: 'Tsy misy fanafody nomena.',
    timesPerDay: (n) => `in-${n} isan’andro`,
    forDays: (n) => `mandritra ny ${n} andro`,
  },

  sw: {
    code: 'sw',
    name: 'Kiswahili',
    speechLang: 'sw-KE',
    reviewed: false,
    instructionsFor: 'Maelekezo kwa',
    noPrescriptions: 'Hakuna dawa iliyoandikwa.',
    timesPerDay: (n) => `mara ${n} kwa siku`,
    forDays: (n) => `kwa siku ${n}`,
  },

  wo: {
    code: 'wo',
    name: 'Wolof',
    speechLang: null,
    reviewed: false,
    instructionsFor: 'Ndigal yi ngir',
    noPrescriptions: 'Amul garab bu ñu bind.',
    timesPerDay: (n) => `${n} yoon ci bés bu nekk`,
    forDays: (n) => `ci ${n} fan`,
  },

  ha: {
    code: 'ha',
    name: 'Hausa',
    speechLang: null,
    reviewed: false,
    instructionsFor: 'Umarni ga',
    noPrescriptions: 'Ba a rubuta magani ba.',
    timesPerDay: (n) => `sau ${n} a rana`,
    forDays: (n) => `na kwanaki ${n}`,
  },

  tw: {
    code: 'tw',
    name: 'Twi',
    speechLang: null,
    reviewed: false,
    instructionsFor: 'Akwankyerɛ ma',
    noPrescriptions: 'Wɔamma aduru biara.',
    timesPerDay: (n) => `mprɛ ${n} da biara`,
    forDays: (n) => `nna ${n}`,
  },

  ln: {
    code: 'ln',
    name: 'Lingála',
    speechLang: null,
    reviewed: false,
    instructionsFor: 'Malako mpo na',
    noPrescriptions: 'Nkisi epesami te.',
    timesPerDay: (n) => `mbala ${n} na mokolo`,
    forDays: (n) => `mikolo ${n}`,
  },

  lg: {
    code: 'lg',
    name: 'Luganda',
    speechLang: null,
    reviewed: false,
    instructionsFor: 'Ebiragiro bya',
    noPrescriptions: 'Tewali ddagala eriweereddwa.',
    timesPerDay: (n) => `emirundi ${n} buli lunaku`,
    forDays: (n) => `okumala ennaku ${n}`,
  },

  dyu: {
    code: 'dyu',
    name: 'Julakan',
    speechLang: null,
    reviewed: false,
    instructionsFor: 'Cikan minnu bɛ',
    noPrescriptions: 'Fura si ma sɛbɛn.',
    timesPerDay: (n) => `siɲɛ ${n} tile kɔnɔ`,
    forDays: (n) => `tile ${n} kɔnɔ`,
  },
}

/**
 * The pack for a language, falling back to French rather than throwing.
 *
 * An instruction sheet must always print. A patient standing at the dispensary
 * counter is not helped by an error page, and French is the safest fallback
 * here because it is a clinical language in five of the nine profiles and a
 * second language in the others.
 */
export function patientPack(lang: string | undefined): PatientPack {
  return PATIENT_PACKS[lang as PatientLang] ?? PATIENT_PACKS.fr
}

export function patientLangCodes(): PatientLang[] {
  return Object.keys(PATIENT_PACKS) as PatientLang[]
}

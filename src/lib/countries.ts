/**
 * Country profiles.
 *
 * AfyaCore was built for Madagascar and, in several places, quietly assumed it.
 * The most consequential assumption was in the de-identifier: the phone-number
 * pattern matched Malagasy mobiles specifically, so deploying the same code in
 * Kenya or Nigeria would have left patient phone numbers in exported free text.
 * That is a privacy failure, not a localisation gap, and it is the reason this
 * module exists.
 *
 * A profile is **data**, not code. Adding a country should be adding an entry
 * here, not editing an extractor, and anything that cannot be expressed as data
 * is a sign the abstraction is wrong.
 *
 * ## What a profile does and does not decide
 *
 * It decides things that vary by country and have a correct answer: the phone
 * format, which clinical language the extractor parses, what a facility is
 * called, which data-protection regime applies.
 *
 * It does **not** encode clinical practice. Vital-sign thresholds, IMCI age
 * bands and plausibility ranges are physiology, and physiology does not change
 * at a border. Making those configurable would invite somebody to "localise" a
 * danger sign.
 *
 * ## ⚠️ On the legal metadata
 *
 * The `law` block names the statute and the regulator for each country. Those
 * names are recorded to the best of our knowledge and are **not legal advice**;
 * every profile ships with `counselReviewed: false` and the app says so.
 *
 * Retention periods and breach-notification windows are deliberately left as
 * `null` wherever we could not establish them from a primary source. A
 * confidently wrong retention period in a health system is worse than an
 * obviously absent one: the first gets followed, the second gets asked about.
 * `docs/COMPLIANCE.md` records what is confirmed and what is not.
 */
import type { ClinicalLang } from './clinicalLocales'
import type { LangCode } from '../db/schema'

export interface PhoneFormat {
  /** International dialling code, without the plus. */
  callingCode: string
  /** Digits in a national significant number, excluding any trunk prefix. */
  nsnLength: number
  /**
   * Whether a national number is written with a leading trunk `0`.
   *
   * Senegal and Côte d'Ivoire write mobiles without one, which is exactly the
   * sort of detail that makes a single "African phone number" regex wrong.
   */
  trunkZero: boolean
  /** Leading digits of mobile ranges, used when there is no trunk zero. */
  mobilePrefixes?: string[]
  /** A synthetic example, used in tests and placeholders. Never a real number. */
  example: string
}

export interface DataProtectionRegime {
  /** Short name of the governing statute. */
  law: string
  /** Supervisory authority. */
  regulator: string
  /**
   * Hours within which a personal-data breach must be reported, or null where
   * we could not establish it. Null means "find out", not "no obligation".
   */
  breachNotificationHours: number | null
  /**
   * Years a clinical record must be retained, or null where unestablished.
   * Retention is usually set by health-sector rules rather than the data
   * protection statute, and varies by record type.
   */
  retentionYears: number | null
  /** Whether the regime restricts transferring personal data out of country. */
  crossBorderRestricted: boolean
  /**
   * False everywhere until a qualified lawyer in that jurisdiction has read it.
   * Surfaced in the app rather than buried, because a compliance claim nobody
   * has checked is worse than none.
   */
  counselReviewed: boolean
}

export interface CountryProfile {
  /** ISO 3166-1 alpha-2. */
  code: string
  name: string
  /** The language clinical documentation is written in, driving extraction. */
  clinicalLang: ClinicalLang
  /** Interface languages offered, most preferred first. */
  interfaceLangs: LangCode[]
  /** Languages a patient instruction sheet can be printed in. */
  patientLangs: LangCode[]
  phone: PhoneFormat
  /** What a primary care facility is called locally, for labels and prompts. */
  facilityTerm: string
  /** National health information system the monthly report feeds. */
  hmis: string
  law: DataProtectionRegime
}

/**
 * Build a phone-number pattern for de-identification.
 *
 * Deliberately over-inclusive within its shape: a false positive costs one
 * redacted token in a research export, a false negative leaks a contact number.
 * That is the same asymmetry the rest of the de-identifier is built around.
 *
 * Two constraints keep it from eating clinical content:
 *
 *  - `.` is **not** a separator. It is the decimal point, and allowing it would
 *    let "température 38.5, pouls 92, tension 120/80" read as one long digit
 *    run and be redacted as a phone number.
 *  - A match must begin with an international prefix, a trunk zero, or a known
 *    mobile prefix. A bare run of digits is left to the generic long-number
 *    rule, so a sequence of vitals cannot accidentally look like a number.
 */
export function phonePattern(format: PhoneFormat): RegExp {
  const { callingCode, nsnLength, trunkZero, mobilePrefixes } = format
  const intl = `(?:\\+|00)${callingCode}`

  // After the trunk zero or mobile prefix, the remaining digits may carry
  // single separators. Bounded repetition, so no catastrophic backtracking.
  const rest = (n: number) => `(?:[\\s-]?\\d){${n}}`

  const starts: string[] = [
    // International form: +261 32 12 345 67
    `${intl}[\\s-]?0?${rest(nsnLength)}`,
  ]
  if (trunkZero) {
    // National form with a trunk zero: 032 12 345 67
    starts.push(`0${rest(nsnLength)}`)
  }
  for (const prefix of mobilePrefixes ?? []) {
    // National form without a trunk zero: 77 123 45 67
    starts.push(`${prefix}${rest(nsnLength - prefix.length)}`)
  }

  // A lookbehind rather than a leading `\b`. `\b` asserts a word-boundary,
  // which never holds before the `+` of an international prefix, because `+` is
  // not a word character: `\b\+261` matches nothing at all. Supported in Node
  // 18+ and every browser this app targets.
  return new RegExp(`(?<![\\w+])(?:${starts.join('|')})\\b`, 'g')
}

/**
 * The countries this build ships profiles for.
 *
 * Francophone and anglophone West, East and Southern Africa, chosen because
 * they share the two clinical documentation languages the extractor already
 * handles. A country whose clinical language we cannot parse does not belong
 * here yet: shipping a profile without an extractor would promise support that
 * does not exist.
 */
export const COUNTRY_PROFILES: Record<string, CountryProfile> = {
  MG: {
    code: 'MG',
    name: 'Madagascar',
    clinicalLang: 'fr',
    interfaceLangs: ['fr', 'mg', 'en'],
    patientLangs: ['mg', 'fr'],
    // 03X XX XXX XX
    phone: { callingCode: '261', nsnLength: 9, trunkZero: true, example: '032 12 345 67' },
    facilityTerm: 'CSB',
    hmis: 'DHIS2 (SSNIS)',
    law: {
      law: 'Loi n°2014-038 sur la protection des données à caractère personnel',
      regulator: 'Commission Malgache de l’Informatique et des Libertés (CMIL)',
      breachNotificationHours: null,
      retentionYears: null,
      crossBorderRestricted: true,
      counselReviewed: false,
    },
  },

  SN: {
    code: 'SN',
    name: 'Sénégal',
    clinicalLang: 'fr',
    interfaceLangs: ['fr', 'en'],
    patientLangs: ['fr'],
    // Mobiles are written without a trunk zero: 77 123 45 67
    phone: {
      callingCode: '221',
      nsnLength: 9,
      trunkZero: false,
      mobilePrefixes: ['70', '75', '76', '77', '78'],
      example: '77 123 45 67',
    },
    facilityTerm: 'Poste de santé',
    hmis: 'DHIS2',
    law: {
      law: 'Loi n°2008-12 sur la protection des données à caractère personnel',
      regulator: 'Commission de Protection des Données Personnelles (CDP)',
      breachNotificationHours: null,
      retentionYears: null,
      crossBorderRestricted: true,
      counselReviewed: false,
    },
  },

  CI: {
    code: 'CI',
    name: 'Côte d’Ivoire',
    clinicalLang: 'fr',
    interfaceLangs: ['fr', 'en'],
    patientLangs: ['fr'],
    // Ten digits since the 2021 renumbering: 07 12 34 56 78
    phone: {
      callingCode: '225',
      nsnLength: 10,
      trunkZero: false,
      mobilePrefixes: ['01', '05', '07'],
      example: '07 12 34 56 78',
    },
    facilityTerm: 'Centre de santé',
    hmis: 'DHIS2',
    law: {
      law: 'Loi n°2013-450 relative à la protection des données à caractère personnel',
      regulator: 'Autorité de Régulation des Télécommunications (ARTCI)',
      breachNotificationHours: null,
      retentionYears: null,
      crossBorderRestricted: true,
      counselReviewed: false,
    },
  },

  CD: {
    code: 'CD',
    name: 'République démocratique du Congo',
    clinicalLang: 'fr',
    interfaceLangs: ['fr', 'en'],
    patientLangs: ['fr'],
    phone: { callingCode: '243', nsnLength: 9, trunkZero: true, example: '081 234 5678' },
    facilityTerm: 'Centre de santé',
    hmis: 'DHIS2 (SNIS)',
    law: {
      law: 'Ordonnance-loi n°23/010 du 13 mars 2023 portant Code du numérique',
      regulator: 'Autorité de régulation du numérique',
      breachNotificationHours: null,
      retentionYears: null,
      crossBorderRestricted: true,
      counselReviewed: false,
    },
  },

  KE: {
    code: 'KE',
    name: 'Kenya',
    clinicalLang: 'en',
    interfaceLangs: ['en'],
    patientLangs: ['en'],
    // 07XX XXX XXX and the newer 01XX range
    phone: { callingCode: '254', nsnLength: 9, trunkZero: true, example: '0712 345 678' },
    facilityTerm: 'Health Centre',
    hmis: 'KHIS (DHIS2)',
    law: {
      law: 'Data Protection Act, 2019',
      regulator: 'Office of the Data Protection Commissioner (ODPC)',
      breachNotificationHours: 72,
      retentionYears: null,
      crossBorderRestricted: true,
      counselReviewed: false,
    },
  },

  NG: {
    code: 'NG',
    name: 'Nigeria',
    clinicalLang: 'en',
    interfaceLangs: ['en'],
    patientLangs: ['en'],
    // 080X XXX XXXX, ten national digits
    phone: { callingCode: '234', nsnLength: 10, trunkZero: true, example: '0803 123 4567' },
    facilityTerm: 'Primary Health Centre',
    hmis: 'NHMIS (DHIS2)',
    law: {
      law: 'Nigeria Data Protection Act, 2023',
      regulator: 'Nigeria Data Protection Commission (NDPC)',
      breachNotificationHours: 72,
      retentionYears: null,
      crossBorderRestricted: true,
      counselReviewed: false,
    },
  },

  GH: {
    code: 'GH',
    name: 'Ghana',
    clinicalLang: 'en',
    interfaceLangs: ['en'],
    patientLangs: ['en'],
    phone: { callingCode: '233', nsnLength: 9, trunkZero: true, example: '024 123 4567' },
    facilityTerm: 'CHPS compound',
    hmis: 'DHIMS2 (DHIS2)',
    law: {
      law: 'Data Protection Act, 2012 (Act 843)',
      regulator: 'Data Protection Commission',
      breachNotificationHours: null,
      retentionYears: null,
      crossBorderRestricted: true,
      counselReviewed: false,
    },
  },

  TZ: {
    code: 'TZ',
    name: 'Tanzania',
    clinicalLang: 'en',
    interfaceLangs: ['en'],
    patientLangs: ['en'],
    phone: { callingCode: '255', nsnLength: 9, trunkZero: true, example: '0754 123 456' },
    facilityTerm: 'Dispensary',
    hmis: 'DHIS2',
    law: {
      law: 'Personal Data Protection Act, 2022',
      regulator: 'Personal Data Protection Commission (PDPC)',
      breachNotificationHours: null,
      retentionYears: null,
      crossBorderRestricted: true,
      counselReviewed: false,
    },
  },

  UG: {
    code: 'UG',
    name: 'Uganda',
    clinicalLang: 'en',
    interfaceLangs: ['en'],
    patientLangs: ['en'],
    phone: { callingCode: '256', nsnLength: 9, trunkZero: true, example: '0772 123 456' },
    facilityTerm: 'Health Centre II',
    hmis: 'DHIS2 (HMIS)',
    law: {
      law: 'Data Protection and Privacy Act, 2019',
      regulator: 'Personal Data Protection Office (PDPO)',
      breachNotificationHours: 72,
      retentionYears: null,
      crossBorderRestricted: true,
      counselReviewed: false,
    },
  },
}

export const DEFAULT_COUNTRY = 'MG'

export function countryProfile(code: string | undefined): CountryProfile {
  return COUNTRY_PROFILES[(code ?? '').toUpperCase()] ?? COUNTRY_PROFILES[DEFAULT_COUNTRY]!
}

export function countryCodes(): string[] {
  return Object.keys(COUNTRY_PROFILES).sort((a, b) =>
    COUNTRY_PROFILES[a]!.name.localeCompare(COUNTRY_PROFILES[b]!.name),
  )
}

/**
 * Every phone pattern, for a de-identifier that does not know where it is.
 *
 * A device configured for Kenya may still hold a note mentioning a Malagasy
 * number, and a redaction pass has no reason to be parochial: running all of
 * them costs microseconds and removes a whole class of "wrong country
 * configured" leak. The configured country's pattern is not privileged, because
 * being wrong about the configuration is itself the failure being guarded
 * against.
 */
export function allPhonePatterns(): RegExp[] {
  return Object.values(COUNTRY_PROFILES).map((c) => phonePattern(c.phone))
}

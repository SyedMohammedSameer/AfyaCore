/**
 * The invariant this file exists to defend.
 *
 * For eight of nine countries the instruction sheet printed in the clinician's
 * language — English in Tanzania, French in Senegal — which is exactly the
 * failure the sheet exists to prevent. Nothing failed when it did, so nothing
 * caught it. These tests are what would have.
 */
import { describe, expect, it } from 'vitest'
import { PATIENT_PACKS, patientLangCodes, patientPack, type PatientLang } from './patient'
import { COUNTRY_PROFILES, countryCodes } from '../lib/countries'
import { CLINICAL_LOCALES } from '../lib/clinicalLocales'

describe('every country can print for its own patients', () => {
  it('offers at least one patient language in every profile', () => {
    for (const code of countryCodes()) {
      expect(COUNTRY_PROFILES[code]!.patientLangs.length).toBeGreaterThan(0)
    }
  })

  it('offers a patient language that is not merely the clinical language', () => {
    // The whole point. A sheet in the language the clinician documents in is
    // not a translation, it is a copy — and in Tanzania it is a copy in a
    // language most patients do not read.
    for (const code of countryCodes()) {
      const profile = COUNTRY_PROFILES[code]!
      const clinical = profile.clinicalLang as string
      const other = profile.patientLangs.filter((l) => l !== clinical)
      expect(other.length, `${code} only prints in ${clinical}`).toBeGreaterThan(0)
    }
  })

  it('lists the local language before the colonial one', () => {
    // Order is what the clinician sees first in the picker. A list that puts
    // English above Kiswahili in Tanzania will be left on English.
    for (const code of countryCodes()) {
      const profile = COUNTRY_PROFILES[code]!
      if (profile.patientLangs.length < 2) continue
      expect(profile.patientLangs[0], `${code} defaults to a non-local language`).not.toBe(
        profile.clinicalLang as string,
      )
    }
  })

  it('names only languages that have a pack', () => {
    for (const code of countryCodes()) {
      for (const lang of COUNTRY_PROFILES[code]!.patientLangs) {
        expect(PATIENT_PACKS[lang], `${code} names ${lang}, which has no pack`).toBeTruthy()
      }
    }
  })

  it('keeps a fallback for the clinical language too', () => {
    // A patient who does read French or English must still be printable in it.
    for (const code of countryCodes()) {
      const profile = COUNTRY_PROFILES[code]!
      expect(profile.patientLangs).toContain(profile.clinicalLang as PatientLang)
    }
  })
})

describe('patient packs', () => {
  it('produces a distinct dosing phrase in every language', () => {
    // Catches a pack copied from its neighbour and half-edited, which is the
    // likeliest way a wrong dosage phrase gets in.
    const phrases = patientLangCodes().map((c) => PATIENT_PACKS[c].timesPerDay(3))
    expect(new Set(phrases).size).toBe(phrases.length)
  })

  it('carries the number into the phrase in every language', () => {
    // A pack that drops the digit reads as "times a day" and is worse than
    // useless: the patient cannot tell how many.
    for (const code of patientLangCodes()) {
      const pack = PATIENT_PACKS[code]
      expect(pack.timesPerDay(3), `${code} timesPerDay`).toContain('3')
      expect(pack.forDays(5), `${code} forDays`).toContain('5')
    }
  })

  it('is honest about which translations have been checked', () => {
    // Only the two written by speakers. If this ever flips to true for a
    // language, a human must have read it — the test is here so it cannot
    // drift silently, the same rule the country legal metadata follows.
    const reviewed = patientLangCodes().filter((c) => PATIENT_PACKS[c].reviewed)
    expect(reviewed.sort()).toEqual(['en', 'fr'])
  })

  it('never claims a voice it cannot produce', () => {
    for (const code of patientLangCodes()) {
      const pack = PATIENT_PACKS[code]
      if (pack.speechLang === null) continue
      expect(pack.speechLang).toMatch(/^[a-z]{2}-[A-Z]{2}$/)
    }
  })

  it('falls back rather than throwing on an unknown language', () => {
    // An instruction sheet must always print. A patient at the dispensary
    // counter is not helped by an error page.
    expect(patientPack('zz').code).toBe('fr')
    expect(patientPack(undefined).code).toBe('fr')
  })

  it('covers every clinical language, so the sheet can always fall back', () => {
    for (const lang of Object.keys(CLINICAL_LOCALES)) {
      expect(PATIENT_PACKS[lang as PatientLang]).toBeTruthy()
    }
  })
})

/**
 * Which country this device is deployed in, and what follows from it.
 *
 * One setting, because a facility is in exactly one country and everything else
 * that varies by country is derived from the profile rather than configured
 * separately. A settings screen with eight independent regional toggles is one
 * somebody sets inconsistently.
 *
 * ## The binding that matters
 *
 * Extraction language follows the **country**, not the interface language.
 *
 * That is a correctness fix, not a refactor. Clinical documentation language is
 * a property of a health system, not of the person holding the phone: notes in
 * Madagascar are written in French whether the nurse reads the interface in
 * Malagasy, French or English. The previous binding took the clinical locale
 * from the interface language, so a Malagasy clinician who switched the UI to
 * English would have had their French dictation parsed by the English pack,
 * which rejects the cmHg blood-pressure convention and knows a different
 * formulary. The interface language is a preference; the clinical language is a
 * fact about the deployment.
 */
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/db'
import { countryProfile, DEFAULT_COUNTRY, type CountryProfile } from './countries'
import { CLINICAL_LOCALES, type ClinicalLocale } from './clinicalLocales'

const COUNTRY_KEY = 'facility.country'

export async function getFacilityCountry(): Promise<string> {
  const row = await db.settings.get(COUNTRY_KEY)
  return typeof row?.value === 'string' && row.value ? row.value : DEFAULT_COUNTRY
}

export async function setFacilityCountry(code: string): Promise<void> {
  await db.settings.put({ key: COUNTRY_KEY, value: code.toUpperCase() })
}

export async function getCountryProfile(): Promise<CountryProfile> {
  return countryProfile(await getFacilityCountry())
}

/**
 * The country profile, live.
 *
 * Defaults rather than returning undefined while the read is in flight: a
 * component that has to handle "country not known yet" would end up rendering
 * a spinner over a settings screen, and the default is the right answer for
 * every device that has not been reconfigured.
 */
export function useCountryProfile(): CountryProfile {
  return useLiveQuery(() => getCountryProfile(), [], countryProfile(DEFAULT_COUNTRY))
}

/** The clinical language pack this deployment documents in. */
export function useClinicalLocale(): ClinicalLocale {
  return CLINICAL_LOCALES[useCountryProfile().clinicalLang]
}

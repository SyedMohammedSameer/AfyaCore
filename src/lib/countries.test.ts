/**
 * Tests for country profiles and, mostly, for the phone patterns they carry.
 *
 * Every number below is synthetic and follows a published national numbering
 * plan; none belongs to anyone.
 *
 * Two failure modes are being guarded against, and they pull in opposite
 * directions. A pattern that is too narrow leaks a patient's phone number out
 * of a de-identified export, which is the bug that prompted this module: the
 * de-identifier previously recognised only Malagasy mobiles, so the same code
 * in Kenya silently failed. A pattern that is too broad eats a run of vital
 * signs and destroys the clinical record it was meant to protect.
 *
 * The second is the easier mistake to make and the harder one to notice, so it
 * gets the more paranoid tests.
 */
import { describe, expect, it } from 'vitest'
import {
  COUNTRY_PROFILES,
  DEFAULT_COUNTRY,
  allPhonePatterns,
  countryCodes,
  countryProfile,
  phonePattern,
} from './countries'
import { scrubFreeText } from './deidentify'

/** True when any shipped country pattern matches. */
const redactsPhone = (text: string) =>
  allPhonePatterns().some((pattern) => {
    pattern.lastIndex = 0
    return pattern.test(text)
  })

describe('profile lookup', () => {
  it('falls back to the default rather than returning undefined', () => {
    // A missing profile must never leave the de-identifier without patterns.
    expect(countryProfile(undefined).code).toBe(DEFAULT_COUNTRY)
    expect(countryProfile('XX').code).toBe(DEFAULT_COUNTRY)
  })

  it('is case insensitive, because a config file will contain "ke"', () => {
    expect(countryProfile('ke').code).toBe('KE')
  })

  it('lists every shipped country', () => {
    expect(countryCodes()).toHaveLength(Object.keys(COUNTRY_PROFILES).length)
  })

  it('only ships countries whose clinical language the extractor handles', () => {
    // A profile without an extractor promises support that does not exist.
    for (const profile of Object.values(COUNTRY_PROFILES)) {
      expect(['fr', 'en']).toContain(profile.clinicalLang)
    }
  })

  it('never claims a legal regime has been reviewed by counsel', () => {
    // The honest default. A compliance claim nobody has checked is worse than
    // no claim, so this stays false until a lawyer in that jurisdiction says
    // otherwise, and the test is here so it cannot drift silently.
    for (const profile of Object.values(COUNTRY_PROFILES)) {
      expect(profile.law.counselReviewed).toBe(false)
      expect(profile.law.law).not.toBe('')
      expect(profile.law.regulator).not.toBe('')
    }
  })
})

describe('phone patterns match real national formats', () => {
  const cases: Array<[string, string[]]> = [
    ['MG', ['032 12 345 67', '0321234567', '+261 32 12 345 67', '00261321234567']],
    ['KE', ['0712 345 678', '0712345678', '+254 712 345 678', '0110 123 456']],
    ['NG', ['0803 123 4567', '08031234567', '+234 803 123 4567']],
    ['GH', ['024 123 4567', '0241234567', '+233 24 123 4567']],
    ['SN', ['77 123 45 67', '771234567', '+221 77 123 45 67']],
    ['CI', ['07 12 34 56 78', '0712345678', '+225 07 12 34 56 78']],
    ['CD', ['081 234 5678', '+243 81 234 5678']],
    ['TZ', ['0754 123 456', '+255 754 123 456']],
    ['UG', ['0772 123 456', '+256 772 123 456']],
  ]

  for (const [code, numbers] of cases) {
    for (const number of numbers) {
      it(`${code}: ${number}`, () => {
        const pattern = phonePattern(COUNTRY_PROFILES[code]!.phone)
        pattern.lastIndex = 0
        expect(pattern.test(number)).toBe(true)
      })
    }
  }

  it('matches every profile own documented example', () => {
    for (const profile of Object.values(COUNTRY_PROFILES)) {
      const pattern = phonePattern(profile.phone)
      pattern.lastIndex = 0
      expect(pattern.test(profile.phone.example), `${profile.code} example`).toBe(true)
    }
  })
})

describe('phone patterns do not eat clinical content', () => {
  // The dangerous direction. Redacting vitals silently destroys the record.
  const clinical = [
    'Température 38.5, pouls 92, tension 120/80',
    'Temperature 38.5 pulse 92 blood pressure 120 over 80',
    'FR 42 par minute, saturation 94 pour cent',
    'Poids 12.4 kg, taille 95 cm',
    'Paracétamol 500 mg 3 fois par jour pendant 5 jours',
    'Amoxicillin 500 mg tds for 7/7',
    'Enfant de 6 ans, 18 kg',
    'Consultation du 12/05/2026',
  ]

  for (const text of clinical) {
    it(`leaves alone: ${text}`, () => {
      expect(redactsPhone(text)).toBe(false)
    })
  }

  it('survives a full scrub with the clinical content intact', () => {
    const note =
      'Température 38.5, pouls 92, tension 120/80. Paracétamol 500 mg trois fois par jour.'
    const { text } = scrubFreeText(note, [])
    expect(text).toBe(note)
  })

  it('does not treat a decimal as a separator', () => {
    // `.` is the decimal point. Allowing it as a digit separator is what would
    // let a run of vitals read as one long number.
    expect(redactsPhone('38.5 92 120 80 22 16')).toBe(false)
  })
})

describe('the bug this module exists to fix', () => {
  it('removes a Kenyan number, which the Madagascar-only pattern missed', () => {
    const { text } = scrubFreeText('Call the family on 0712 345 678 if worse', [])
    expect(text).not.toContain('0712 345 678')
  })

  it('removes a Nigerian number', () => {
    const { text } = scrubFreeText('Guardian reachable on 0803 123 4567', [])
    expect(text).not.toContain('0803 123 4567')
  })

  it('removes a Senegalese number written without a trunk zero', () => {
    const { text } = scrubFreeText('Joindre au 77 123 45 67', [])
    expect(text).not.toContain('77 123 45 67')
  })

  it('still removes a Malagasy number', () => {
    const { text } = scrubFreeText('Joindre la famille au 034 12 345 67', [])
    expect(text).not.toContain('034 12 345 67')
  })

  it('redacts a number from the wrong country for the configured device', () => {
    // A device configured for Kenya may still hold a note naming a Malagasy
    // number. Being wrong about the configuration is itself the failure being
    // guarded against, so no country pattern is privileged.
    const { text } = scrubFreeText('Referred from Madagascar, contact 032 12 345 67', [])
    expect(text).not.toContain('032 12 345 67')
  })
})

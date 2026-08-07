import { describe, expect, it } from 'vitest'
import { parseFrenchNumber } from './frenchNumbers'
import { parseEnglishNumber } from './englishNumbers'
import { extractClinical } from './clinicalExtract'
import { EN_LOCALE, FR_LOCALE, clinicalLocaleFor } from './clinicalLocales'

describe('parseFrenchNumber', () => {
  it('reads digits with either decimal separator', () => {
    expect(parseFrenchNumber('38,5')).toBe(38.5)
    expect(parseFrenchNumber('38.5')).toBe(38.5)
    expect(parseFrenchNumber('120')).toBe(120)
  })

  it('reads spoken French numerals', () => {
    expect(parseFrenchNumber('trente-huit virgule cinq')).toBe(38.5)
    expect(parseFrenchNumber('vingt et un')).toBe(21)
    expect(parseFrenchNumber('cent vingt')).toBe(120)
  })

  it('handles the 70/80/90 compounds that trip naive parsers', () => {
    expect(parseFrenchNumber('soixante-dix')).toBe(70)
    expect(parseFrenchNumber('soixante-quinze')).toBe(75)
    expect(parseFrenchNumber('quatre-vingts')).toBe(80)
    expect(parseFrenchNumber('quatre-vingt-douze')).toBe(92)
    expect(parseFrenchNumber('quatre-vingt-dix-sept')).toBe(97)
  })

  it('treats the decimal tail as digits, not a fraction', () => {
    // "virgule vingt-cinq" is .25, never .0025
    expect(parseFrenchNumber('trente-huit virgule vingt-cinq')).toBe(38.25)
  })

  it('understands halves', () => {
    expect(parseFrenchNumber('trente-huit et demi')).toBe(38.5)
  })

  it('rejects non-numbers instead of guessing', () => {
    expect(parseFrenchNumber('bonjour')).toBeUndefined()
    expect(parseFrenchNumber('et')).toBeUndefined()
    expect(parseFrenchNumber('')).toBeUndefined()
  })
})

describe('extractClinical', () => {
  const dictation =
    'Motif: fièvre depuis trois jours. Température trente-huit virgule cinq, ' +
    'pouls quatre-vingt-douze, tension douze sur huit, poids soixante-cinq. ' +
    'Diagnostic: paludisme simple. Prescrire paracétamol 500 mg trois fois par jour ' +
    'pendant cinq jours et artéméther luméfantrine matin et soir pendant trois jours.'

  it('extracts spoken vitals', () => {
    const r = extractClinical(dictation)
    expect(r.vitals.temperature?.value).toBe(38.5)
    expect(r.vitals.pulse?.value).toBe(92)
    expect(r.vitals.weight?.value).toBe(65)
  })

  it('converts French cmHg blood pressure to mmHg', () => {
    const r = extractClinical(dictation)
    expect(r.vitals.systolic?.value).toBe(120)
    expect(r.vitals.diastolic?.value).toBe(80)
    // Unit inference is an assumption, so it must not claim full confidence.
    expect(r.vitals.systolic?.confidence).toBeLessThan(0.9)
  })

  it('leaves already-mmHg blood pressure alone', () => {
    const r = extractClinical('Tension 140 sur 90.')
    expect(r.vitals.systolic?.value).toBe(140)
    expect(r.vitals.diastolic?.value).toBe(90)
  })

  it('does not let one drug steal the next drug\'s frequency', () => {
    const r = extractClinical(dictation)
    const para = r.prescriptions.find((p) => p.drug.toLowerCase().startsWith('parac'))
    // "matin et soir" belongs to the ACT that follows, not to the paracetamol.
    expect(para?.frequencyPerDay).toBe(3)
    expect(para?.durationDays).toBe(5)
    expect(para?.dose).toBe('500 mg')
  })

  it('keeps a fixed-dose combination as a single prescription', () => {
    const r = extractClinical(dictation)
    expect(r.prescriptions).toHaveLength(2)
    const act = r.prescriptions[1]!
    expect(act.drug.toLowerCase()).toContain('luméfantrine')
    expect(act.frequencyPerDay).toBe(2)
    expect(act.durationDays).toBe(3)
  })

  it('converts an interval to a daily frequency', () => {
    const r = extractClinical('Donner amoxicilline 250 mg toutes les huit heures pendant une semaine.')
    const amox = r.prescriptions[0]!
    expect(amox.frequencyPerDay).toBe(3)
    expect(amox.durationDays).toBe(7)
  })

  it('pulls out complaint and diagnosis', () => {
    const r = extractClinical(dictation)
    expect(r.chiefComplaint?.value).toBe('fièvre depuis trois jours')
    expect(r.diagnosis?.value).toBe('paludisme simple')
  })

  it('stops a narrative field at the next section, without punctuation', () => {
    // How OCR and most speech recognisers actually deliver text: no full stops.
    const r = extractClinical(
      'Motif fievre depuis trois jours Temperature 38.9 Diagnostic paludisme simple ' +
        'Paracetamol 500 mg 3 fois par jour pendant 5 jours',
    )
    expect(r.chiefComplaint?.value).toBe('fievre depuis trois jours')
    expect(r.diagnosis?.value).toBe('paludisme simple')
    expect(r.vitals.temperature?.value).toBe(38.9)
    expect(r.prescriptions[0]!.frequencyPerDay).toBe(3)
  })

  it('does not let a diagnosis swallow the prescription that follows it', () => {
    const r = extractClinical('Diagnostic pneumonie Amoxicilline 250 mg 3 fois par jour')
    expect(r.diagnosis?.value).toBe('pneumonie')
    expect(r.prescriptions).toHaveLength(1)
  })

  it('rejects physiologically impossible readings rather than recording them', () => {
    // A recogniser dropping the decimal turns 38.5 into 385.
    const r = extractClinical('Température 385.')
    expect(r.vitals.temperature).toBeUndefined()
  })

  it('never invents a drug that was not dictated', () => {
    const r = extractClinical('Le patient a mal à la tête depuis hier.')
    expect(r.prescriptions).toHaveLength(0)
  })

  it('returns clean leftover prose without punctuation debris', () => {
    const r = extractClinical('Patient se plaint de toux. Température 37.2, saturation 89.')
    expect(r.remainder).not.toMatch(/[.,;:]\s*[.,;:]/)
    expect(r.remainder.trim()).toBe(r.remainder)
  })

  it('scores a fully-specified prescription above a bare drug name', () => {
    const full = extractClinical('paracétamol 500 mg trois fois par jour pendant cinq jours')
    const bare = extractClinical('paracétamol')
    expect(full.prescriptions[0]!.confidence).toBeGreaterThan(bare.prescriptions[0]!.confidence)
  })
})

describe('parseEnglishNumber', () => {
  it('reads digits and spoken numerals', () => {
    expect(parseEnglishNumber('38.5')).toBe(38.5)
    expect(parseEnglishNumber('thirty eight point five')).toBe(38.5)
    expect(parseEnglishNumber('thirty-eight')).toBe(38)
    expect(parseEnglishNumber('one hundred and twenty')).toBe(120)
  })

  it('treats the decimal tail as digits, not a fraction', () => {
    expect(parseEnglishNumber('thirty eight point twenty five')).toBe(38.25)
  })

  it('understands halves', () => {
    expect(parseEnglishNumber('thirty eight and a half')).toBe(38.5)
  })

  it('rejects non-numbers instead of guessing', () => {
    expect(parseEnglishNumber('hello')).toBeUndefined()
    expect(parseEnglishNumber('')).toBeUndefined()
  })
})

describe('extractClinical, English', () => {
  const dictation =
    'Chief complaint fever for three days. Temperature thirty eight point five, ' +
    'pulse ninety two, blood pressure 120 over 80, weight sixty five. ' +
    'Diagnosis malaria. Give paracetamol 500 mg tds for 5 days and ' +
    'artemether lumefantrine bd for three days.'

  it('extracts spoken vitals', () => {
    const r = extractClinical(dictation, EN_LOCALE)
    expect(r.vitals.temperature?.value).toBe(38.5)
    expect(r.vitals.pulse?.value).toBe(92)
    expect(r.vitals.weight?.value).toBe(65)
    expect(r.vitals.systolic?.value).toBe(120)
    expect(r.vitals.diastolic?.value).toBe(80)
  })

  it('reads Commonwealth dosing abbreviations', () => {
    const r = extractClinical(dictation, EN_LOCALE)
    const para = r.prescriptions.find((p) => /paracetamol/i.test(p.drug))!
    expect(para.frequencyPerDay).toBe(3)   // tds
    expect(para.durationDays).toBe(5)
    expect(para.dose).toBe('500 mg')

    const act = r.prescriptions.find((p) => /lumefantrine/i.test(p.drug))!
    expect(act.frequencyPerDay).toBe(2)    // bd
    expect(act.durationDays).toBe(3)
  })

  it('reads the x/7 duration shorthand used on charts', () => {
    const r = extractClinical('Give amoxicillin 250 mg tds for 5/7', EN_LOCALE)
    expect(r.prescriptions[0]!.durationDays).toBe(5)
  })

  it('converts an interval to a daily frequency', () => {
    const r = extractClinical('Give amoxicillin 250 mg every 8 hours for one week', EN_LOCALE)
    expect(r.prescriptions[0]!.frequencyPerDay).toBe(3)
    expect(r.prescriptions[0]!.durationDays).toBe(7)
  })

  it('pulls out complaint and diagnosis', () => {
    const r = extractClinical(dictation, EN_LOCALE)
    expect(r.chiefComplaint?.value).toBe('fever for three days')
    expect(r.diagnosis?.value).toBe('malaria')
  })

  it('does NOT apply the French cmHg conversion to English readings', () => {
    // "12 over 8" in English is an implausible reading to question, not a
    // cmHg convention to silently multiply by ten.
    const r = extractClinical('Blood pressure 12 over 8', EN_LOCALE)
    expect(r.vitals.systolic).toBeUndefined()
  })

  it('keeps a fixed-dose combination as a single prescription', () => {
    const r = extractClinical('Give artemether lumefantrine bd for 3 days', EN_LOCALE)
    expect(r.prescriptions).toHaveLength(1)
  })

  it('rejects physiologically impossible readings', () => {
    expect(extractClinical('Temperature 385', EN_LOCALE).vitals.temperature).toBeUndefined()
  })

  it('never invents a drug that was not dictated', () => {
    expect(extractClinical('Patient has a headache since yesterday', EN_LOCALE).prescriptions).toHaveLength(0)
  })
})

describe('locale selection', () => {
  it('uses English only for the English interface', () => {
    expect(clinicalLocaleFor('en')).toBe(EN_LOCALE)
    expect(clinicalLocaleFor('fr')).toBe(FR_LOCALE)
  })

  it('falls back to French for Malagasy, which has no clinical pack', () => {
    // Clinical documentation in Madagascar is written in French anyway.
    expect(clinicalLocaleFor('mg')).toBe(FR_LOCALE)
  })

  it('pairs each pack with a matching recogniser language', () => {
    expect(EN_LOCALE.speechLang).toBe('en-US')
    expect(FR_LOCALE.speechLang).toBe('fr-FR')
  })
})

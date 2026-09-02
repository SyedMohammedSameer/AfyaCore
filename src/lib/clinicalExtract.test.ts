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

/**
 * The examples printed in the README, asserted verbatim.
 *
 * A README that claims a specific dictation produces specific fields is a
 * promise, and the cheapest way to stop it rotting is to make the build fail
 * when it stops being true. If either of these is edited, edit the README too.
 */
describe('README examples', () => {
  it('produces what the French example claims', () => {
    const r = extractClinical(
      'Motif : fièvre depuis trois jours. Température trente-huit virgule cinq, ' +
        'pouls quatre-vingt-douze, tension douze sur huit. Diagnostic : paludisme simple. ' +
        'Paracétamol 500 mg trois fois par jour pendant cinq jours et ' +
        'artéméther luméfantrine matin et soir pendant trois jours.',
      FR_LOCALE,
    )

    expect(r.vitals.temperature?.value).toBe(38.5)
    expect(r.vitals.pulse?.value).toBe(92)
    expect(r.vitals.systolic?.value).toBe(120)
    expect(r.vitals.diastolic?.value).toBe(80)
    expect(r.chiefComplaint?.value).toContain('fièvre')
    expect(r.diagnosis?.value).toContain('paludisme')

    // Two prescriptions, not three: the fixed-dose combination stays whole.
    expect(r.prescriptions).toHaveLength(2)
    const para = r.prescriptions.find((p) => /paracétamol/i.test(p.drug))!
    expect(para.dose).toBe('500 mg')
    expect(para.frequencyPerDay).toBe(3)
    expect(para.durationDays).toBe(5)
    const al = r.prescriptions.find((p) => /artéméther/i.test(p.drug))!
    expect(al.frequencyPerDay).toBe(2)
    expect(al.durationDays).toBe(3)
  })

  it('produces the same fields from the English example', () => {
    const r = extractClinical(
      'Presenting complaint fever for three days. Temperature thirty-eight point five, ' +
        'pulse ninety-two, blood pressure 120 over 80. Diagnosis uncomplicated malaria. ' +
        'Paracetamol 500 mg tds for 5/7 and artemether lumefantrine bd for three days.',
      EN_LOCALE,
    )

    expect(r.vitals.temperature?.value).toBe(38.5)
    expect(r.vitals.pulse?.value).toBe(92)
    expect(r.vitals.systolic?.value).toBe(120)
    expect(r.vitals.diastolic?.value).toBe(80)
    expect(r.chiefComplaint?.value).toContain('fever')
    expect(r.diagnosis?.value).toContain('malaria')

    expect(r.prescriptions).toHaveLength(2)
    const para = r.prescriptions.find((p) => /paracetamol/i.test(p.drug))!
    expect(para.dose).toBe('500 mg')
    expect(para.frequencyPerDay).toBe(3) // tds
    expect(para.durationDays).toBe(5) // 5/7
    const al = r.prescriptions.find((p) => /artemether/i.test(p.drug))!
    expect(al.frequencyPerDay).toBe(2) // bd
    expect(al.durationDays).toBe(3)
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

/**
 * Unit words that begin with a number word.
 *
 * Found by the eval harness rather than by anyone reading the code, because the
 * failure mode is a *missing* field rather than a visibly wrong one: the number
 * run swallowed the unit, the value came out two orders of magnitude too large,
 * and the plausibility check quietly discarded it. Every French height dictated
 * in centimetres was lost this way.
 */
describe('number runs stop at a word boundary', () => {
  it('reads a French height in centimetres', () => {
    // "cent" is a number word and "centimetres" starts with it.
    const result = extractClinical('taille quatre-vingt-quinze centimètres', FR_LOCALE)
    expect(result.vitals.height?.value).toBe(95)
  })

  it('reads a three-digit French height in centimetres', () => {
    const result = extractClinical('taille cent soixante centimètres', FR_LOCALE)
    expect(result.vitals.height?.value).toBe(160)
  })

  it('still reads a height given in digits', () => {
    expect(extractClinical('taille 95 centimètres', FR_LOCALE).vitals.height?.value).toBe(95)
  })

  it('does not let a unit word inflate a weight', () => {
    const result = extractClinical('poids quatre-vingts kilos', FR_LOCALE)
    expect(result.vitals.weight?.value).toBe(80)
  })

  it('reads an English height in centimetres', () => {
    const result = extractClinical('height one hundred and seventy two centimetres', EN_LOCALE)
    expect(result.vitals.height?.value).toBe(172)
  })
})

describe('cardiometabolic formulary', () => {
  it('recognises amlodipine, which hypertension follow-up runs on', () => {
    const result = extractClinical('Amlodipine 5 mg od for 30/7.', EN_LOCALE)
    expect(result.prescriptions[0]).toMatchObject({
      drug: expect.stringMatching(/amlodipine/i),
      frequencyPerDay: 1,
      durationDays: 30,
    })
  })

  it('recognises metformin', () => {
    const result = extractClinical('Metformin 500 mg bd.', EN_LOCALE)
    expect(result.prescriptions[0]?.drug).toMatch(/metformin/i)
  })
})

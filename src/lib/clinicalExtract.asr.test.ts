/**
 * The extractor against what the speech model actually writes.
 *
 * Every transcript here is verbatim output of the vendored whisper-base pack
 * over a spoken corpus case (`npm run eval:asr`), not a sentence written to
 * pass. The first run of that harness scored 36% field F1 in French against
 * 100% on clean text, and these are the failure shapes it found: commas where
 * full stops were spoken, drug names spelt phonetically, trigger words
 * dropped or misheard, Commonwealth shorthand said aloud. Each test pins the
 * recovery so a later change to the rules cannot quietly give it back.
 */
import { describe, expect, it } from 'vitest'
import { extractClinical } from './clinicalExtract'
import { EN_LOCALE, FR_LOCALE } from './clinicalLocales'

const fr = (text: string) => extractClinical(text, FR_LOCALE)
const en = (text: string) => extractClinical(text, EN_LOCALE)

describe('French, as transcribed', () => {
  it('stops a diagnosis at the comma the recogniser put where the full stop was', () => {
    const r = fr(
      'Motif fièvre depuis trois jours, température 38,5, pougat revendouse, tension 12 ou 8, diagnostic paludisme simple, paraissait à mol 500 mg trois fois par jour pendant cinq jours.',
    )
    expect(r.chiefComplaint?.value).toBe('fièvre depuis trois jours')
    expect(r.diagnosis?.value).toBe('paludisme simple')
    expect(r.vitals.temperature?.value).toBe(38.5)
  })

  it('recovers paracétamol from "paraissait à mol" because a dose and a schedule follow it', () => {
    const r = fr('diagnostic paludisme simple, paraissait à mol 500 mg trois fois par jour pendant cinq jours.')
    expect(r.prescriptions).toHaveLength(1)
    const [p] = r.prescriptions
    expect(p!.drug).toBe('paracetamol')
    expect(p!.dose).toBe('500 mg')
    expect(p!.frequencyPerDay).toBe(3)
    expect(p!.durationDays).toBe(5)
    expect(p!.recovered).toBe(true)
    // Below the review threshold: it is flagged, and per-field review makes
    // the clinician tick it with the raw phrase in view.
    expect(p!.confidence).toBeLessThan(0.8)
    expect(p!.rawText).toContain('paraissait à mol')
  })

  it('recovers two misspelt drugs and keeps their schedules apart', () => {
    const r = fr(
      'A mux ici une 500mg 3 fois par jour pendant 7 jours et par assez tamol un gé 2 fois par jour pendant 3 jours.',
    )
    expect(r.prescriptions.map((p) => p.drug)).toEqual(['amoxicilline', 'paracetamol'])
    expect(r.prescriptions[0]).toMatchObject({ dose: '500 mg', frequencyPerDay: 3, durationDays: 7 })
    expect(r.prescriptions[1]).toMatchObject({ frequencyPerDay: 2, durationDays: 3 })
  })

  it('recovers a fixed-dose combination split into four words', () => {
    const r = fr('Diagnostique Paludisme, artémété Lume et Fantrine matin et soir pendant trois jours.')
    expect(r.diagnosis?.value).toBe('Paludisme')
    expect(r.prescriptions).toHaveLength(1)
    expect(r.prescriptions[0]).toMatchObject({
      drug: 'artemether lumefantrine',
      frequencyPerDay: 2,
      durationDays: 3,
      recovered: true,
    })
  })

  it('reads "attention" as the blood pressure trigger it was', () => {
    const r = fr('Attention 133 sur 85, pouquette 28.')
    expect(r.vitals.systolic?.value).toBe(133)
    expect(r.vitals.diastolic?.value).toBe(85)
  })

  it('takes a weight and a height from their units when the trigger word was lost', () => {
    const r = fr('12,4 kg, taille 95 cm.')
    expect(r.vitals.weight?.value).toBe(12.4)
    expect(r.vitals.weight?.confidence).toBeLessThan(0.8)
    expect(r.vitals.height?.value).toBe(95)
  })

  it('drops the trailing comma a recogniser leaves on a complaint', () => {
    const r = fr('Motif tout est fièvre depuis cinq jours, température 39, diagnostique infection respiratoire basse, amoxicilline âgée trois fois par jour pendant sept jours.')
    expect(r.chiefComplaint?.value).toBe('tout est fièvre depuis cinq jours')
    expect(r.diagnosis?.value).toBe('infection respiratoire basse')
    expect(r.prescriptions[0]).toMatchObject({ drug: 'amoxicilline', frequencyPerDay: 3, durationDays: 7 })
  })
})

describe('French, guards', () => {
  it('never turns a number word into a drug, however close its letters', () => {
    // "quinze" is two edits from "quinine".
    const r = fr('Paracétamol 500 mg trois fois par jour pendant quinze jours.')
    expect(r.prescriptions.map((p) => p.drug)).toEqual(['Paracétamol'])
  })

  it('never turns an ordinary word into a drug without a dose or schedule after it', () => {
    const r = fr('Diagnostic parasitose intestinale, anémie modérée.')
    expect(r.prescriptions).toEqual([])
    expect(r.diagnosis?.value).toBe('parasitose intestinale, anémie modérée')
  })

  it('leaves a complaint with a clause after the comma whole', () => {
    const r = fr('Motif fièvre depuis trois jours, frissons et céphalées. Diagnostic paludisme simple.')
    expect(r.chiefComplaint?.value).toBe('fièvre depuis trois jours, frissons et céphalées')
  })

  it('prefers an exact formulary match over a fuzzy one for the same span', () => {
    const r = fr('Amoxicilline 500 mg trois fois par jour pendant sept jours.')
    expect(r.prescriptions).toHaveLength(1)
    expect(r.prescriptions[0]!.recovered).toBeUndefined()
    expect(r.prescriptions[0]!.confidence).toBe(1)
  })
})

describe('English, as transcribed', () => {
  it('reads "presenting complained" and "5 stroke 7"', () => {
    const r = en(
      'presenting complained fever for three days. Temperature 38.5, pulse 92, blood pressure 120 over 80, diagnosis and complicated malaria, paracetamol 500 mg TDS for 5 stroke 7.',
    )
    expect(r.chiefComplaint?.value).toBe('fever for three days')
    expect(r.vitals).toMatchObject({
      temperature: { value: 38.5 },
      pulse: { value: 92 },
      systolic: { value: 120 },
      diastolic: { value: 80 },
    })
    expect(r.prescriptions[0]).toMatchObject({
      drug: 'paracetamol',
      dose: '500 mg',
      frequencyPerDay: 3,
      durationDays: 5,
    })
  })

  it('recovers three misspelt drugs with their shorthand schedules', () => {
    const r = en(
      'A Moxysilin 500mg TDS for 7 stroke 7, Metranidazole 400mg BD for 5 stroke 7, folic acid 5mg odd for 30 stroke 7,',
    )
    expect(r.prescriptions.map((p) => p.drug)).toEqual(['amoxicillin', 'metronidazole', 'folic acid'])
    expect(r.prescriptions[0]).toMatchObject({ dose: '500 mg', frequencyPerDay: 3, durationDays: 7 })
    expect(r.prescriptions[1]).toMatchObject({ dose: '400 mg', frequencyPerDay: 2, durationDays: 5 })
    expect(r.prescriptions[2]).toMatchObject({ dose: '5 mg', frequencyPerDay: 1, durationDays: 30 })
  })

  it('reads "BD4-3-stroke 7" as twice a day for three days', () => {
    const r = en('Artemitha lumephantrine BD4-3-stroke 7 and paracetamol 1 gram TDS4-3-stroke 7.')
    expect(r.prescriptions.map((p) => p.drug)).toEqual(['artemether lumefantrine', 'paracetamol'])
    expect(r.prescriptions[0]).toMatchObject({ frequencyPerDay: 2, durationDays: 3, recovered: true })
    expect(r.prescriptions[1]).toMatchObject({ frequencyPerDay: 3, durationDays: 3 })
  })
})

import { describe, expect, it } from 'vitest'
import { toFhirBundle } from './fhir'
import { aggregateMonth, ageBand, classifyDiagnosis, dhis2Period, toDhis2DataValueSet } from './dhis2'
import type { Encounter, Patient } from '../db/schema'

const patient = (over: Partial<Patient> = {}): Patient => ({
  id: 'p1',
  givenName: 'Voahirana',
  familyName: 'RAKOTOARISOA',
  sex: 'female',
  approximateAge: 34,
  preferredLang: 'mg',
  searchKey: 'rakotoarisoa voahirana',
  createdAt: 0,
  updatedAt: 0,
  ...over,
})

const encounter = (over: Partial<Encounter> = {}): Encounter => ({
  id: 'e1',
  patientId: 'p1',
  occurredAt: Date.UTC(2026, 7, 3, 9, 0),
  vitals: {},
  prescriptions: [],
  provenance: {},
  attachmentIds: [],
  status: 'final',
  createdAt: 0,
  updatedAt: 0,
  ...over,
})

const find = (bundle: ReturnType<typeof toFhirBundle>, type: string) =>
  bundle.entry.filter((e) => e.resource.resourceType === type).map((e) => e.resource)

describe('FHIR export', () => {
  it('emits Patient with name, gender and register identifier', () => {
    const b = toFhirBundle([patient({ registerNo: '2041' })], [])
    const p = find(b, 'Patient')[0]!
    expect(p.gender).toBe('female')
    expect((p.name as { family: string }[])[0]!.family).toBe('RAKOTOARISOA')
    expect((p.identifier as { value: string }[])[0]!.value).toBe('2041')
  })

  it('preserves approximate age when no birth date exists', () => {
    const p = find(toFhirBundle([patient()], []), 'Patient')[0]!
    expect(p.extension).toEqual([{ url: 'urn:afyacore:approximateAgeYears', valueInteger: 34 }])
  })

  it('codes vitals with LOINC and UCUM units', () => {
    const b = toFhirBundle([patient()], [encounter({ vitals: { temperature: 38.5 } })])
    const obs = find(b, 'Observation')[0]!
    const code = obs.code as { coding: { code: string }[] }
    expect(code.coding[0]!.code).toBe('8310-5')
    expect(obs.valueQuantity).toMatchObject({ value: 38.5, code: 'Cel' })
  })

  it('emits blood pressure as one panel with two components', () => {
    const b = toFhirBundle([patient()], [encounter({ vitals: { systolic: 120, diastolic: 80 } })])
    const obs = find(b, 'Observation')
    expect(obs).toHaveLength(1)
    const panel = obs[0]!
    expect((panel.code as { coding: { code: string }[] }).coding[0]!.code).toBe('85354-9')
    expect(panel.component).toHaveLength(2)
  })

  it('maps prescription frequency and duration into FHIR timing', () => {
    const b = toFhirBundle(
      [patient()],
      [
        encounter({
          prescriptions: [
            { id: 'rx1', drug: 'paracétamol', dose: '500 mg', frequencyPerDay: 3, durationDays: 5 },
          ],
        }),
      ],
    )
    const rx = find(b, 'MedicationRequest')[0]!
    const dosage = (rx.dosageInstruction as Record<string, any>[])[0]!
    expect(dosage.timing.repeat.frequency).toBe(3)
    expect(dosage.timing.repeat.period).toBe(1)
    expect(dosage.timing.repeat.boundsDuration.value).toBe(5)
  })

  it('excludes draft encounters so unconfirmed records never leave the device', () => {
    const b = toFhirBundle([patient()], [encounter({ status: 'draft', vitals: { temperature: 38 } })])
    expect(find(b, 'Encounter')).toHaveLength(0)
    expect(find(b, 'Observation')).toHaveLength(0)
  })

  it('links every observation back to its patient and encounter', () => {
    const b = toFhirBundle([patient()], [encounter({ vitals: { pulse: 92 } })])
    const obs = find(b, 'Observation')[0]!
    expect(obs.subject).toEqual({ reference: 'Patient/p1' })
    expect(obs.encounter).toEqual({ reference: 'Encounter/e1' })
  })
})

describe('DHIS2 aggregate', () => {
  it('bands ages to WHO/IMCI cuts', () => {
    expect(ageBand(0)).toBe('<1')
    expect(ageBand(3)).toBe('1-4')
    expect(ageBand(14)).toBe('5-14')
    expect(ageBand(34)).toBe('15-49')
    expect(ageBand(70)).toBe('50+')
    expect(ageBand(undefined)).toBe('unknown')
  })

  it('classifies French diagnoses to indicators', () => {
    expect(classifyDiagnosis('paludisme simple')).toBe('malaria')
    expect(classifyDiagnosis('pneumonie')).toBe('ari')
    expect(classifyDiagnosis('diarrhée aiguë')).toBe('diarrhoea')
    expect(classifyDiagnosis('hypertension artérielle')).toBe('hypertension')
  })

  it('falls back to `other` rather than forcing a bucket', () => {
    expect(classifyDiagnosis('entorse de la cheville')).toBe('other')
    expect(classifyDiagnosis(undefined)).toBe('other')
  })

  it('formats the DHIS2 monthly period', () => {
    expect(dhis2Period(new Date(2026, 7, 15))).toBe('202608')
    expect(dhis2Period(new Date(2026, 11, 1))).toBe('202612')
  })

  it('counts each consultation once plus its indicator', () => {
    const cells = aggregateMonth(
      [patient()],
      [encounter({ diagnosis: 'paludisme simple' })],
      new Date(2026, 7, 1),
    )
    const total = cells.find((c) => c.indicator === 'consultations')
    const malaria = cells.find((c) => c.indicator === 'malaria')
    expect(total?.count).toBe(1)
    expect(malaria?.count).toBe(1)
    expect(malaria?.ageBand).toBe('15-49')
  })

  it('ignores encounters outside the reporting month', () => {
    const cells = aggregateMonth(
      [patient()],
      [encounter({ occurredAt: Date.UTC(2026, 5, 3) })],
      new Date(2026, 7, 1),
    )
    expect(cells).toHaveLength(0)
  })

  it('excludes drafts from national statistics', () => {
    const cells = aggregateMonth(
      [patient()],
      [encounter({ status: 'draft', diagnosis: 'paludisme' })],
      new Date(2026, 7, 1),
    )
    expect(cells).toHaveLength(0)
  })

  it('bands age as at the encounter, not as at export time', () => {
    // Born ~2022; an encounter in Aug 2026 must land in 1-4, even though the
    // child is older by the time a later report is run.
    const child = patient({ id: 'p2', birthDate: '2022-06-01', approximateAge: undefined })
    const cells = aggregateMonth(
      [child],
      [encounter({ patientId: 'p2', occurredAt: Date.UTC(2026, 7, 3) })],
      new Date(2026, 7, 1),
    )
    expect(cells[0]!.ageBand).toBe('1-4')
  })

  it('flags placeholder mapping so it is never mistaken for a live feed', () => {
    const out = toDhis2DataValueSet([patient()], [encounter()], new Date(2026, 7, 1))
    expect(out._placeholderMapping).toBe(true)
    expect(out.period).toBe('202608')
    expect(out._readable.length).toBeGreaterThan(0)
  })
})

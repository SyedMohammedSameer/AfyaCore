/**
 * An unconfirmed machine value must not leave the device or become a statistic.
 *
 * Named after the failure it exists to stop, like the other regression suites
 * here. `finaliseEncounter` guards the moment a draft becomes final, and that
 * was the only guard: an amendment writes into a record that is *already*
 * final, so a photo read during a correction put an unconfirmed weight into a
 * research export and an unconfirmed diagnosis into the district's malaria
 * figure. Both are checked here against the real export and aggregate paths
 * rather than against the helper, because the helper was never the thing that
 * was wrong.
 */
import { describe, expect, it } from 'vitest'
import { deidentify } from './deidentify'
import { aggregateMonth, toAggregateCsv } from './dhis2'
import { pendingReviews, withholdPendingFields } from './fieldReview'
import { toFhirBundle } from './fhir'
import { fieldSignature } from './fieldReview'
import { setCurrentActor } from './audit'
import type { Encounter, Patient } from '../db/schema'

setCurrentActor('test-admin', 'admin')

const patient: Patient = {
  id: 'p1', familyName: 'RAKOTO', givenName: 'Hery', sex: 'male', preferredLang: 'mg',
  approximateAge: 40, searchKey: 'rakoto hery', createdAt: 0, updatedAt: 0,
  researchConsent: 'granted',
}

/** A confirmed consultation that a correction added machine values to. */
function amended(over: Partial<Encounter> = {}): Encounter {
  return {
    id: 'e1', patientId: 'p1', occurredAt: Date.now(),
    chiefComplaint: 'fièvre',
    vitals: { temperature: 38.2, weight: 54 },
    diagnosis: 'paludisme simple',
    prescriptions: [{ id: 'rx1', drug: 'artéméther luméfantrine', dose: '20/120 mg', frequencyPerDay: 2, durationDays: 3 }],
    provenance: {
      // Typed by the clinician when the record was first confirmed.
      'vitals.temperature': { source: 'manual' },
      chiefComplaint: { source: 'manual' },
      // Added later by a photo, during a correction. Nobody has ticked these.
      'vitals.weight': { source: 'photo', confidence: 0.7, rawText: 'poids 54' },
      diagnosis: { source: 'photo', confidence: 0.7, rawText: 'palu' },
      'prescription.rx1': { source: 'photo', confidence: 0.6, rawText: 'arteméther' },
    },
    attachmentIds: [], status: 'final', createdAt: 0, updatedAt: 0,
    ...over,
  }
}

/** The same record after a clinician ticked every machine value. */
function reviewed(): Encounter {
  const e = amended()
  const at = Date.now()
  e.fieldReviews = Object.fromEntries(
    pendingReviews(e).map((key) => [key, { signature: fieldSignature(e, key), at, by: 'clin_1' }]),
  )
  return e
}

const options = { level: 'pseudonymous' as const, salt: 'test-salt', country: 'MG' }

describe('withholdPendingFields', () => {
  it('removes only the unconfirmed machine values and leaves the confirmed record intact', () => {
    const { encounter, withheld } = withholdPendingFields(amended())
    expect(withheld.sort()).toEqual(['diagnosis', 'prescription.rx1', 'vitals.weight'])
    // What a human confirmed survives untouched.
    expect(encounter.vitals.temperature).toBe(38.2)
    expect(encounter.chiefComplaint).toBe('fièvre')
    // What nobody confirmed is gone, provenance included.
    expect(encounter.vitals.weight).toBeUndefined()
    expect(encounter.diagnosis).toBeUndefined()
    expect(encounter.prescriptions).toEqual([])
    expect(encounter.provenance['vitals.weight']).toBeUndefined()
  })

  it('does not mutate the record the clinician is still holding', () => {
    const original = amended()
    withholdPendingFields(original)
    expect(original.vitals.weight).toBe(54)
    expect(original.diagnosis).toBe('paludisme simple')
    expect(original.prescriptions).toHaveLength(1)
  })

  it('returns the record unchanged once every machine value is ticked', () => {
    const { encounter, withheld } = withholdPendingFields(reviewed())
    expect(withheld).toEqual([])
    expect(encounter.diagnosis).toBe('paludisme simple')
    expect(encounter.vitals.weight).toBe(54)
  })
})

describe('exports', () => {
  it('does not export an unconfirmed weight, diagnosis or prescription', async () => {
    const out = await deidentify([patient], [amended()], options)
    const e = out.encounters[0]!
    expect(e.vitals.weight).toBeUndefined()
    expect(e.diagnosis).toBeUndefined()
    expect(e.prescriptions).toEqual([])
    // The confirmed half of the same record still travels.
    expect(e.vitals.temperature).toBe(38.2)
    expect(out.manifest.withheldPendingReview).toBe(3)
  })

  it('exports everything once it has been confirmed', async () => {
    const out = await deidentify([patient], [reviewed()], options)
    expect(out.encounters[0]!.diagnosis).toBe('paludisme simple')
    expect(out.manifest.withheldPendingReview).toBe(0)
  })

  it('withholds from an identified export too, which is not a privacy rule', async () => {
    const out = await deidentify([patient], [amended()], { ...options, level: 'identified' })
    expect(out.encounters[0]!.diagnosis).toBeUndefined()
    expect(out.manifest.withheldPendingReview).toBe(3)
  })

  it('keeps the unconfirmed value out of the FHIR bundle', async () => {
    const { patients, encounters } = await deidentify([patient], [amended()], options)
    const bundle = JSON.stringify(toFhirBundle(patients, encounters))
    expect(bundle).not.toContain('paludisme')
    expect(bundle).not.toContain('luméfantrine')
  })
})

describe('the monthly return', () => {
  it('counts the consultation but not the unconfirmed malaria diagnosis', () => {
    const cells = aggregateMonth([patient], [amended()], new Date())
    const by = Object.fromEntries(cells.map((c) => [c.indicator, c.count]))
    expect(by.consultations).toBe(1)
    expect(by.malaria).toBeUndefined()
    // Counted as unattributed rather than dropped: the visit did happen.
    expect(by.other).toBe(1)
  })

  it('counts it as malaria once a clinician has confirmed the diagnosis', () => {
    const cells = aggregateMonth([patient], [reviewed()], new Date())
    expect(Object.fromEntries(cells.map((c) => [c.indicator, c.count])).malaria).toBe(1)
  })

  it('applies to the CSV a facility submits on paper as well', () => {
    expect(toAggregateCsv([patient], [amended()], new Date())).not.toContain('Paludisme')
    expect(toAggregateCsv([patient], [reviewed()], new Date())).toContain('Paludisme')
  })
})

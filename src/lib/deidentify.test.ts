import { describe, expect, it } from 'vitest'
import { bandAge, deidentify, REDACTED, scrubFreeText } from './deidentify'
import { toFhirBundle } from './fhir'
import { aggregateMonth } from './dhis2'
import type { Encounter, Patient } from '../db/schema'

const patient = (over: Partial<Patient> = {}): Patient => ({
  id: 'p1',
  givenName: 'Voahirana',
  familyName: 'RAKOTOARISOA',
  sex: 'female',
  approximateAge: 34,
  phone: '034 12 345 67',
  address: 'Ambohimanga',
  registerNo: '2041',
  preferredLang: 'mg',
  // Granted by default in this fixture so the tests below exercise
  // de-identification rather than the consent gate; the gate has its own
  // describe block, including that omitting this excludes the patient.
  researchConsent: 'granted',
  searchKey: 'rakotoarisoa voahirana',
  createdAt: 0,
  updatedAt: 0,
  ...over,
})

const encounter = (over: Partial<Encounter> = {}): Encounter => ({
  id: 'e1',
  patientId: 'p1',
  occurredAt: Date.UTC(2026, 7, 14, 9, 0),
  vitals: { temperature: 38.5 },
  prescriptions: [],
  provenance: {},
  attachmentIds: [],
  status: 'final',
  createdAt: 0,
  updatedAt: 0,
  ...over,
})

describe('scrubFreeText', () => {
  const names = ['RAKOTOARISOA', 'Voahirana', 'ANDRIANJAFY']

  it('removes roster names from a note', () => {
    const { text } = scrubFreeText('Patiente RAKOTOARISOA revue ce jour', names)
    expect(text).not.toMatch(/RAKOTOARISOA/i)
    expect(text).toContain(REDACTED)
  })

  it('matches regardless of accent and case', () => {
    const { text } = scrubFreeText('voahirana se plaint', names)
    expect(text).not.toMatch(/voahirana/i)
  })

  it('removes a name belonging to a different patient on the roster', () => {
    // Notes routinely reference relatives who are themselves patients.
    const { text } = scrubFreeText('frère de ANDRIANJAFY', names)
    expect(text).not.toMatch(/ANDRIANJAFY/i)
  })

  it('does not truncate a long name into a shorter roster match', () => {
    const { text } = scrubFreeText('RAKOTOARISOA', ['RAKOTO', 'RAKOTOARISOA'])
    expect(text).toBe(REDACTED)
  })

  it('removes phone numbers', () => {
    const { text } = scrubFreeText('joindre au 034 12 345 67', names)
    expect(text).not.toMatch(/\d{2}\s?\d{2}\s?\d{3}/)
  })

  it('removes village names, which identify in a small fokontany', () => {
    // Regression: removing the address field but leaving the village in a note
    // removes nothing. Caught by a round-trip export test, not by unit tests.
    const { text } = scrubFreeText('vit au village Ambohimanga', [...names, 'Ambohimanga'])
    expect(text).not.toMatch(/Ambohimanga/i)
  })

  it('removes register numbers, which are too short for the digit rule', () => {
    const { text } = scrubFreeText('dossier 2041 retrouvé', [...names, '2041'])
    expect(text).not.toContain('2041')
  })

  it('keeps the clinical content intact', () => {
    const { text } = scrubFreeText('fièvre depuis trois jours, paludisme simple', names)
    expect(text).toBe('fièvre depuis trois jours, paludisme simple')
  })

  it('ignores short tokens that would shred the note', () => {
    // A three-letter given name matches half the French in a sentence.
    const { text } = scrubFreeText('la toux est sèche', ['Eva'])
    expect(text).toBe('la toux est sèche')
  })
})

describe('bandAge', () => {
  it('caps ages that are identifying on their own', () => {
    expect(bandAge(34)).toBe(34)
    expect(bandAge(89)).toBe(89)
    expect(bandAge(94)).toBe(90)
    expect(bandAge(undefined)).toBeUndefined()
  })
})

describe('deidentify', () => {
  it('passes data through untouched when identified', async () => {
    const r = await deidentify([patient()], [encounter()], { level: 'identified' })
    expect(r.patients[0]!.familyName).toBe('RAKOTOARISOA')
    expect(r.patients[0]!.phone).toBe('034 12 345 67')
  })

  it('removes every direct identifier', async () => {
    const r = await deidentify([patient()], [encounter()], { level: 'pseudonymous', salt: 's' })
    const p = r.patients[0]!
    expect(p.givenName).toBe('')
    expect(p.familyName).not.toBe('RAKOTOARISOA')
    expect(p.phone).toBeUndefined()
    expect(p.address).toBeUndefined()
    expect(p.registerNo).toBeUndefined()
    expect(p.birthDate).toBeUndefined()
    expect(p.searchKey).not.toContain('rakoto')
  })

  it('keeps the clinical payload', async () => {
    const r = await deidentify([patient()], [encounter()], { level: 'pseudonymous', salt: 's' })
    expect(r.encounters[0]!.vitals.temperature).toBe(38.5)
  })

  it('gives the same patient the same code across exports with the same salt', async () => {
    const a = await deidentify([patient()], [], { level: 'pseudonymous', salt: 'facility-1' })
    const b = await deidentify([patient()], [], { level: 'pseudonymous', salt: 'facility-1' })
    expect(a.patients[0]!.id).toBe(b.patients[0]!.id)
  })

  it('breaks linkage between exports when anonymous', async () => {
    const a = await deidentify([patient()], [], { level: 'anonymous' })
    const b = await deidentify([patient()], [], { level: 'anonymous' })
    expect(a.patients[0]!.id).not.toBe(b.patients[0]!.id)
  })

  it('rewrites encounter references to the pseudonym, keeping the join valid', async () => {
    const r = await deidentify([patient()], [encounter()], { level: 'pseudonymous', salt: 's' })
    expect(r.encounters[0]!.patientId).toBe(r.patients[0]!.id)
    expect(r.encounters[0]!.patientId).not.toBe('p1')
  })

  it('drops an orphan encounter entirely when consent is required', async () => {
    // Stricter than the old behaviour, and correct: an encounter whose patient
    // is not in the roster is an encounter whose consent cannot be checked.
    // Emitting it as `UNKNOWN` published clinical narrative about somebody
    // nobody could confirm had agreed.
    const r = await deidentify([], [encounter({ patientId: 'ghost' })], {
      level: 'pseudonymous',
      salt: 's',
    })
    expect(r.encounters).toHaveLength(0)
  })

  it('never emits the original id for an orphan encounter', async () => {
    // With the gate off, the orphan still must not carry a real patient id
    // back out: a stray row would otherwise re-link the whole export.
    const r = await deidentify([], [encounter({ patientId: 'ghost' })], {
      level: 'pseudonymous',
      salt: 's',
      requireResearchConsent: false,
    })
    expect(r.encounters[0]!.patientId).toBe('UNKNOWN')
  })

  it('scrubs every roster identifier, name, village and register number', async () => {
    const r = await deidentify(
      [patient()],
      [encounter({ notes: 'RAKOTOARISOA du village Ambohimanga, dossier 2041, tel 034 12 345 67' })],
      { level: 'anonymous' },
    )
    const notes = r.encounters[0]!.notes!
    for (const secret of ['RAKOTOARISOA', 'Ambohimanga', '2041', '034 12 345 67']) {
      expect(notes).not.toContain(secret)
    }
  })

  it('scrubs names out of notes and diagnoses', async () => {
    const r = await deidentify(
      [patient()],
      [encounter({ notes: 'RAKOTOARISOA Voahirana revue', diagnosis: 'paludisme simple' })],
      { level: 'pseudonymous', salt: 's' },
    )
    expect(r.encounters[0]!.notes).not.toMatch(/RAKOTOARISOA/i)
    expect(r.encounters[0]!.diagnosis).toBe('paludisme simple')
    expect(r.manifest.freeTextRedactions).toBeGreaterThan(0)
  })

  it('scrubs the raw dictation kept in provenance', async () => {
    // Provenance stores verbatim speech and OCR, the richest source of
    // stray identifiers anywhere in the record.
    const r = await deidentify(
      [patient()],
      [
        encounter({
          provenance: {
            notes: { source: 'voice', confidence: 0.6, rawText: 'patiente RAKOTOARISOA température 38.5' },
          },
        }),
      ],
      { level: 'pseudonymous', salt: 's' },
    )
    expect(r.encounters[0]!.provenance.notes!.rawText).not.toMatch(/RAKOTOARISOA/i)
  })

  it('drops attachments, which cannot be redacted', async () => {
    const r = await deidentify([patient()], [encounter({ attachmentIds: ['a1', 'a2'] })], {
      level: 'pseudonymous',
      salt: 's',
    })
    expect(r.encounters[0]!.attachmentIds).toEqual([])
  })

  it('generalises dates to the month when anonymous', async () => {
    const r = await deidentify([patient()], [encounter()], { level: 'anonymous' })
    const d = new Date(r.encounters[0]!.occurredAt)
    expect(d.getDate()).toBe(1)
    expect(d.getMonth()).toBe(7)
  })

  it('caps identifying ages', async () => {
    const r = await deidentify([patient({ approximateAge: 96 })], [], { level: 'pseudonymous', salt: 's' })
    expect(r.patients[0]!.approximateAge).toBe(90)
  })

  it('does not mutate the caller’s records', async () => {
    const original = patient()
    await deidentify([original], [], { level: 'pseudonymous', salt: 's' })
    expect(original.familyName).toBe('RAKOTOARISOA')
    expect(original.phone).toBe('034 12 345 67')
  })
})

describe('de-identified exports', () => {
  it('produces a FHIR bundle with no identifiers in it', async () => {
    const r = await deidentify(
      [patient()],
      [encounter({ notes: 'RAKOTOARISOA vue en consultation' })],
      { level: 'pseudonymous', salt: 's' },
    )
    const json = JSON.stringify(toFhirBundle(r.patients, r.encounters))
    for (const secret of ['RAKOTOARISOA', 'Voahirana', 'Ambohimanga', '034 12 345 67', '2041']) {
      expect(json).not.toContain(secret)
    }
  })

  it('leaves monthly reporting counts unchanged', async () => {
    // De-identification must not alter the numbers a facility reports.
    const month = new Date(2026, 7, 1)
    const before = aggregateMonth([patient()], [encounter({ diagnosis: 'paludisme' })], month)
    const r = await deidentify([patient()], [encounter({ diagnosis: 'paludisme' })], {
      level: 'pseudonymous',
      salt: 's',
    })
    const after = aggregateMonth(r.patients, r.encounters, month)
    expect(after.map((c) => [c.indicator, c.count])).toEqual(before.map((c) => [c.indicator, c.count]))
  })
})

describe('consent for secondary use', () => {
  const granted = patient({ id: 'p1', researchConsent: 'granted' })
  const refused = patient({ id: 'p2', familyName: 'RABE', researchConsent: 'refused' })
  const notAsked = patient({ id: 'p3', familyName: 'RANAIVO', researchConsent: 'notAsked' })
  const absent = patient({ id: 'p4', familyName: 'RASOA', researchConsent: undefined })

  const roster = [granted, refused, notAsked, absent]
  const consultations = roster.map((p) => encounter({ id: `e-${p.id}`, patientId: p.id }))

  it('exports only the patients who agreed', async () => {
    const { patients, manifest } = await deidentify(roster, consultations, {
      level: 'pseudonymous',
    })
    expect(patients).toHaveLength(1)
    expect(manifest.excludedForConsent).toBe(3)
  })

  it('treats an absent consent as a refusal, not as permission', async () => {
    // The default that matters. A consent field whose absence reads as
    // agreement is worse than no field at all: it manufactures a record of
    // permission nobody gave. Every patient created before this feature
    // existed has no value here, and every one of them must be excluded.
    const { patients } = await deidentify([absent], [], { level: 'anonymous' })
    expect(patients).toHaveLength(0)
  })

  it('takes the encounters out with the patient', async () => {
    // Dropping the patient row and keeping the consultations would leave
    // clinical narrative attached to `UNKNOWN` — worse than either including
    // or excluding them cleanly.
    const { encounters } = await deidentify(roster, consultations, { level: 'pseudonymous' })
    expect(encounters).toHaveLength(1)
  })

  it('does not gate an identified export on research consent', async () => {
    // An identified export is a clinical act: a referral, a handover, a copy
    // for the patient. Blocking care to satisfy a rule about research would
    // be the wrong trade in both directions.
    const { patients } = await deidentify(roster, consultations, { level: 'identified' })
    expect(patients).toHaveLength(4)
  })

  it('can be turned off, but only by saying so', async () => {
    const { patients, manifest } = await deidentify(roster, consultations, {
      level: 'pseudonymous',
      requireResearchConsent: false,
    })
    expect(patients).toHaveLength(4)
    expect(manifest.excludedForConsent).toBe(0)
  })

  it('tells the recipient how many were left out', async () => {
    // In the manifest, not only the audit log. A dataset that silently
    // excludes three quarters of a catchment is biased in a way that matters
    // clinically, and a researcher cannot correct for a selection they were
    // never told about.
    const { manifest } = await deidentify(roster, consultations, { level: 'anonymous' })
    expect(manifest.excludedForConsent).toBe(3)
    expect(manifest.patientsProcessed).toBe(1)
  })
})

describe('linkage between exports', () => {
  const withPrescription = () =>
    encounter({
      id: 'enc-1',
      prescriptions: [
        {
          id: 'rx-1',
          drug: 'paracétamol',
          dose: '500 mg',
          // Free text a clinician actually types. This went into every
          // de-identified export, and into the FHIR dosage line, unscrubbed.
          notes: 'donner à sa mère RAKOTOARISOA au village Ambohimanga',
        },
      ],
    })

  it('scrubs prescription notes', async () => {
    const r = await deidentify([patient()], [withPrescription()], { level: 'anonymous' })
    const notes = r.encounters[0]!.prescriptions[0]!.notes!
    expect(notes).not.toContain('RAKOTOARISOA')
    expect(notes).not.toContain('Ambohimanga')
  })

  it('keeps the drug and the dose, which are the clinical payload', async () => {
    const r = await deidentify([patient()], [withPrescription()], { level: 'anonymous' })
    const rx = r.encounters[0]!.prescriptions[0]!
    expect(rx.drug).toBe('paracétamol')
    expect(rx.dose).toBe('500 mg')
  })

  it('does not emit the real encounter or prescription id', async () => {
    const r = await deidentify([patient()], [withPrescription()], { level: 'anonymous' })
    expect(r.encounters[0]!.id).not.toBe('enc-1')
    expect(r.encounters[0]!.prescriptions[0]!.id).not.toBe('rx-1')
  })

  it('cannot be joined across two anonymous exports on any id', async () => {
    // The property `anonymous` promises and did not have. Patient ids were
    // freshly salted per export and then every row carried a stable encounter
    // UUID, which joins the two back together in one statement.
    const a = await deidentify([patient()], [withPrescription()], { level: 'anonymous' })
    const b = await deidentify([patient()], [withPrescription()], { level: 'anonymous' })

    expect(a.patients[0]!.id).not.toBe(b.patients[0]!.id)
    expect(a.encounters[0]!.id).not.toBe(b.encounters[0]!.id)
    expect(a.encounters[0]!.prescriptions[0]!.id).not.toBe(b.encounters[0]!.prescriptions[0]!.id)
  })

  it('does not leak the exact consultation through row timestamps', async () => {
    // occurredAt was generalised to the first of the month and then createdAt
    // and updatedAt shipped beside it at millisecond precision, which both
    // re-identifies the consultation and joins exports on the same value.
    const e = encounter({ createdAt: 1_755_000_123_456, updatedAt: 1_755_000_987_654 })
    const r = await deidentify([patient()], [e], { level: 'anonymous' })
    expect(r.encounters[0]!.createdAt).not.toBe(1_755_000_123_456)
    expect(r.encounters[0]!.updatedAt).not.toBe(1_755_000_987_654)
    expect(r.patients[0]!.createdAt).toBe(0)
  })

  it('keeps links valid inside a single export', async () => {
    // Unlinkability between exports must not break the join within one:
    // an Observation still has to point at its Encounter.
    const r = await deidentify([patient()], [withPrescription()], { level: 'anonymous' })
    expect(r.encounters[0]!.patientId).toBe(r.patients[0]!.id)
  })

  it('keeps a pseudonymous export linkable across runs with the same salt', async () => {
    // The whole point of the level: a facility tracking the same patient over
    // time must still be able to, and now the encounter must line up too.
    const a = await deidentify([patient()], [withPrescription()], {
      level: 'pseudonymous',
      salt: 'fixed',
    })
    const b = await deidentify([patient()], [withPrescription()], {
      level: 'pseudonymous',
      salt: 'fixed',
    })
    expect(a.patients[0]!.id).toBe(b.patients[0]!.id)
    expect(a.encounters[0]!.id).toBe(b.encounters[0]!.id)
  })
})

/**
 * FHIR R4 export.
 *
 * The reason this exists: OpenMRS and DHIS2 are what ministries and NGOs across
 * the region already run, and a facility's data is worth far less if it cannot
 * reach national reporting. Emitting standards-compliant FHIR means integration
 * is a mapping exercise on their side rather than a migration on ours.
 *
 * Hand-written rather than pulled from a FHIR library: the resource subset we
 * need is small and fixed, and a FHIR toolkit would cost more bundle than the
 * entire application currently weighs.
 *
 * Spec references: FHIR R4 Bundle, Patient, Encounter, Observation
 * (vital-signs profile), MedicationRequest. Codes are LOINC; units are UCUM.
 */
import type { Encounter, Patient, Prescription, VitalKey } from '../db/schema'
import { patientAge } from '../db/repo'

/** LOINC code + UCUM unit for each vital we record. */
const VITAL_CODES: Record<VitalKey, { loinc: string; display: string; unit: string; ucum: string }> = {
  temperature: { loinc: '8310-5', display: 'Body temperature', unit: '°C', ucum: 'Cel' },
  pulse: { loinc: '8867-4', display: 'Heart rate', unit: '/min', ucum: '/min' },
  systolic: { loinc: '8480-6', display: 'Systolic blood pressure', unit: 'mmHg', ucum: 'mm[Hg]' },
  diastolic: { loinc: '8462-4', display: 'Diastolic blood pressure', unit: 'mmHg', ucum: 'mm[Hg]' },
  respiratoryRate: { loinc: '9279-1', display: 'Respiratory rate', unit: '/min', ucum: '/min' },
  weight: { loinc: '29463-7', display: 'Body weight', unit: 'kg', ucum: 'kg' },
  height: { loinc: '8302-2', display: 'Body height', unit: 'cm', ucum: 'cm' },
  oxygenSaturation: { loinc: '59408-5', display: 'Oxygen saturation in Arterial blood by Pulse oximetry', unit: '%', ucum: '%' },
}

/** Systolic and diastolic are components of one BP panel observation in FHIR. */
const BP_PANEL = { loinc: '85354-9', display: 'Blood pressure panel with all children optional' }

const FHIR_SEX: Record<Patient['sex'], string> = {
  female: 'female',
  male: 'male',
  unknown: 'unknown',
}

interface FhirResource {
  resourceType: string
  id: string
  [key: string]: unknown
}

interface BundleEntry {
  fullUrl: string
  resource: FhirResource
}

export interface FhirBundle {
  resourceType: 'Bundle'
  type: 'collection'
  timestamp: string
  entry: BundleEntry[]
}

function iso(ts: number): string {
  return new Date(ts).toISOString()
}

function patientResource(p: Patient): FhirResource {
  const resource: FhirResource = {
    resourceType: 'Patient',
    id: p.id,
    active: true,
    name: [{ use: 'official', family: p.familyName, given: p.givenName ? [p.givenName] : [] }],
    gender: FHIR_SEX[p.sex],
  }

  if (p.registerNo) {
    resource.identifier = [
      { use: 'usual', system: 'urn:afyacore:register', value: p.registerNo },
    ]
  }
  if (p.birthDate) resource.birthDate = p.birthDate
  if (p.phone) resource.telecom = [{ system: 'phone', value: p.phone, use: 'mobile' }]
  if (p.address) resource.address = [{ use: 'home', text: p.address, country: 'MG' }]

  resource.communication = [
    {
      language: { coding: [{ system: 'urn:ietf:bcp:47', code: p.preferredLang }] },
      preferred: true,
    },
  ]

  // Age is frequently the only thing known, and FHIR has no field for
  // "approximately 34". An extension keeps the information rather than
  // discarding it, and flags that it is an estimate rather than a birth date.
  const age = patientAge(p)
  if (!p.birthDate && age !== undefined) {
    resource.extension = [
      { url: 'urn:afyacore:approximateAgeYears', valueInteger: age },
    ]
  }

  return resource
}

function encounterResource(e: Encounter): FhirResource {
  const resource: FhirResource = {
    resourceType: 'Encounter',
    id: e.id,
    status: e.status === 'final' ? 'finished' : 'in-progress',
    class: { system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode', code: 'AMB', display: 'ambulatory' },
    subject: { reference: `Patient/${e.patientId}` },
    period: { start: iso(e.occurredAt) },
  }

  if (e.chiefComplaint) {
    resource.reasonCode = [{ text: e.chiefComplaint }]
  }
  if (e.diagnosis) {
    // Free text, not coded: the clinician types a French diagnosis and we do not
    // guess at an ICD-10 mapping. Coding it wrongly is worse than not coding it.
    resource.diagnosis = [{ use: { text: 'diagnosis' }, condition: { display: e.diagnosis } }]
  }
  return resource
}

function vitalObservation(
  e: Encounter,
  key: Exclude<VitalKey, 'systolic' | 'diastolic'>,
  value: number,
): FhirResource {
  const code = VITAL_CODES[key]
  return {
    resourceType: 'Observation',
    id: fhirId(`${e.id}-${key}`),
    status: 'final',
    category: [
      {
        coding: [
          {
            system: 'http://terminology.hl7.org/CodeSystem/observation-category',
            code: 'vital-signs',
            display: 'Vital Signs',
          },
        ],
      },
    ],
    code: { coding: [{ system: 'http://loinc.org', code: code.loinc, display: code.display }] },
    subject: { reference: `Patient/${e.patientId}` },
    encounter: { reference: `Encounter/${e.id}` },
    effectiveDateTime: iso(e.occurredAt),
    valueQuantity: {
      value,
      unit: code.unit,
      system: 'http://unitsofmeasure.org',
      code: code.ucum,
    },
  }
}

function bloodPressureObservation(e: Encounter, systolic?: number, diastolic?: number): FhirResource {
  const component: unknown[] = []
  for (const [key, value] of [
    ['systolic', systolic],
    ['diastolic', diastolic],
  ] as const) {
    if (value === undefined) continue
    const code = VITAL_CODES[key]
    component.push({
      code: { coding: [{ system: 'http://loinc.org', code: code.loinc, display: code.display }] },
      valueQuantity: { value, unit: code.unit, system: 'http://unitsofmeasure.org', code: code.ucum },
    })
  }

  return {
    resourceType: 'Observation',
    id: fhirId(`${e.id}-bp`),
    status: 'final',
    category: [
      {
        coding: [
          {
            system: 'http://terminology.hl7.org/CodeSystem/observation-category',
            code: 'vital-signs',
            display: 'Vital Signs',
          },
        ],
      },
    ],
    code: { coding: [{ system: 'http://loinc.org', code: BP_PANEL.loinc, display: BP_PANEL.display }] },
    subject: { reference: `Patient/${e.patientId}` },
    encounter: { reference: `Encounter/${e.id}` },
    effectiveDateTime: iso(e.occurredAt),
    component,
  }
}

/**
 * A FHIR-legal resource id.
 *
 * R4 constrains ids to `[A-Za-z0-9\-\.]{1,64}`
 * (https://hl7.org/fhir/R4/datatypes.html). Derived ids here are built by
 * joining a parent id to a discriminator, and with real UUIDs on an
 * *identified* export that produced 73 characters — two 36-character UUIDs and
 * a hyphen — which is over the limit and therefore not a valid resource id at
 * all. De-identified exports stayed inside it only because pseudonyms are
 * eight characters, so the bug was invisible at exactly the levels most
 * commonly exercised.
 *
 * Over-long ids are folded to a stable 32-character digest of themselves, so
 * they stay deterministic (the same record produces the same id on every
 * export) and stay inside the limit. Illegal characters are replaced rather
 * than stripped, so two different ids cannot collapse onto one.
 */
export function fhirId(raw: string): string {
  const safe = raw.replace(/[^A-Za-z0-9.-]/g, '-')
  if (safe.length <= 64) return safe

  // FNV-1a, twice with different offsets, for a 128-bit-ish stable digest.
  // Not cryptographic and does not need to be: this collapses an identifier
  // that is already in the file into a shorter form of itself.
  const fold = (seed: number) => {
    let h = seed
    for (let i = 0; i < safe.length; i++) {
      h ^= safe.charCodeAt(i)
      h = Math.imul(h, 0x01000193) >>> 0
    }
    return h.toString(16).padStart(8, '0')
  }
  return `${safe.slice(0, 40)}-${fold(0x811c9dc5)}${fold(0x9dc5811c)}`
}

function medicationRequest(e: Encounter, p: Prescription): FhirResource {
  const dosage: Record<string, unknown> = { text: [p.dose, p.notes].filter(Boolean).join(', ') || undefined }

  if (p.frequencyPerDay || p.durationDays) {
    dosage.timing = {
      repeat: {
        ...(p.frequencyPerDay ? { frequency: p.frequencyPerDay, period: 1, periodUnit: 'd' } : {}),
        ...(p.durationDays ? { boundsDuration: { value: p.durationDays, unit: 'd', system: 'http://unitsofmeasure.org', code: 'd' } } : {}),
      },
    }
  }

  return {
    resourceType: 'MedicationRequest',
    id: fhirId(`${e.id}-${p.id}`),
    status: 'active',
    intent: 'order',
    medicationCodeableConcept: { text: p.drug },
    subject: { reference: `Patient/${e.patientId}` },
    encounter: { reference: `Encounter/${e.id}` },
    authoredOn: iso(e.occurredAt),
    dosageInstruction: [dosage],
  }
}

/**
 * Build a FHIR R4 collection Bundle.
 *
 * Draft encounters are excluded by default: an unconfirmed record must not
 * escape the device as though a clinician had signed it.
 */
export function toFhirBundle(
  patients: Patient[],
  encounters: Encounter[],
  options: { includeDrafts?: boolean } = {},
): FhirBundle {
  const entry: BundleEntry[] = []
  /*
   * `urn:uuid:` requires an actual UUID.
   *
   * Every derived id here — `<encounter>-bp`, `<encounter>-<prescription>` —
   * was emitted as `urn:uuid:<not-a-uuid>`, and so was every pseudonymised id,
   * which is an eight-character code. A `urn:uuid:` URN whose payload is not a
   * UUID is malformed, and a validator rejects the bundle rather than the
   * field.
   *
   * Collection bundles allow any absolute `fullUrl`, so derived resources get
   * a URN under our own namespace and only genuine UUIDs keep `urn:uuid:`.
   * This is honest rather than fully conformant: see the note on the FHIR row
   * in the README — the bundle has not been run through the official
   * validator, and until it has, "standards-compliant" is not a claim we make.
   */
  const push = (resource: FhirResource) => {
    const id = String(resource.id)
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
    entry.push({
      fullUrl: isUuid ? `urn:uuid:${id}` : `urn:afyacore:${resource.resourceType}:${id}`,
      resource,
    })
  }

  for (const p of patients) push(patientResource(p))

  for (const e of encounters) {
    if (e.status !== 'final' && !options.includeDrafts) continue
    push(encounterResource(e))

    for (const key of Object.keys(VITAL_CODES) as VitalKey[]) {
      if (key === 'systolic' || key === 'diastolic') continue
      const value = e.vitals[key]
      if (value !== undefined) push(vitalObservation(e, key, value))
    }

    if (e.vitals.systolic !== undefined || e.vitals.diastolic !== undefined) {
      push(bloodPressureObservation(e, e.vitals.systolic, e.vitals.diastolic))
    }

    for (const p of e.prescriptions) push(medicationRequest(e, p))
  }

  return {
    resourceType: 'Bundle',
    type: 'collection',
    timestamp: new Date().toISOString(),
    entry,
  }
}

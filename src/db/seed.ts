import { db } from './db'
import { createPatient, createDraftEncounter, patchEncounter, finaliseEncounter } from './repo'
import { newId } from '../lib/id'

/**
 * Demo data for showing the app without a live facility.
 *
 * Names, villages and presentations are plausible for the Malagasy highlands;
 * the clinical content is ordinary primary-care material (malaria, respiratory
 * infection, antenatal care) rather than anything unusual. Entirely synthetic:
 * no real person is represented.
 */
export async function seedDemoData(): Promise<void> {
  const existing = await db.patients.count()
  if (existing > 0) return

  const day = 86_400_000
  const now = Date.now()

  const rasoa = await createPatient({
    familyName: 'RAKOTOARISOA', givenName: 'Voahirana', sex: 'female',
    approximateAge: 34, address: 'Ambohimanga', registerNo: '2041',
    phone: '034 12 345 67', preferredLang: 'mg', researchConsent: 'granted',
  })

  const naivo = await createPatient({
    familyName: 'ANDRIANJAFY', givenName: 'Naivo', sex: 'male',
    approximateAge: 6, address: 'Anjozorobe', registerNo: '2042', preferredLang: 'mg',
    researchConsent: 'granted',
  })

  const hery = await createPatient({
    familyName: 'RAZAFIMAHATRATRA', givenName: 'Hery', sex: 'male',
    approximateAge: 58, address: 'Ambatolampy', registerNo: '2043',
    phone: '032 98 765 43', preferredLang: 'fr', researchConsent: 'refused',
  })

  await createPatient({
    familyName: 'RANDRIAMBOLOLONA', givenName: 'Miora', sex: 'female',
    approximateAge: 22, address: 'Ambohimanga', registerNo: '2044', preferredLang: 'mg',
    // Left unasked on purpose: the demo should show what an unanswered
    // consent does to an export, which is exclude the record.
    researchConsent: 'notAsked',
  })

  // A completed malaria consultation, captured by dictation.
  const e1 = await createDraftEncounter(rasoa)
  await patchEncounter(e1, {
    occurredAt: now - 3 * day,
    chiefComplaint: 'fièvre depuis trois jours, frissons',
    diagnosis: 'paludisme simple',
    vitals: { temperature: 38.9, pulse: 96, systolic: 110, diastolic: 70, weight: 54 },
    prescriptions: [
      { id: newId(), drug: 'artéméther luméfantrine', dose: '20/120 mg', frequencyPerDay: 2, durationDays: 3 },
      { id: newId(), drug: 'paracétamol', dose: '500 mg', frequencyPerDay: 3, durationDays: 5 },
    ],
    provenance: {
      'vitals.temperature': { source: 'voice', confidence: 0.75, rawText: 'température trente-huit virgule neuf' },
      'vitals.pulse': { source: 'voice', confidence: 0.75, rawText: 'pouls quatre-vingt-seize' },
      'vitals.systolic': { source: 'voice', confidence: 0.8, rawText: 'tension onze sur sept' },
      'vitals.diastolic': { source: 'voice', confidence: 0.8, rawText: 'tension onze sur sept' },
      diagnosis: { source: 'voice', confidence: 0.8, rawText: 'diagnostic paludisme simple' },
    },
  })
  await finaliseEncounter(e1)

  // A paediatric case with an urgent vital, to exercise the triage colouring.
  const e2 = await createDraftEncounter(naivo)
  await patchEncounter(e2, {
    occurredAt: now - day,
    chiefComplaint: 'toux et difficulté à respirer',
    diagnosis: 'pneumonie',
    vitals: { temperature: 39.6, pulse: 138, respiratoryRate: 42, oxygenSaturation: 91, weight: 18 },
    prescriptions: [{ id: newId(), drug: 'amoxicilline', dose: '250 mg', frequencyPerDay: 3, durationDays: 7 }],
    provenance: {
      'vitals.respiratoryRate': { source: 'manual' },
      'vitals.oxygenSaturation': { source: 'manual' },
    },
  })
  await finaliseEncounter(e2)

  const e3 = await createDraftEncounter(hery)
  await patchEncounter(e3, {
    occurredAt: now - 10 * day,
    chiefComplaint: 'contrôle tension',
    diagnosis: 'hypertension artérielle',
    vitals: { systolic: 168, diastolic: 98, pulse: 78, weight: 71 },
    prescriptions: [{ id: newId(), drug: 'amlodipine', dose: '5 mg', frequencyPerDay: 1, durationDays: 30 }],
  })
  await finaliseEncounter(e3)
}

export async function clearAllData(): Promise<void> {
  await db.transaction('rw', db.patients, db.encounters, db.attachments, async () => {
    await Promise.all([db.patients.clear(), db.encounters.clear(), db.attachments.clear()])
  })
}

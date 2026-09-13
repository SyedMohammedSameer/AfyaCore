import { db } from './db'
import { requirePermission } from '../lib/identity'
import {
  createPatient,
  createDraftEncounter,
  patchEncounter,
  finaliseEncounter,
  reviewEncounterField,
  type EncounterPatch,
} from './repo'
import { fieldSignature, machineFields } from '../lib/fieldReview'
import { newId } from '../lib/id'
import type { Prescription } from './schema'

/**
 * Demo data for showing the app without a live facility.
 *
 * Names, villages and presentations are plausible for the Malagasy highlands;
 * the clinical content is ordinary primary-care material (malaria, respiratory
 * infection, hypertension follow-up, antenatal care) rather than anything
 * unusual. Entirely synthetic: no real person is represented.
 *
 * Shaped to exercise what the screens can show. Several patients have more
 * than one visit so the profile has a trend to draw; malaria is more frequent
 * this week than in the four before it so the home screen's baseline
 * comparison has something to mark; one consultation is left as a draft with
 * dictated values nobody has ticked, so the review checklist is one tap away.
 */

const day = 86_400_000

const rx = (drug: string, dose: string | undefined, frequencyPerDay: number, durationDays: number): Prescription => ({
  id: newId(),
  drug,
  dose,
  frequencyPerDay,
  durationDays,
})

/**
 * Tick every machine-entered field, the way a clinician would on the review
 * screen. Done field by field through the same function the screen calls,
 * because a bulk "approve everything" API is exactly the thing the review
 * exists to not have.
 */
async function reviewAll(encounterId: string): Promise<void> {
  const encounter = await db.encounters.get(encounterId)
  if (!encounter) return
  for (const key of machineFields(encounter)) {
    await reviewEncounterField(encounterId, key, fieldSignature(encounter, key))
  }
}

async function visit(patientId: string, daysAgo: number, patch: EncounterPatch, finalise = true): Promise<string> {
  const id = await createDraftEncounter(patientId)
  await patchEncounter(id, { occurredAt: Date.now() - daysAgo * day, ...patch })
  if (finalise) {
    await reviewAll(id)
    await finaliseEncounter(id)
  }
  return id
}

export async function seedDemoData(): Promise<void> {
  const existing = await db.patients.count()
  if (existing > 0) return

  // One clock for the whole seed. `visit()` reads its own `Date.now()`, which
  // is fine for a relative offset, but the growth series below needs a birth
  // date and four weights that stay consistent with each other.
  const now = Date.now()

  const voahirana = await createPatient({
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

  /*
   * An under-five, with a birth date and a year of weights.
   *
   * The only patient here carrying a real `birthDate` rather than an
   * approximate age, because a z-score needs the age in days and every other
   * demo record is an adult for whom nobody would have one. Four visits, not
   * one: the last weight on its own is a moderately underweight toddler, which
   * is a number. The four together are a child who grew normally to ten months
   * and has gained 300 g since, which is a decision. Drawing that difference is
   * the entire reason the chart exists.
   */
  const birth = new Date(now - 550 * day)
  const tiana = await createPatient({
    familyName: 'RASOANAIVO', givenName: 'Tiana', sex: 'female',
    birthDate: birth.toISOString().slice(0, 10), birthDatePrecision: 'day',
    address: 'Anjozorobe', registerNo: '2053', preferredLang: 'mg',
    phone: '033 45 678 90', researchConsent: 'granted',
  })

  const wellChild: [number, string, string, number, number, string?][] = [
    [367, 'pesée mensuelle', 'croissance normale', 7.0, 65.0],
    [245, 'pesée mensuelle', 'croissance normale', 7.6, 70.0],
    [124, 'diarrhée depuis deux jours', 'diarrhée aiguë sans déshydratation', 7.8, 74.5, 'SRO'],
    [2, 'pesée, appétit diminué depuis un mois', 'insuffisance pondérale modérée', 7.9, 78.0],
  ]
  for (const [daysAgo, chiefComplaint, diagnosis, weight, height, drug] of wellChild) {
    const encounterId = await createDraftEncounter(tiana)
    await patchEncounter(encounterId, {
      occurredAt: now - daysAgo * day,
      chiefComplaint,
      diagnosis,
      vitals: { weight, height },
      prescriptions: drug
        ? [{ id: newId(), drug, dose: 'un sachet par selle liquide', durationDays: 3 }]
        : [],
      notes:
        daysAgo === 2
          ? 'Cassure de la courbe depuis dix mois. Orientée vers le programme nutritionnel, revoir dans deux semaines.'
          : undefined,
    })
    await finaliseEncounter(encounterId)
  }

  const miora = await createPatient({
    familyName: 'RANDRIAMBOLOLONA', givenName: 'Miora', sex: 'female',
    approximateAge: 22, address: 'Ambohimanga', registerNo: '2044', preferredLang: 'mg',
    // Left unasked on purpose: the demo should show what an unanswered
    // consent does to an export, which is exclude the record.
    researchConsent: 'notAsked',
  })
  const fanja = await createPatient({
    familyName: 'RASOANAIVO', givenName: 'Fanja', sex: 'female',
    approximateAge: 41, address: 'Ambohitrimanjaka', registerNo: '2045', preferredLang: 'mg',
    researchConsent: 'granted',
  })
  const lova = await createPatient({
    familyName: 'RAHARIMALALA', givenName: 'Lova', sex: 'female',
    approximateAge: 29, address: 'Ambohimanga', registerNo: '2046',
    phone: '033 45 678 90', preferredLang: 'mg', researchConsent: 'granted',
  })
  const fetra = await createPatient({
    familyName: 'RAKOTOMALALA', givenName: 'Fetra', sex: 'male',
    approximateAge: 3, address: 'Anjozorobe', registerNo: '2047', preferredLang: 'mg',
    researchConsent: 'granted',
  })
  const solofo = await createPatient({
    familyName: 'ANDRIAMAMPIANINA', givenName: 'Solofo', sex: 'male',
    approximateAge: 45, address: 'Ambatolampy', registerNo: '2048', preferredLang: 'fr',
    researchConsent: 'granted',
  })
  const hanta = await createPatient({
    familyName: 'RAVELOMANANA', givenName: 'Hanta', sex: 'female',
    approximateAge: 67, address: 'Ambohidratrimo', registerNo: '2049', preferredLang: 'mg',
    researchConsent: 'granted',
  })
  const mamy = await createPatient({
    familyName: 'RAZANADRAKOTO', givenName: 'Mamy', sex: 'male',
    approximateAge: 9, address: 'Ambohimanga', registerNo: '2050', preferredLang: 'mg',
    researchConsent: 'granted',
  })
  const nirina = await createPatient({
    familyName: 'RASOLOFONIAINA', givenName: 'Nirina', sex: 'female',
    approximateAge: 2, address: 'Anjozorobe', registerNo: '2051', preferredLang: 'mg',
    researchConsent: 'granted',
  })
  const feno = await createPatient({
    familyName: 'ANDRIANARIVO', givenName: 'Feno', sex: 'male',
    approximateAge: 31, address: 'Ambohimanga', registerNo: '2052', preferredLang: 'fr',
    researchConsent: 'granted',
  })

  // --- Voahirana: an earlier chest infection, then malaria this week, dictated.
  await visit(voahirana, 61, {
    chiefComplaint: 'toux grasse depuis cinq jours',
    diagnosis: 'bronchite aiguë',
    vitals: { temperature: 37.6, pulse: 84, systolic: 112, diastolic: 72, weight: 55 },
    prescriptions: [rx('amoxicilline', '500 mg', 3, 7)],
  })
  await visit(voahirana, 3, {
    chiefComplaint: 'fièvre depuis trois jours, frissons',
    diagnosis: 'paludisme simple',
    vitals: { temperature: 38.9, pulse: 96, systolic: 110, diastolic: 70, weight: 54 },
    prescriptions: [
      rx('artéméther luméfantrine', '20/120 mg', 2, 3),
      rx('paracétamol', '500 mg', 3, 5),
    ],
    provenance: {
      'vitals.temperature': { source: 'voice', confidence: 0.75, rawText: 'température trente-huit virgule neuf' },
      'vitals.pulse': { source: 'voice', confidence: 0.75, rawText: 'pouls quatre-vingt-seize' },
      'vitals.systolic': { source: 'voice', confidence: 0.8, rawText: 'tension onze sur sept' },
      'vitals.diastolic': { source: 'voice', confidence: 0.8, rawText: 'tension onze sur sept' },
      diagnosis: { source: 'voice', confidence: 0.8, rawText: 'diagnostic paludisme simple' },
    },
  })

  // --- Naivo, 6: three visits, so weight has a line to draw; the last is urgent.
  await visit(naivo, 75, {
    chiefComplaint: 'fièvre',
    diagnosis: 'paludisme simple',
    vitals: { temperature: 38.4, pulse: 112, weight: 16.8 },
    prescriptions: [rx('artéméther luméfantrine', '20/120 mg', 2, 3)],
  })
  await visit(naivo, 30, {
    chiefComplaint: 'diarrhée depuis deux jours',
    diagnosis: 'diarrhée aiguë sans déshydratation',
    vitals: { temperature: 37.4, pulse: 100, weight: 17.2 },
    prescriptions: [rx('SRO', '1 sachet', 3, 3), rx('zinc', '20 mg', 1, 10)],
  })
  await visit(naivo, 1, {
    chiefComplaint: 'toux et difficulté à respirer',
    diagnosis: 'pneumonie',
    vitals: { temperature: 39.6, pulse: 138, respiratoryRate: 42, oxygenSaturation: 91, weight: 18 },
    prescriptions: [rx('amoxicilline', '250 mg', 3, 7)],
    provenance: {
      'vitals.respiratoryRate': { source: 'manual' },
      'vitals.oxygenSaturation': { source: 'manual' },
    },
  })

  // --- Hery, 58: hypertension followed over four visits.
  await visit(hery, 100, {
    chiefComplaint: 'céphalées, vertiges',
    diagnosis: 'hypertension artérielle',
    vitals: { systolic: 172, diastolic: 104, pulse: 82, weight: 72 },
    prescriptions: [rx('amlodipine', '5 mg', 1, 30)],
  })
  await visit(hery, 70, {
    chiefComplaint: 'contrôle tension',
    diagnosis: 'hypertension artérielle',
    vitals: { systolic: 165, diastolic: 100, pulse: 80, weight: 71.5 },
    prescriptions: [rx('amlodipine', '5 mg', 1, 30)],
  })
  await visit(hery, 40, {
    chiefComplaint: 'contrôle tension',
    diagnosis: 'hypertension artérielle',
    vitals: { systolic: 158, diastolic: 96, pulse: 76, weight: 71.2 },
    prescriptions: [rx('amlodipine', '10 mg', 1, 30)],
  })
  await visit(hery, 10, {
    chiefComplaint: 'contrôle tension',
    diagnosis: 'hypertension artérielle',
    vitals: { systolic: 168, diastolic: 98, pulse: 78, weight: 71 },
    prescriptions: [rx('amlodipine', '10 mg', 1, 30)],
  })

  // --- Miora, 22: an antenatal visit, then malaria this week.
  await visit(miora, 20, {
    chiefComplaint: 'consultation prénatale',
    diagnosis: 'grossesse 24 SA, évolution normale',
    vitals: { systolic: 110, diastolic: 70, pulse: 88, weight: 58 },
    prescriptions: [rx('fer acide folique', '1 comprimé', 1, 30)],
  })
  await visit(miora, 2, {
    chiefComplaint: 'fièvre, courbatures',
    diagnosis: 'paludisme simple',
    vitals: { temperature: 38.4, pulse: 98, systolic: 108, diastolic: 68, weight: 58.5 },
    prescriptions: [rx('artéméther luméfantrine', '20/120 mg', 2, 3), rx('paracétamol', '1 g', 3, 3)],
  })

  // --- Fanja, 41: malaria a month ago and again this week.
  await visit(fanja, 26, {
    chiefComplaint: 'fièvre intermittente',
    diagnosis: 'paludisme simple',
    vitals: { temperature: 38.1, pulse: 90, weight: 62 },
    prescriptions: [rx('artéméther luméfantrine', '20/120 mg', 2, 3)],
  })
  await visit(fanja, 5, {
    chiefComplaint: 'fièvre depuis deux jours, céphalées',
    diagnosis: 'paludisme simple',
    vitals: { temperature: 38.7, pulse: 94, systolic: 118, diastolic: 76, weight: 61.5 },
    prescriptions: [rx('artéméther luméfantrine', '20/120 mg', 2, 3), rx('paracétamol', '500 mg', 3, 3)],
  })

  // --- Lova, 29: malaria this week, dictated in French.
  await visit(lova, 4, {
    chiefComplaint: 'fièvre et frissons depuis hier',
    diagnosis: 'paludisme simple',
    vitals: { temperature: 39.1, pulse: 104, systolic: 105, diastolic: 65 },
    prescriptions: [rx('artéméther luméfantrine', '20/120 mg', 2, 3), rx('paracétamol', '1 g', 3, 3)],
    provenance: {
      'vitals.temperature': { source: 'voice', confidence: 0.9, rawText: 'température trente-neuf virgule un' },
      'vitals.pulse': { source: 'voice', confidence: 0.9, rawText: 'pouls cent quatre' },
      chiefComplaint: { source: 'voice', confidence: 0.85, rawText: 'motif fièvre et frissons depuis hier' },
      diagnosis: { source: 'voice', confidence: 0.85, rawText: 'diagnostic paludisme simple' },
    },
  })

  // --- Fetra, 3: a chest infection, then diarrhoea this week.
  await visit(fetra, 50, {
    chiefComplaint: 'toux, nez qui coule',
    diagnosis: 'infection respiratoire aiguë haute',
    vitals: { temperature: 37.9, pulse: 118, respiratoryRate: 30, weight: 12.8 },
    prescriptions: [rx('paracétamol', '120 mg', 3, 3)],
  })
  await visit(fetra, 6, {
    chiefComplaint: 'diarrhée depuis trois jours',
    diagnosis: 'diarrhée aiguë sans déshydratation',
    vitals: { temperature: 37.2, pulse: 110, weight: 13.1 },
    prescriptions: [rx('SRO', '1 sachet', 3, 3), rx('zinc', '20 mg', 1, 10)],
  })

  // --- Solofo, 45: malaria last week, one of the baseline weeks.
  await visit(solofo, 9, {
    chiefComplaint: 'fièvre, sueurs nocturnes',
    diagnosis: 'paludisme simple',
    vitals: { temperature: 38.3, pulse: 88, systolic: 124, diastolic: 80, weight: 68 },
    prescriptions: [rx('artéméther luméfantrine', '20/120 mg', 2, 3)],
  })

  // --- Hanta, 67: hypertension, two visits.
  await visit(hanta, 55, {
    chiefComplaint: 'contrôle tension',
    diagnosis: 'hypertension artérielle',
    vitals: { systolic: 146, diastolic: 90, pulse: 74, weight: 58 },
    prescriptions: [rx('amlodipine', '5 mg', 1, 30)],
  })
  await visit(hanta, 25, {
    chiefComplaint: 'contrôle tension',
    diagnosis: 'hypertension artérielle',
    vitals: { systolic: 150, diastolic: 92, pulse: 76, weight: 57.5 },
    prescriptions: [rx('amlodipine', '5 mg', 1, 30)],
  })

  // --- Mamy, 9: a sore throat a month ago, malaria yesterday.
  await visit(mamy, 35, {
    chiefComplaint: 'mal de gorge',
    diagnosis: 'angine',
    vitals: { temperature: 38, pulse: 96, weight: 27 },
    prescriptions: [rx('paracétamol', '250 mg', 3, 3)],
  })
  await visit(mamy, 1, {
    chiefComplaint: 'fièvre depuis deux jours',
    diagnosis: 'paludisme simple',
    vitals: { temperature: 38.6, pulse: 102, weight: 27.4 },
    prescriptions: [rx('artéméther luméfantrine', '20/120 mg', 2, 3), rx('paracétamol', '250 mg', 3, 3)],
  })

  // --- Nirina, 2: moderate malnutrition, followed up.
  await visit(nirina, 40, {
    chiefComplaint: 'perte de poids, manque d’appétit',
    diagnosis: 'malnutrition aiguë modérée',
    vitals: { temperature: 36.8, pulse: 116, weight: 8.9, height: 82 },
    prescriptions: [rx('vitamine A', '100 000 UI', 1, 1)],
  })
  await visit(nirina, 12, {
    chiefComplaint: 'suivi nutritionnel',
    diagnosis: 'malnutrition aiguë modérée, en amélioration',
    vitals: { temperature: 36.9, pulse: 112, weight: 9.4, height: 83 },
    prescriptions: [],
  })

  // --- Feno, 31: today, still a draft. Dictated values, none ticked yet, so
  // opening it lands on the review checklist with work to do.
  await visit(
    feno,
    0,
    {
      chiefComplaint: 'toux sèche depuis une semaine',
      diagnosis: 'bronchite aiguë',
      vitals: { temperature: 37.8, pulse: 88, respiratoryRate: 20 },
      prescriptions: [rx('amoxicilline', '1 g', 2, 7)],
      provenance: {
        'vitals.temperature': { source: 'voice', confidence: 0.9, rawText: 'température trente-sept virgule huit' },
        'vitals.pulse': { source: 'voice', confidence: 0.9, rawText: 'pouls quatre-vingt-huit' },
        'vitals.respiratoryRate': { source: 'voice', confidence: 0.7, rawText: 'fréquence respiratoire vingt' },
        chiefComplaint: { source: 'voice', confidence: 0.85, rawText: 'motif toux sèche depuis une semaine' },
        diagnosis: { source: 'voice', confidence: 0.85, rawText: 'diagnostic bronchite aiguë' },
      },
    },
    false,
  )
}

export async function clearAllData(): Promise<void> {
  requirePermission('manage.device')
  await db.transaction('rw', db.patients, db.encounters, db.attachments, async () => {
    await Promise.all([db.patients.clear(), db.encounters.clear(), db.attachments.clear()])
  })
}

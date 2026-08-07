import type { LangCode } from '../db/schema'

/**
 * UI strings.
 *
 * French is the default and the clinician's working language, because clinical
 * documentation in Madagascar is written in French (docs/MODEL-RESEARCH.md §1).
 * Malagasy exists primarily for the patient-facing surfaces, the instruction
 * sheet is the one screen a patient actually reads.
 *
 * ⚠️ The Malagasy strings below are a working draft and have NOT been reviewed by
 * a native speaker. They must be before any real deployment; wrong dosage
 * wording is a safety issue, not a polish issue. Tracked in README.md.
 */
export interface Strings {
  appName: string
  // Navigation & shell
  patients: string
  settings: string
  offline: string
  online: string
  pendingSync: string
  allSynced: string
  back: string
  // Roster
  searchPlaceholder: string
  noPatients: string
  noPatientsHint: string
  noResults: string
  newPatient: string
  patientCount: string
  // Patient fields
  givenName: string
  familyName: string
  sex: string
  female: string
  male: string
  unknown: string
  age: string
  years: string
  birthDate: string
  approximateAge: string
  phone: string
  address: string
  registerNo: string
  preferredLang: string
  // Encounter
  newEncounter: string
  encounters: string
  noEncounters: string
  chiefComplaint: string
  diagnosis: string
  notes: string
  vitals: string
  prescriptions: string
  addPrescription: string
  drug: string
  dose: string
  frequency: string
  duration: string
  timesPerDay: string
  days: string
  // Capture
  dictate: string
  listening: string
  stopDictation: string
  photo: string
  typeManually: string
  dictationHint: string
  micUnavailable: string
  micNeedsNetwork: string
  transcript: string
  applyExtraction: string
  nothingExtracted: string
  today: string
  consultationsToday: string
  draftsPending: string
  resumeDraft: string
  recentPatients: string
  seeAll: string
  noActivityToday: string
  noActivityHint: string
  quickActions: string
  lastSeen: string
  never: string
  thisMonth: string
  readText: string
  readingText: string
  ocrFailed: string
  ocrPack: string
  downloadOcrPack: string
  ocrPackHint: string
  ocrPackReady: string
  sync: string
  syncHint: string
  serverUrl: string
  facilityId: string
  syncNow: string
  syncing: string
  lastSync: string
  syncNever: string
  syncNotConfigured: string
  syncFailed: string
  syncSummary: string
  syncNoAuthWarning: string
  privacy: string
  privacyHint: string
  levelIdentified: string
  levelIdentifiedHint: string
  levelPseudonymous: string
  levelPseudonymousHint: string
  levelAnonymous: string
  levelAnonymousHint: string
  redactionSummary: string
  attachmentsExcluded: string
  exportFhir: string
  exportDhis2: string
  exportCsv: string
  reporting: string
  reportingHint: string
  // Review
  review: string
  reviewHint: string
  sourceManual: string
  sourceVoice: string
  sourcePhoto: string
  checkThis: string
  confirmSave: string
  saved: string
  // Instructions
  instructions: string
  instructionsFor: string
  speakAloud: string
  noVoiceAvailable: string
  print: string
  // Vitals
  temperature: string
  pulse: string
  bloodPressure: string
  respiratoryRate: string
  weight: string
  height: string
  oxygenSaturation: string
  // Actions & status
  save: string
  cancel: string
  delete: string
  confirm: string
  edit: string
  draft: string
  outOfRange: string
  urgent: string
  watch: string
  required: string
  attachments: string
  addPhoto: string
  // Settings
  language: string
  storage: string
  records: string
  exportData: string
  dataNotice: string
  loadDemo: string
}

const fr: Strings = {
  appName: 'AfyaCore',
  patients: 'Patients',
  settings: 'Paramètres',
  offline: 'Hors ligne',
  online: 'En ligne',
  pendingSync: 'en attente',
  allSynced: 'Tout enregistré',
  back: 'Retour',
  searchPlaceholder: 'Rechercher un patient…',
  noPatients: 'Aucun patient',
  noPatientsHint: 'Enregistrez le premier patient pour commencer.',
  noResults: 'Aucun résultat',
  newPatient: 'Nouveau patient',
  patientCount: 'patients',
  givenName: 'Prénom',
  familyName: 'Nom',
  sex: 'Sexe',
  female: 'Femme',
  male: 'Homme',
  unknown: 'Non précisé',
  age: 'Âge',
  years: 'ans',
  birthDate: 'Date de naissance',
  approximateAge: 'Âge approximatif',
  phone: 'Téléphone',
  address: 'Village / Fokontany',
  registerNo: 'N° de registre',
  preferredLang: 'Langue du patient',
  newEncounter: 'Nouvelle consultation',
  encounters: 'Consultations',
  noEncounters: 'Aucune consultation enregistrée',
  chiefComplaint: 'Motif de consultation',
  diagnosis: 'Diagnostic',
  notes: 'Observations',
  vitals: 'Constantes',
  prescriptions: 'Ordonnance',
  addPrescription: 'Ajouter un médicament',
  drug: 'Médicament',
  dose: 'Dose',
  frequency: 'Fréquence',
  duration: 'Durée',
  timesPerDay: 'fois / jour',
  days: 'jours',
  dictate: 'Dicter',
  listening: 'Écoute en cours…',
  stopDictation: 'Arrêter',
  photo: 'Photo',
  typeManually: 'Saisir',
  dictationHint: 'Dictez en français : constantes, diagnostic, ordonnance.',
  micUnavailable: 'Dictée non disponible sur cet appareil',
  micNeedsNetwork: 'La dictée nécessite une connexion. La saisie manuelle fonctionne hors ligne.',
  transcript: 'Transcription',
  applyExtraction: 'Remplir le formulaire',
  nothingExtracted: 'Rien de reconnu, complétez manuellement.',
  today: 'Aujourd’hui',
  consultationsToday: 'Consultations',
  draftsPending: 'Brouillons',
  resumeDraft: 'Reprendre',
  recentPatients: 'Patients récents',
  seeAll: 'Tout voir',
  noActivityToday: 'Aucune consultation aujourd’hui',
  noActivityHint: 'Commencez par enregistrer un patient ou ouvrez une consultation.',
  quickActions: 'Actions',
  lastSeen: 'Vu le',
  never: 'Jamais vu',
  thisMonth: 'Ce mois-ci',
  readText: 'Lire le texte',
  readingText: 'Lecture du texte en cours…',
  ocrFailed: 'Lecture impossible.',
  ocrPack: 'Module de lecture de photos',
  downloadOcrPack: 'Télécharger le module OCR (~12 Mo)',
  ocrPackHint: 'À télécharger une fois, avec une connexion. Ensuite la lecture des photos fonctionne hors ligne.',
  ocrPackReady: 'Module OCR prêt',
  sync: 'Synchronisation',
  syncHint: 'Les enregistrements restent sur cet appareil. La synchronisation les partage avec les autres appareils du centre.',
  serverUrl: 'Adresse du serveur',
  facilityId: 'Identifiant du centre',
  syncNow: 'Synchroniser',
  syncing: 'Synchronisation en cours…',
  lastSync: 'Dernière synchronisation',
  syncNever: 'Jamais synchronisé',
  syncNotConfigured: 'Renseignez l’adresse du serveur et l’identifiant du centre.',
  syncFailed: 'Échec de la synchronisation',
  syncSummary: 'envoyés / reçus',
  syncNoAuthWarning: 'Le serveur n’a pas encore d’authentification. À réserver à un réseau de confiance.',
  privacy: 'Confidentialité des exports',
  privacyHint: 'Choisissez ce que les fichiers exportés contiennent avant qu’ils ne quittent l’appareil.',
  levelIdentified: 'Identifié',
  levelIdentifiedHint: 'Noms, téléphone et village inclus. À réserver au transfert vers le dossier du patient.',
  levelPseudonymous: 'Pseudonymisé',
  levelPseudonymousHint: 'Identifiants remplacés par un code stable. Un même patient reste reconnaissable d’un export à l’autre.',
  levelAnonymous: 'Anonyme',
  levelAnonymousHint: 'Identifiants supprimés, dates ramenées au mois, aucun lien possible entre deux exports.',
  redactionSummary: 'éléments masqués dans le texte libre',
  attachmentsExcluded: 'Les photos sont toujours exclues des exports anonymisés : elles ne peuvent pas être masquées.',
  exportFhir: 'Exporter en FHIR R4',
  exportDhis2: 'Rapport mensuel DHIS2',
  exportCsv: 'Rapport mensuel (CSV)',
  reporting: 'Rapports',
  reportingHint: 'Comptages agrégés du mois en cours, calculés à partir des consultations validées.',
  review: 'Vérifier',
  reviewHint: 'Vérifiez chaque valeur avant d’enregistrer.',
  sourceManual: 'Saisi',
  sourceVoice: 'Dicté',
  sourcePhoto: 'Photo',
  checkThis: 'À vérifier',
  confirmSave: 'Confirmer et enregistrer',
  saved: 'Consultation enregistrée',
  instructions: 'Consignes patient',
  instructionsFor: 'Consignes pour',
  speakAloud: 'Écouter',
  noVoiceAvailable: 'Voix indisponible, montrez le texte au patient.',
  print: 'Imprimer',
  temperature: 'Température',
  pulse: 'Pouls',
  bloodPressure: 'Tension',
  respiratoryRate: 'Fréq. respiratoire',
  weight: 'Poids',
  height: 'Taille',
  oxygenSaturation: 'Saturation',
  save: 'Enregistrer',
  cancel: 'Annuler',
  delete: 'Supprimer',
  confirm: 'Confirmer',
  edit: 'Modifier',
  draft: 'Brouillon',
  outOfRange: 'Valeur hors limites',
  urgent: 'Urgent',
  watch: 'À surveiller',
  required: 'Obligatoire',
  attachments: 'Pièces jointes',
  addPhoto: 'Ajouter une photo',
  language: 'Langue',
  storage: 'Stockage',
  records: 'enregistrements',
  exportData: 'Exporter les données',
  dataNotice:
    'Toutes les données restent sur cet appareil. Rien n’est envoyé sans synchronisation explicite.',
  loadDemo: 'Charger la démonstration',
}

const mg: Strings = {
  appName: 'AfyaCore',
  patients: 'Marary',
  settings: 'Fandrindrana',
  offline: 'Tsy misy aterineto',
  online: 'Misy aterineto',
  pendingSync: 'miandry',
  allSynced: 'Voatahiry daholo',
  back: 'Hiverina',
  searchPlaceholder: 'Hitady marary…',
  noPatients: 'Tsy misy marary',
  noPatientsHint: 'Soraty ny marary voalohany.',
  noResults: 'Tsy misy valiny',
  newPatient: 'Marary vaovao',
  patientCount: 'marary',
  givenName: 'Fanampin’anarana',
  familyName: 'Anarana',
  sex: 'Lahy sa vavy',
  female: 'Vehivavy',
  male: 'Lehilahy',
  unknown: 'Tsy fantatra',
  age: 'Taona',
  years: 'taona',
  birthDate: 'Daty nahaterahana',
  approximateAge: 'Taona manodidina',
  phone: 'Finday',
  address: 'Tanàna / Fokontany',
  registerNo: 'Laharana',
  preferredLang: 'Fitenin’ny marary',
  newEncounter: 'Fitsaboana vaovao',
  encounters: 'Fitsaboana',
  noEncounters: 'Tsy mbola nisy fitsaboana',
  chiefComplaint: 'Antony',
  diagnosis: 'Aretina',
  notes: 'Fanamarihana',
  vitals: 'Fandrefesana',
  prescriptions: 'Fanafody',
  addPrescription: 'Hanampy fanafody',
  drug: 'Fanafody',
  dose: 'Habetsany',
  frequency: 'Impiry',
  duration: 'Faharetana',
  timesPerDay: 'isan’andro',
  days: 'andro',
  dictate: 'Miteny',
  listening: 'Mihaino…',
  stopDictation: 'Ajanony',
  photo: 'Sary',
  typeManually: 'Soratana',
  dictationHint: 'Tenenina amin’ny teny frantsay.',
  micUnavailable: 'Tsy afaka mihaino ity finday ity',
  micNeedsNetwork: 'Mila aterineto ny fihainoana. Ny fanoratana dia mandeha foana.',
  transcript: 'Voasoratra',
  applyExtraction: 'Fenoy ny taratasy',
  nothingExtracted: 'Tsy nisy voafantatra, soraty an-tanana.',
  today: 'Androany',
  consultationsToday: 'Fitsaboana',
  draftsPending: 'Mbola tsy vita',
  resumeDraft: 'Tohizo',
  recentPatients: 'Marary farany',
  seeAll: 'Jereo daholo',
  noActivityToday: 'Tsy nisy fitsaboana androany',
  noActivityHint: 'Manomboka amin’ny fanoratana marary.',
  quickActions: 'Asa',
  lastSeen: 'Hita ny',
  never: 'Tsy mbola hita',
  thisMonth: 'Ity volana ity',
  readText: 'Vakio ny soratra',
  readingText: 'Mamaky ny soratra…',
  ocrFailed: 'Tsy afaka namaky.',
  ocrPack: 'Mpamaky sary',
  downloadOcrPack: 'Alaina ny mpamaky sary (~12 Mo)',
  ocrPackHint: 'Alaina indray mandeha rehefa misy aterineto.',
  ocrPackReady: 'Vonona ny mpamaky sary',
  sync: 'Fampifanarahana',
  syncHint: 'Mijanona eto amin’ity finday ity ny rakitra. Ny fampifanarahana no mizara azy.',
  serverUrl: 'Adiresin’ny serivera',
  facilityId: 'Laharan’ny toeram-pitsaboana',
  syncNow: 'Ampifanaraho',
  syncing: 'Eo am-panaovana…',
  lastSync: 'Farany',
  syncNever: 'Tsy mbola natao',
  syncNotConfigured: 'Fenoy ny adiresy sy ny laharana.',
  syncFailed: 'Tsy nahomby',
  syncSummary: 'nalefa / noraisina',
  syncNoAuthWarning: 'Mbola tsy misy fiarovana ny serivera.',
  privacy: 'Fiarovana ny rakitra',
  privacyHint: 'Fidio izay ao anatin’ny rakitra havoaka.',
  levelIdentified: 'Misy anarana',
  levelIdentifiedHint: 'Misy ny anarana sy ny finday.',
  levelPseudonymous: 'Misolo anarana',
  levelPseudonymousHint: 'Soloina kaody maharitra ny anarana.',
  levelAnonymous: 'Tsy fantatra',
  levelAnonymousHint: 'Esorina ny anarana rehetra, tsy azo ampifandraisina.',
  redactionSummary: 'zavatra nafenina',
  attachmentsExcluded: 'Tsy tafiditra mihitsy ny sary.',
  exportFhir: 'Havoaka FHIR R4',
  exportDhis2: 'Tatitra DHIS2',
  exportCsv: 'Tatitra (CSV)',
  reporting: 'Tatitra',
  reportingHint: 'Isa nangonina tamin\u2019ity volana ity.',
  review: 'Hamarino',
  reviewHint: 'Hamarino tsara ny isa rehetra alohan’ny hitahiry.',
  sourceManual: 'Nosoratana',
  sourceVoice: 'Notenenina',
  sourcePhoto: 'Sary',
  checkThis: 'Hamarino',
  confirmSave: 'Ekena sy tehirizo',
  saved: 'Voatahiry',
  instructions: 'Toromarika',
  instructionsFor: 'Toromarika ho an’i',
  speakAloud: 'Henoy',
  noVoiceAvailable: 'Tsy misy feo, asehoy ny soratra.',
  print: 'Atontay',
  temperature: 'Mari-pana',
  pulse: 'Fitempon’ny fo',
  bloodPressure: 'Tosidra',
  respiratoryRate: 'Fiainana',
  weight: 'Lanja',
  height: 'Halavana',
  oxygenSaturation: 'Oksizenina',
  save: 'Tehirizo',
  cancel: 'Aoka ihany',
  delete: 'Fafao',
  confirm: 'Ekena',
  edit: 'Ovay',
  draft: 'Mbola tsy vita',
  outOfRange: 'Isa tsy mety',
  urgent: 'Maika',
  watch: 'Tandremo',
  required: 'Ilaina',
  attachments: 'Sary napetaka',
  addPhoto: 'Hanampy sary',
  language: 'Fiteny',
  storage: 'Fitehirizana',
  records: 'rakitra',
  exportData: 'Havoaka ny rakitra',
  dataNotice: 'Mijanona ato amin’ity finday ity ny rakitra rehetra.',
  loadDemo: 'Asehoy ny ohatra',
}

const en: Strings = {
  appName: 'AfyaCore',
  patients: 'Patients',
  settings: 'Settings',
  offline: 'Offline',
  online: 'Online',
  pendingSync: 'pending',
  allSynced: 'All saved',
  back: 'Back',
  searchPlaceholder: 'Search patients…',
  noPatients: 'No patients yet',
  noPatientsHint: 'Register the first patient to begin.',
  noResults: 'No results',
  newPatient: 'New patient',
  patientCount: 'patients',
  givenName: 'Given name',
  familyName: 'Family name',
  sex: 'Sex',
  female: 'Female',
  male: 'Male',
  unknown: 'Not specified',
  age: 'Age',
  years: 'yrs',
  birthDate: 'Date of birth',
  approximateAge: 'Approximate age',
  phone: 'Phone',
  address: 'Village / Fokontany',
  registerNo: 'Register no.',
  preferredLang: 'Patient language',
  newEncounter: 'New consultation',
  encounters: 'Consultations',
  noEncounters: 'No consultations recorded',
  chiefComplaint: 'Chief complaint',
  diagnosis: 'Diagnosis',
  notes: 'Notes',
  vitals: 'Vitals',
  prescriptions: 'Prescription',
  addPrescription: 'Add medication',
  drug: 'Medication',
  dose: 'Dose',
  frequency: 'Frequency',
  duration: 'Duration',
  timesPerDay: 'times / day',
  days: 'days',
  dictate: 'Dictate',
  listening: 'Listening…',
  stopDictation: 'Stop',
  photo: 'Photo',
  typeManually: 'Type',
  dictationHint: 'Dictate in English: vitals, diagnosis, prescription.',
  micUnavailable: 'Dictation unavailable on this device',
  micNeedsNetwork: 'Dictation needs a connection. Manual entry always works offline.',
  transcript: 'Transcript',
  applyExtraction: 'Fill the form',
  nothingExtracted: 'Nothing recognised, enter manually.',
  today: 'Today',
  consultationsToday: 'Consultations',
  draftsPending: 'Drafts',
  resumeDraft: 'Resume',
  recentPatients: 'Recent patients',
  seeAll: 'See all',
  noActivityToday: 'No consultations today',
  noActivityHint: 'Start by registering a patient or opening a consultation.',
  quickActions: 'Actions',
  lastSeen: 'Last seen',
  never: 'Never seen',
  thisMonth: 'This month',
  readText: 'Read text',
  readingText: 'Reading text…',
  ocrFailed: 'Could not read the image.',
  ocrPack: 'Photo reading module',
  downloadOcrPack: 'Download OCR pack (~12 MB)',
  ocrPackHint: 'Download once while online. Photo reading then works offline.',
  ocrPackReady: 'OCR pack ready',
  sync: 'Sync',
  syncHint: 'Records stay on this device. Sync shares them with the other devices at this facility.',
  serverUrl: 'Server address',
  facilityId: 'Facility ID',
  syncNow: 'Sync now',
  syncing: 'Syncing…',
  lastSync: 'Last sync',
  syncNever: 'Never synced',
  syncNotConfigured: 'Set the server address and facility ID.',
  syncFailed: 'Sync failed',
  syncSummary: 'sent / received',
  syncNoAuthWarning: 'The server has no authentication yet. Use only on a trusted network.',
  privacy: 'Export privacy',
  privacyHint: 'Choose what exported files contain before they leave this device.',
  levelIdentified: 'Identified',
  levelIdentifiedHint: 'Names, phone and village included. For transferring into the patient’s own record only.',
  levelPseudonymous: 'Pseudonymous',
  levelPseudonymousHint: 'Identifiers replaced by a stable code. The same patient stays recognisable across exports.',
  levelAnonymous: 'Anonymous',
  levelAnonymousHint: 'Identifiers removed, dates reduced to the month, no link possible between exports.',
  redactionSummary: 'items redacted from free text',
  attachmentsExcluded: 'Photos are always excluded from de-identified exports, they cannot be redacted.',
  exportFhir: 'Export as FHIR R4',
  exportDhis2: 'Monthly DHIS2 report',
  exportCsv: 'Monthly report (CSV)',
  reporting: 'Reporting',
  reportingHint: 'Aggregate counts for the current month, from confirmed consultations only.',
  review: 'Review',
  reviewHint: 'Check every value before saving.',
  sourceManual: 'Typed',
  sourceVoice: 'Dictated',
  sourcePhoto: 'Photo',
  checkThis: 'Check this',
  confirmSave: 'Confirm and save',
  saved: 'Consultation saved',
  instructions: 'Patient instructions',
  instructionsFor: 'Instructions for',
  speakAloud: 'Listen',
  noVoiceAvailable: 'No voice available, show the text to the patient.',
  print: 'Print',
  temperature: 'Temperature',
  pulse: 'Pulse',
  bloodPressure: 'Blood pressure',
  respiratoryRate: 'Resp. rate',
  weight: 'Weight',
  height: 'Height',
  oxygenSaturation: 'SpO₂',
  save: 'Save',
  cancel: 'Cancel',
  delete: 'Delete',
  confirm: 'Confirm',
  edit: 'Edit',
  draft: 'Draft',
  outOfRange: 'Out of range',
  urgent: 'Urgent',
  watch: 'Watch',
  required: 'Required',
  attachments: 'Attachments',
  addPhoto: 'Add photo',
  language: 'Language',
  storage: 'Storage',
  records: 'records',
  exportData: 'Export data',
  dataNotice: 'All data stays on this device. Nothing leaves without explicit sync.',
  loadDemo: 'Load demo workspace',
}

export const STRINGS: Record<LangCode, Strings> = { fr, mg, en }

export const LANG_LABELS: Record<LangCode, string> = {
  fr: 'Français',
  mg: 'Malagasy',
  en: 'English',
}

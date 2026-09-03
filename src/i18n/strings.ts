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
  /** Shown instead of a pending count when no sync server is configured. */
  savedOnDevice: string
  back: string
  manage: string
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
  birthDateHint: string
  approximateAge: string
  phone: string
  address: string
  registerNo: string
  preferredLang: string
  preferredLangHint: string
  // Patient management
  editPatient: string
  savePatient: string
  deletePatient: string
  deletePatientConfirm: string
  /** Composed as "<n> <consultationsWillBeDeleted>". */
  consultationsWillBeDeleted: string
  mergeDuplicate: string
  mergeHint: string
  mergeInto: string
  mergeConfirm: string
  /** Composed as "<n> <consultationsMoved>". */
  consultationsMoved: string
  noOtherPatients: string
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
  syncNow: string
  syncing: string
  lastSync: string
  syncNever: string
  syncNotConfigured: string
  syncFailed: string
  syncSummary: string
  // Sign-in and device lock. The phone is shared and put down constantly, so
  // the audit trail is only meaningful if the name on it is the person who was
  // actually holding it.
  lockSubtitle: string
  firstRunSubtitle: string
  firstRunHint: string
  yourName: string
  nameRequired: string
  choosePin: string
  confirmPin: string
  pin: string
  pinHint: string
  pinMismatch: string
  pinWrong: string
  pinLockedOut: string
  attemptsRemaining: string
  pinPolicy: Record<'too_short' | 'too_long' | 'not_numeric' | 'sequential' | 'repeated', string>
  createAccount: string
  signInAs: string
  unlock: string
  signOut: string
  clear: string
  backspace: string
  // Staff and audit
  staff: string
  addStaff: string
  role: string
  roleClinician: string
  roleAdmin: string
  disableAccount: string
  disableAccountConfirm: string
  auditTrail: string
  auditVerify: string
  auditIntact: string
  auditBroken: string
  auditEntries: string
  idleTimeout: string
  idleTimeoutHint: string
  adminOnly: string
  you: string
  lastAdmin: string
  auditVerifiedFrom: string
  // Country profile. One setting, because everything else that varies by
  // country is derived from it.
  country: string
  countryHint: string
  clinicalLanguage: string
  facilityType: string
  reportingSystem: string
  dataProtectionLaw: string
  regulator: string
  breachWindow: string
  withoutDelay: string
  retention: string
  unconfirmed: string
  unreviewedTranslation: string
  researchConsent: string
  researchConsentHint: string
  consentGranted: string
  consentRefused: string
  consentNotAsked: string
  excludedForConsent: string
  notLegalAdvice: string
  // Optional on-device PII model (OpenMed). An accuracy upgrade over the
  // deterministic scrub, never a replacement for it.
  piiPack: string
  piiPackHint: string
  piiPackReady: string
  piiPackAbsent: string
  neuralRedactionSummary: string
  // Device enrolment. Replaces the typed facility id: a device is joined to a
  // facility once, with a single-use code an administrator reads out.
  enrolHint: string
  enrolCode: string
  enrolDevice: string
  enrolling: string
  enrolFailed: string
  enrolInvalidCode: string
  enrolRateLimited: string
  deviceName: string
  deviceNamePlaceholder: string
  deviceEnrolled: string
  unenrol: string
  unenrolConfirm: string
  syncUnauthorised: string
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
  // Correcting a confirmed record
  amend: string
  amendNotice: string
  saveCorrection: string
  deleteRecord: string
  deleteRecordConfirm: string
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
  /** Short enough to fit a vitals tile on a phone. See lib/format.ts. */
  systolic: string
  diastolic: string
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
  demo: string
  clearData: string
  clearDataConfirm: string
  noReportData: string
  prototypeNotice: string
}

const fr: Strings = {
  appName: 'AfyaCore',
  patients: 'Patients',
  settings: 'Paramètres',
  offline: 'Hors ligne',
  online: 'En ligne',
  pendingSync: 'en attente',
  allSynced: 'Tout enregistré',
  savedOnDevice: 'Sur l’appareil',
  back: 'Retour',
  manage: 'Gérer',
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
  birthDateHint: 'Laissez vide si inconnue',
  approximateAge: 'Âge approximatif',
  phone: 'Téléphone',
  address: 'Village / Fokontany',
  registerNo: 'N° de registre',
  preferredLang: 'Langue du patient',
  preferredLangHint: 'Langue des consignes remises au patient',
  editPatient: 'Modifier la fiche',
  savePatient: 'Enregistrer les modifications',
  deletePatient: 'Supprimer le patient',
  deletePatientConfirm: 'Supprimer ce patient et tout son dossier ?',
  consultationsWillBeDeleted: 'consultation(s) seront également supprimées.',
  mergeDuplicate: 'Fusionner un doublon',
  mergeHint:
    'Choisissez la fiche en double. Ses consultations seront rattachées à cette fiche-ci, et les champs vides d’ici seront complétés à partir d’elle.',
  mergeInto: 'Fusionner dans cette fiche',
  mergeConfirm: 'Fusionner ces deux fiches ?',
  consultationsMoved: 'consultation(s) rattachée(s)',
  noOtherPatients: 'Aucune autre fiche à fusionner',
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
  syncNow: 'Synchroniser',
  syncing: 'Synchronisation en cours…',
  lastSync: 'Dernière synchronisation',
  syncNever: 'Jamais synchronisé',
  syncNotConfigured: 'Renseignez l’adresse du serveur pour inscrire cet appareil.',
  syncFailed: 'Échec de la synchronisation',
  syncSummary: 'envoyés / reçus',
  lockSubtitle: 'Saisissez votre code pour continuer',
  firstRunSubtitle: 'Configuration du premier compte',
  firstRunHint: 'Ce premier compte est administrateur : il pourra inscrire l’appareil et ajouter des collègues.',
  yourName: 'Votre nom',
  nameRequired: 'Le nom est obligatoire.',
  choosePin: 'Choisissez un code',
  confirmPin: 'Confirmez le code',
  pin: 'Code',
  pinHint: '4 à 12 chiffres. Évitez 0000 ou 1234.',
  pinMismatch: 'Les deux codes ne correspondent pas.',
  pinWrong: 'Code incorrect.',
  pinLockedOut: 'Trop de tentatives. Appareil bloqué pendant',
  attemptsRemaining: 'essai(s) restant(s).',
  pinPolicy: {
    too_short: 'Le code doit comporter au moins 4 chiffres.',
    too_long: 'Le code ne peut pas dépasser 12 chiffres.',
    not_numeric: 'Le code ne doit contenir que des chiffres.',
    sequential: 'Évitez une suite comme 1234.',
    repeated: 'Évitez un code répété comme 0000.',
  },
  createAccount: 'Créer le compte',
  signInAs: 'Se connecter en tant que',
  unlock: 'Déverrouiller',
  signOut: 'Se déconnecter',
  clear: 'Effacer',
  backspace: 'Retour',
  staff: 'Personnel',
  addStaff: 'Ajouter un compte',
  role: 'Rôle',
  roleClinician: 'Soignant',
  roleAdmin: 'Administrateur',
  disableAccount: 'Désactiver le compte',
  disableAccountConfirm: 'Désactiver ce compte ? Il ne pourra plus se connecter, mais son historique reste dans le journal.',
  auditTrail: 'Journal d’audit',
  auditVerify: 'Vérifier le journal',
  auditIntact: 'Journal intact',
  auditBroken: 'Journal altéré à l’entrée',
  auditEntries: 'entrées',
  idleTimeout: 'Verrouillage automatique',
  idleTimeoutHint: 'Délai d’inactivité avant que l’appareil redemande le code.',
  adminOnly: 'Réservé aux administrateurs.',
  you: 'vous',
  lastAdmin: 'Dernier administrateur : impossible de désactiver ce compte.',
  auditVerifiedFrom: 'vérifié à partir de l’entrée',
  country: 'Pays',
  countryHint: 'Détermine la langue de rédaction clinique, le format des numéros de téléphone retirés à l’export, et le régime de protection des données applicable.',
  clinicalLanguage: 'Langue clinique',
  facilityType: 'Type de structure',
  reportingSystem: 'Système de rapportage',
  dataProtectionLaw: 'Loi applicable',
  regulator: 'Autorité de contrôle',
  breachWindow: 'Délai de notification',
  withoutDelay: 'Sans délai',
  retention: 'Durée de conservation',
  unconfirmed: 'À confirmer',
  unreviewedTranslation:
    'Traduction en {lang} non relue par un locuteur. Vérifiez la posologie avec le patient.',
  researchConsent: 'Consentement recherche',
  researchConsentHint: 'Le patient accepte-t-il que son dossier serve à la recherche ?',
  consentGranted: 'Accordé',
  consentRefused: 'Refusé',
  consentNotAsked: 'Non demandé',
  excludedForConsent: 'patients exclus, sans consentement',
  notLegalAdvice: 'Ces informations sont fournies à titre indicatif et n’ont pas été validées par un juriste de ce pays. Elles ne constituent pas un avis juridique.',
  piiPack: 'Modèle d’anonymisation',
  piiPackHint: 'Repère dans les notes les noms que le registre ne contient pas, par exemple un parent cité en passant. Le nettoyage de base fonctionne sans lui.',
  piiPackReady: 'Modèle installé, anonymisation renforcée active',
  piiPackAbsent: 'Non installé. L’anonymisation déterministe reste active. L’administrateur peut l’installer sur le serveur.',
  neuralRedactionSummary: 'par le modèle',
  enrolHint: 'Demandez un code d’inscription à l’administrateur du serveur, puis saisissez-le ici. Une seule fois par appareil.',
  enrolCode: 'Code d’inscription',
  enrolDevice: 'Inscrire cet appareil',
  enrolling: 'Inscription…',
  enrolFailed: 'Échec de l’inscription',
  enrolInvalidCode: 'Code invalide, expiré ou déjà utilisé. Demandez-en un nouveau.',
  enrolRateLimited: 'Trop de tentatives. Réessayez dans une minute.',
  deviceName: 'Nom de l’appareil',
  deviceNamePlaceholder: 'Téléphone consultation 1',
  deviceEnrolled: 'Appareil inscrit',
  unenrol: 'Désinscrire cet appareil',
  unenrolConfirm: 'Désinscrire cet appareil ? Les dossiers restent sur le téléphone, mais la synchronisation s’arrête jusqu’à une nouvelle inscription.',
  syncUnauthorised: 'Cet appareil n’est plus autorisé. Son accès a été révoqué ; demandez un nouveau code.',
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
  amend: 'Corriger',
  amendNotice:
    'Cette consultation est déjà validée. Toute correction remplace l’enregistrement et sera renvoyée à la synchronisation.',
  saveCorrection: 'Enregistrer la correction',
  deleteRecord: 'Supprimer la consultation',
  deleteRecordConfirm:
    'Supprimer définitivement cette consultation validée ? Elle disparaîtra des rapports mensuels, y compris ceux déjà transmis.',
  instructions: 'Consignes patient',
  instructionsFor: 'Consignes pour',
  speakAloud: 'Écouter',
  noVoiceAvailable: 'Voix indisponible, montrez le texte au patient.',
  print: 'Imprimer',
  temperature: 'Température',
  pulse: 'Pouls',
  bloodPressure: 'Tension',
  systolic: 'Tension (sys)',
  diastolic: 'Tension (dia)',
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
  demo: 'Démonstration',
  clearData: 'Effacer toutes les données',
  clearDataConfirm: 'Effacer toutes les données de cet appareil ?',
  noReportData: 'Aucune consultation validée ce mois-ci.',
  prototypeNotice:
    'AfyaCore v0.0.1, prototype. Les libellés en malgache n’ont pas encore été relus par un locuteur natif. L’export DHIS2 contient des identifiants à remplacer.',
}

const mg: Strings = {
  appName: 'AfyaCore',
  patients: 'Marary',
  settings: 'Fandrindrana',
  offline: 'Tsy misy aterineto',
  online: 'Misy aterineto',
  pendingSync: 'miandry',
  allSynced: 'Voatahiry daholo',
  savedOnDevice: 'Ao anaty finday',
  back: 'Hiverina',
  manage: 'Fitantanana',
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
  birthDateHint: 'Avelao foana raha tsy fantatra',
  approximateAge: 'Taona manodidina',
  phone: 'Finday',
  address: 'Tanàna / Fokontany',
  registerNo: 'Laharana',
  preferredLang: 'Fitenin’ny marary',
  preferredLangHint: 'Fiteny hanoratana ny toromarika ho an’ny marary',
  editPatient: 'Hanova ny rakitra',
  savePatient: 'Tehirizo ny fanovana',
  deletePatient: 'Fafao ity marary ity',
  deletePatientConfirm: 'Hofafana ity marary ity sy ny rakiny rehetra?',
  consultationsWillBeDeleted: 'fitsaboana no hofafana koa.',
  mergeDuplicate: 'Hampiraisina ny rakitra mitovy',
  mergeHint:
    'Fidio ny rakitra mitovy. Hafindra amin’ity rakitra ity ny fitsaboana rehetra, ary hofenoina avy aminy ny banga eto.',
  mergeInto: 'Ampidiro amin’ity rakitra ity',
  mergeConfirm: 'Hampiraisina ireo rakitra roa ireo?',
  consultationsMoved: 'fitsaboana no nafindra',
  noOtherPatients: 'Tsy misy rakitra hafa hampiraisina',
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
  syncNow: 'Ampifanaraho',
  syncing: 'Eo am-panaovana…',
  lastSync: 'Farany',
  syncNever: 'Tsy mbola natao',
  syncNotConfigured: 'Fenoy ny adiresin’ny serivera mba hisoratana anarana.',
  syncFailed: 'Tsy nahomby',
  syncSummary: 'nalefa / noraisina',
  lockSubtitle: 'Ampidiro ny kaodinao mba hanohizana',
  firstRunSubtitle: 'Famoronana ny kaonty voalohany',
  firstRunHint: 'Mpitantana ity kaonty voalohany ity: afaka manoratra anarana ny finday sy manampy mpiara-miasa.',
  yourName: 'Ny anaranao',
  nameRequired: 'Ilaina ny anarana.',
  choosePin: 'Misafidiana kaody',
  confirmPin: 'Hamafiso ny kaody',
  pin: 'Kaody',
  pinHint: 'Isa 4 ka hatramin’ny 12. Aza mampiasa 0000 na 1234.',
  pinMismatch: 'Tsy mitovy ny kaody roa.',
  pinWrong: 'Diso ny kaody.',
  pinLockedOut: 'Betsaka loatra ny fanandramana. Voahidy ny finday mandritra ny',
  attemptsRemaining: 'fanandramana sisa.',
  pinPolicy: {
    too_short: 'Tsy maintsy isa 4 farafahakeliny ny kaody.',
    too_long: 'Tsy mahazo mihoatra ny isa 12 ny kaody.',
    not_numeric: 'Isa ihany no azo ampiasaina.',
    sequential: 'Aza mampiasa filaharana toy ny 1234.',
    repeated: 'Aza mampiasa kaody miverimberina toy ny 0000.',
  },
  createAccount: 'Hamorona kaonty',
  signInAs: 'Hiditra amin’ny anarana hoe',
  unlock: 'Hanokatra',
  signOut: 'Hivoaka',
  clear: 'Hamafa',
  backspace: 'Hiverina',
  staff: 'Mpiasa',
  addStaff: 'Hanampy kaonty',
  role: 'Andraikitra',
  roleClinician: 'Mpitsabo',
  roleAdmin: 'Mpitantana',
  disableAccount: 'Hanakana ny kaonty',
  disableAccountConfirm: 'Hakanana ity kaonty ity? Tsy afaka miditra intsony izy, fa mijanona ao amin’ny rejisitra ny tantarany.',
  auditTrail: 'Rejisitry ny fanaraha-maso',
  auditVerify: 'Hamarino ny rejisitra',
  auditIntact: 'Tsy misy diso ny rejisitra',
  auditBroken: 'Nisy niova ny rejisitra teo amin’ny laharana',
  auditEntries: 'soratra',
  idleTimeout: 'Fanidiana automatika',
  idleTimeoutHint: 'Fotoana tsy fiasana alohan’ny hangatahan’ny finday ny kaody indray.',
  adminOnly: 'Ho an’ny mpitantana ihany.',
  you: 'ianao',
  lastAdmin: 'Mpitantana farany: tsy azo akanana ity kaonty ity.',
  auditVerifiedFrom: 'nohamarinina nanomboka tamin’ny laharana',
  country: 'Firenena',
  countryHint: 'Mamaritra ny fiteny fanoratana ara-pitsaboana, ny endriky ny laharana finday esorina rehefa manondrana, ary ny lalàna miaro ny angona.',
  clinicalLanguage: 'Fiteny ara-pitsaboana',
  facilityType: 'Karazana toeram-pitsaboana',
  reportingSystem: 'Rafitra fanaovana tatitra',
  dataProtectionLaw: 'Lalàna mifehy',
  regulator: 'Manam-pahefana mpanara-maso',
  breachWindow: 'Fe-potoana fampandrenesana',
  withoutDelay: 'Avy hatrany',
  retention: 'Faharetan’ny fitehirizana',
  unconfirmed: 'Mbola hamarinina',
  unreviewedTranslation:
    'Tsy mbola nohamarinin’ny mpiteny ny fandikan-teny {lang}. Hamarino amin’ny marary ny dosy.',
  researchConsent: 'Fanekena fikarohana',
  researchConsentHint: 'Manaiky ve ny marary hampiasaina amin’ny fikarohana ny antontan-taratasiny?',
  consentGranted: 'Nekena',
  consentRefused: 'Nolavina',
  consentNotAsked: 'Tsy mbola nangatahina',
  excludedForConsent: 'marary tsy tafiditra, tsy nanaiky',
  notLegalAdvice: 'Torohevitra fotsiny ireto vaovao ireto ary tsy nohamarinin’ny mpahay lalàna ao amin’ity firenena ity.',
  piiPack: 'Modely fanafenana anarana',
  piiPackHint: 'Mahita anarana tsy ao amin’ny rejisitra ao anaty naotra, ohatra havana voatonona. Miasa ihany ny fanadiovana fototra na tsy misy izy.',
  piiPackReady: 'Voapetraka ny modely',
  piiPackAbsent: 'Tsy voapetraka. Mbola miasa ny fanadiovana fototra.',
  neuralRedactionSummary: 'avy amin’ny modely',
  enrolHint: 'Angataho amin’ny mpitantana ny serivera ny kaody fisoratana anarana, dia soraty eto. Indray mandeha isaky ny finday.',
  enrolCode: 'Kaody fisoratana anarana',
  enrolDevice: 'Hisoratra anarana ity finday ity',
  enrolling: 'Misoratra anarana…',
  enrolFailed: 'Tsy nahomby ny fisoratana anarana',
  enrolInvalidCode: 'Kaody diso, lany daty, na efa nampiasaina. Mangataha vaovao.',
  enrolRateLimited: 'Betsaka loatra ny fanandramana. Andramo indray afaka iray minitra.',
  deviceName: 'Anaran’ny finday',
  deviceNamePlaceholder: 'Finday fitsaboana 1',
  deviceEnrolled: 'Voasoratra anarana ny finday',
  unenrol: 'Esory ny fisoratana anarana',
  unenrolConfirm: 'Esorina ny fisoratana anarana? Mijanona ao amin’ny finday ny rakitra, fa mijanona ny fampifanarahana mandra-pisoratra anarana indray.',
  syncUnauthorised: 'Tsy manan-dalana intsony ity finday ity. Nofoanana ny fidirany; mangataha kaody vaovao.',
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
  amend: 'Hanitsy',
  amendNotice:
    'Efa voamarina ity fitsaboana ity. Ny fanitsiana dia hanolo ny rakitra ary halefa indray amin’ny fampifanarahana.',
  saveCorrection: 'Tehirizo ny fanitsiana',
  deleteRecord: 'Fafao ity fitsaboana ity',
  deleteRecordConfirm:
    'Hofafana tanteraka ity fitsaboana voamarina ity? Hiala amin’ny tatitra isam-bolana izy, na dia efa nalefa aza.',
  instructions: 'Toromarika',
  instructionsFor: 'Toromarika ho an’i',
  speakAloud: 'Henoy',
  noVoiceAvailable: 'Tsy misy feo, asehoy ny soratra.',
  print: 'Atontay',
  temperature: 'Mari-pana',
  pulse: 'Fitempon’ny fo',
  bloodPressure: 'Tosidra',
  systolic: 'Tosidra (sys)',
  diastolic: 'Tosidra (dia)',
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
  demo: 'Ohatra',
  clearData: 'Fafao ny rakitra rehetra',
  clearDataConfirm: 'Hofafana ny rakitra rehetra ato amin’ity finday ity?',
  noReportData: 'Tsy nisy fitsaboana vita ity volana ity.',
  prototypeNotice:
    'AfyaCore v0.0.1, andrana. Mbola tsy voahamarin’ny tompon-teny ny teny malagasy. Misy laharana tokony hosoloina ny fanondranana DHIS2.',
}

const en: Strings = {
  appName: 'AfyaCore',
  patients: 'Patients',
  settings: 'Settings',
  offline: 'Offline',
  online: 'Online',
  pendingSync: 'pending',
  allSynced: 'All saved',
  savedOnDevice: 'Saved on device',
  back: 'Back',
  manage: 'Manage',
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
  birthDateHint: 'Leave blank if unknown',
  approximateAge: 'Approximate age',
  phone: 'Phone',
  address: 'Village / Fokontany',
  registerNo: 'Register no.',
  preferredLang: 'Patient language',
  preferredLangHint: 'Language the patient’s instruction sheet is printed in',
  editPatient: 'Edit patient',
  savePatient: 'Save changes',
  deletePatient: 'Delete patient',
  deletePatientConfirm: 'Delete this patient and their whole record?',
  consultationsWillBeDeleted: 'consultation(s) will be deleted too.',
  mergeDuplicate: 'Merge a duplicate',
  mergeHint:
    'Pick the duplicate record. Its consultations move onto this one, and any field blank here is filled in from it.',
  mergeInto: 'Merge into this record',
  mergeConfirm: 'Merge these two records?',
  consultationsMoved: 'consultation(s) moved',
  noOtherPatients: 'No other record to merge',
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
  syncNow: 'Sync now',
  syncing: 'Syncing…',
  lastSync: 'Last sync',
  syncNever: 'Never synced',
  syncNotConfigured: 'Set the server address to enrol this device.',
  syncFailed: 'Sync failed',
  syncSummary: 'sent / received',
  lockSubtitle: 'Enter your PIN to continue',
  firstRunSubtitle: 'Set up the first account',
  firstRunHint: 'This first account is an administrator: it can enrol the device and add colleagues.',
  yourName: 'Your name',
  nameRequired: 'A name is required.',
  choosePin: 'Choose a PIN',
  confirmPin: 'Confirm PIN',
  pin: 'PIN',
  pinHint: '4 to 12 digits. Avoid 0000 or 1234.',
  pinMismatch: 'The two PINs do not match.',
  pinWrong: 'Wrong PIN.',
  pinLockedOut: 'Too many attempts. Device locked for',
  attemptsRemaining: 'attempt(s) left.',
  pinPolicy: {
    too_short: 'The PIN must be at least 4 digits.',
    too_long: 'The PIN cannot be longer than 12 digits.',
    not_numeric: 'The PIN must be digits only.',
    sequential: 'Avoid a run like 1234.',
    repeated: 'Avoid a repeated PIN like 0000.',
  },
  createAccount: 'Create account',
  signInAs: 'Sign in as',
  unlock: 'Unlock',
  signOut: 'Sign out',
  clear: 'Clear',
  backspace: 'Backspace',
  staff: 'Staff',
  addStaff: 'Add an account',
  role: 'Role',
  roleClinician: 'Clinician',
  roleAdmin: 'Administrator',
  disableAccount: 'Disable account',
  disableAccountConfirm: 'Disable this account? It can no longer sign in, but its history stays in the audit log.',
  auditTrail: 'Audit trail',
  auditVerify: 'Verify the log',
  auditIntact: 'Log intact',
  auditBroken: 'Log altered at entry',
  auditEntries: 'entries',
  idleTimeout: 'Automatic lock',
  idleTimeoutHint: 'How long the device may sit idle before it asks for the PIN again.',
  adminOnly: 'Administrators only.',
  you: 'you',
  lastAdmin: 'Last administrator: this account cannot be disabled.',
  auditVerifiedFrom: 'verified from entry',
  country: 'Country',
  countryHint: 'Sets the language clinical notes are written in, the phone-number formats removed on export, and which data protection regime applies.',
  clinicalLanguage: 'Clinical language',
  facilityType: 'Facility type',
  reportingSystem: 'Reporting system',
  dataProtectionLaw: 'Governing law',
  regulator: 'Supervisory authority',
  breachWindow: 'Breach notification',
  withoutDelay: 'Without delay',
  retention: 'Retention period',
  unconfirmed: 'To confirm',
  unreviewedTranslation:
    'The {lang} translation has not been checked by a speaker. Confirm the dosage with the patient.',
  researchConsent: 'Research consent',
  researchConsentHint: 'Has the patient agreed to their record being used for research?',
  consentGranted: 'Granted',
  consentRefused: 'Refused',
  consentNotAsked: 'Not asked',
  excludedForConsent: 'patients excluded, no consent',
  notLegalAdvice: 'Recorded for guidance and not reviewed by a lawyer in this jurisdiction. This is not legal advice.',
  piiPack: 'De-identification model',
  piiPackHint: 'Finds names in notes that the roster does not hold, such as a relative mentioned in passing. The deterministic scrub works without it.',
  piiPackReady: 'Model installed, neural pass active',
  piiPackAbsent: 'Not installed. The deterministic scrub still runs. An administrator can install it on the server.',
  neuralRedactionSummary: 'by the model',
  enrolHint: 'Ask the server administrator for an enrolment code, then enter it here. Once per device.',
  enrolCode: 'Enrolment code',
  enrolDevice: 'Enrol this device',
  enrolling: 'Enrolling…',
  enrolFailed: 'Enrolment failed',
  enrolInvalidCode: 'Code is invalid, expired or already used. Ask for a new one.',
  enrolRateLimited: 'Too many attempts. Try again in a minute.',
  deviceName: 'Device name',
  deviceNamePlaceholder: 'Consultation phone 1',
  deviceEnrolled: 'Device enrolled',
  unenrol: 'Un-enrol this device',
  unenrolConfirm: 'Un-enrol this device? Records stay on the phone, but syncing stops until it is enrolled again.',
  syncUnauthorised: 'This device is no longer authorised. Its access was revoked; ask for a new code.',
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
  amend: 'Correct',
  amendNotice:
    'This consultation is already confirmed. A correction replaces the record and will be sent again on the next sync.',
  saveCorrection: 'Save correction',
  deleteRecord: 'Delete consultation',
  deleteRecordConfirm:
    'Permanently delete this confirmed consultation? It will drop out of the monthly reports, including any already submitted.',
  instructions: 'Patient instructions',
  instructionsFor: 'Instructions for',
  speakAloud: 'Listen',
  noVoiceAvailable: 'No voice available, show the text to the patient.',
  print: 'Print',
  temperature: 'Temperature',
  pulse: 'Pulse',
  bloodPressure: 'Blood pressure',
  systolic: 'BP systolic',
  diastolic: 'BP diastolic',
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
  demo: 'Demo',
  clearData: 'Erase all data',
  clearDataConfirm: 'Erase all data on this device?',
  noReportData: 'No confirmed consultations this month.',
  prototypeNotice:
    'AfyaCore v0.0.1, prototype. The Malagasy labels have not yet been reviewed by a native speaker. The DHIS2 export contains placeholder identifiers.',
}

export const STRINGS: Record<LangCode, Strings> = { fr, mg, en }

export const LANG_LABELS: Record<LangCode, string> = {
  fr: 'Français',
  mg: 'Malagasy',
  en: 'English',
}

/**
 * Data model for AfyaCore.
 *
 * Field names deliberately track FHIR R4 resource shapes (Patient, Encounter,
 * Observation, MedicationRequest) without pulling in a FHIR library. The goal is
 * that exporting to FHIR, and therefore into OpenMRS or DHIS2, which is what
 * ministries and NGOs across the region actually run, is a mapping exercise
 * rather than a migration. See docs/MODEL-RESEARCH.md §1.
 */

/** How a given piece of data got into the record. Drives the review UI. */
export type CaptureSource = 'manual' | 'voice' | 'photo'

export type Sex = 'female' | 'male' | 'unknown'

/** ISO-639-1-ish codes for the languages this deployment cares about. */
export type LangCode = 'fr' | 'mg' | 'en'

export interface Patient {
  id: string
  /** Facility-assigned register number, e.g. the number on the paper card. */
  registerNo?: string
  givenName: string
  familyName: string
  sex: Sex
  /** ISO date. Many patients know only a birth year; see `birthDatePrecision`. */
  birthDate?: string
  birthDatePrecision?: 'day' | 'month' | 'year' | 'estimated'
  /** Fallback when no birth date is known at all, extremely common. */
  approximateAge?: number
  phone?: string
  /** Free text: village, fokontany, commune. */
  address?: string
  /** Language to speak/print patient instructions in. */
  preferredLang: LangCode
  /**
   * Denormalised, accent-stripped, lowercased name + register number.
   * Malagasy names are long and inconsistently accented on paper cards, so
   * searching the raw fields misses records constantly. Maintained by the repo
   * layer, never set this by hand.
   */
  searchKey: string
  createdAt: number
  updatedAt: number
  /** Set once the record has been accepted by a server. Null while local-only. */
  syncedAt?: number
  /**
   * Soft delete. A hard delete cannot propagate: the other device has no way to
   * learn that a row it still holds is gone. Deleted records stay in the table
   * as tombstones and are filtered out of every query.
   */
  deletedAt?: number
}

export interface Vitals {
  /** °C */
  temperature?: number
  /** beats/min */
  pulse?: number
  /** mmHg */
  systolic?: number
  diastolic?: number
  /** breaths/min */
  respiratoryRate?: number
  /** kg */
  weight?: number
  /** cm */
  height?: number
  /** % SpO2 */
  oxygenSaturation?: number
}

export type VitalKey = keyof Vitals

export interface Prescription {
  id: string
  /** Drug name as written by the clinician, in French. */
  drug: string
  /** e.g. "500 mg" */
  dose?: string
  /** Times per day. Drives the Malagasy instruction phrase. */
  frequencyPerDay?: number
  /** Days of treatment. */
  durationDays?: number
  notes?: string
}

/**
 * Provenance for a single field. Kept per-field rather than per-encounter
 * because a single consultation routinely mixes dictation, typing and a photo,
 * and the review screen has to show the clinician exactly which is which.
 */
export interface FieldProvenance {
  source: CaptureSource
  /** 0–1. Only meaningful for `voice`/`photo`. */
  confidence?: number
  /** The raw text the value was extracted from, for audit and correction. */
  rawText?: string
}

export interface Encounter {
  id: string
  patientId: string
  /** Epoch ms. */
  occurredAt: number
  /** Reason for visit, free text, French. */
  chiefComplaint?: string
  /** Clinical narrative, French. */
  notes?: string
  diagnosis?: string
  vitals: Vitals
  prescriptions: Prescription[]
  /** Keyed by field path, e.g. "vitals.temperature" or "chiefComplaint". */
  provenance: Record<string, FieldProvenance>
  /** IDs into the `attachments` table. */
  attachmentIds: string[]
  /**
   * Encounters start as drafts. Nothing AI-derived is ever committed without a
   * human pressing confirm, the draft/final split is what makes that literal.
   */
  status: 'draft' | 'final'
  createdAt: number
  updatedAt: number
  syncedAt?: number
  /** Soft delete tombstone. See Patient.deletedAt. */
  deletedAt?: number
}

export interface Attachment {
  id: string
  encounterId: string
  /** Compressed JPEG of a paper register page, wound photo, lab slip, etc. */
  blob: Blob
  width: number
  height: number
  byteSize: number
  /** Populated once OCR exists. Null means "not attempted". */
  extractedText?: string
  createdAt: number
}

/** Free-form key/value settings, kept in IndexedDB so they survive offline. */
export interface Setting {
  key: string
  value: unknown
}

/** Vital-sign plausibility bounds. Values outside these are almost certainly a
 *  mis-transcription rather than a real reading, so the UI blocks them at input
 *  rather than letting a "temperature of 385" reach the record. */
export const VITAL_RANGES: Record<VitalKey, { min: number; max: number; unit: string; decimals: number }> = {
  temperature: { min: 30, max: 45, unit: '°C', decimals: 1 },
  pulse: { min: 20, max: 250, unit: '/min', decimals: 0 },
  systolic: { min: 50, max: 260, unit: 'mmHg', decimals: 0 },
  diastolic: { min: 20, max: 180, unit: 'mmHg', decimals: 0 },
  respiratoryRate: { min: 5, max: 90, unit: '/min', decimals: 0 },
  weight: { min: 0.5, max: 300, unit: 'kg', decimals: 1 },
  height: { min: 20, max: 250, unit: 'cm', decimals: 0 },
  oxygenSaturation: { min: 50, max: 100, unit: '%', decimals: 0 },
}

/**
 * Clinically urgent thresholds. These are intentionally conservative,
 * non-diagnostic triage flags, they colour a number red and nothing more. They
 * do not suggest a diagnosis, and they never alter the record.
 */
export function vitalSeverity(key: VitalKey, value: number): 'normal' | 'watch' | 'urgent' {
  switch (key) {
    case 'temperature':
      if (value >= 39.5 || value < 35) return 'urgent'
      if (value >= 38) return 'watch'
      return 'normal'
    case 'pulse':
      if (value >= 130 || value < 45) return 'urgent'
      if (value >= 100 || value < 55) return 'watch'
      return 'normal'
    case 'systolic':
      if (value >= 180 || value < 90) return 'urgent'
      if (value >= 140) return 'watch'
      return 'normal'
    case 'diastolic':
      if (value >= 120 || value < 50) return 'urgent'
      if (value >= 90) return 'watch'
      return 'normal'
    case 'respiratoryRate':
      if (value >= 30 || value < 8) return 'urgent'
      if (value >= 24) return 'watch'
      return 'normal'
    case 'oxygenSaturation':
      if (value < 90) return 'urgent'
      if (value < 94) return 'watch'
      return 'normal'
    default:
      return 'normal'
  }
}

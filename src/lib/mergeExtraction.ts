/**
 * Merge an extraction into a draft encounter.
 *
 * Shared by dictation and photo OCR: both produce French text, both run through
 * the same rule extractor, and both must obey the same rule, **machine output
 * never overwrites something a human entered**. If the clinician has already
 * typed a temperature, a recogniser hearing a different one is discarded, not
 * applied. Silently replacing human input would be the most damaging thing
 * either feature could do.
 */
import type { CaptureSource, Encounter, FieldProvenance, Prescription, VitalKey } from '../db/schema'
import type { ExtractionResult } from './clinicalExtract'
import type { EncounterPatch } from '../db/repo'
import { newId } from './id'

export interface MergeOutcome {
  patch: EncounterPatch
  /** How many fields were actually applied, zero means "nothing recognised". */
  applied: number
}

export function mergeExtraction(
  encounter: Encounter,
  result: ExtractionResult,
  rawText: string,
  source: CaptureSource,
  /** Scales rule confidence; OCR is less trustworthy than a clean transcript. */
  confidenceScale = 1,
): MergeOutcome {
  const provenance: Record<string, FieldProvenance> = {}
  const vitals: Partial<Record<VitalKey, number>> = {}
  let applied = 0

  for (const [key, field] of Object.entries(result.vitals)) {
    const k = key as VitalKey
    if (encounter.vitals[k] !== undefined) continue
    vitals[k] = field.value
    provenance[`vitals.${k}`] = {
      source,
      confidence: field.confidence * confidenceScale,
      rawText: field.rawText,
    }
    applied++
  }

  const patch: EncounterPatch = { vitals }

  if (result.chiefComplaint && !encounter.chiefComplaint) {
    patch.chiefComplaint = result.chiefComplaint.value
    provenance.chiefComplaint = {
      source,
      confidence: result.chiefComplaint.confidence * confidenceScale,
      rawText: result.chiefComplaint.rawText,
    }
    applied++
  }

  if (result.diagnosis && !encounter.diagnosis) {
    patch.diagnosis = result.diagnosis.value
    provenance.diagnosis = {
      source,
      confidence: result.diagnosis.confidence * confidenceScale,
      rawText: result.diagnosis.rawText,
    }
    applied++
  }

  if (result.prescriptions.length > 0) {
    const existing = new Set(encounter.prescriptions.map((p) => p.drug.toLowerCase().trim()))
    const added: Prescription[] = []
    for (const p of result.prescriptions) {
      if (existing.has(p.drug.toLowerCase().trim())) continue
      const id = newId()
      added.push({
        id,
        drug: p.drug,
        dose: p.dose,
        frequencyPerDay: p.frequencyPerDay,
        durationDays: p.durationDays,
      })
      provenance[`prescription.${id}`] = {
        source,
        confidence: p.confidence * confidenceScale,
        rawText: p.rawText,
      }
      applied++
    }
    if (added.length > 0) patch.prescriptions = [...encounter.prescriptions, ...added]
  }

  // Whatever no rule claimed is still clinically meaningful, so it is appended
  // to the notes rather than thrown away. When nothing matched at all, the full
  // text is kept so the clinician never loses what they said or photographed.
  const leftover = result.remainder || rawText
  if (leftover) {
    patch.notes = encounter.notes ? `${encounter.notes}\n${leftover}` : leftover
    provenance.notes = { source, confidence: 0.6 * confidenceScale, rawText }
    applied++
  }

  patch.provenance = provenance
  return { patch, applied }
}

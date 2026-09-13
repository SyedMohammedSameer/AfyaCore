/**
 * Per-field review of machine-entered values.
 *
 * The review screen used to be one button: a clinician looked at a page of
 * dictated values and pressed "Confirm". That is a safeguard only for as long
 * as people read the page, and by the fortieth patient of the day nobody does.
 *
 * So every value the machine produced, whether transcribed from speech or read
 * off a photograph, now has to be ticked individually before the consultation
 * can be confirmed, and the tick is bound to the exact value the reviewer saw.
 * If the value changes afterwards, by a second dictation or a manual edit that
 * re-applied an extraction, the tick no longer matches and the field is
 * pending again. A reviewer therefore cannot approve a temperature and have a
 * different temperature ship under that approval.
 *
 * Nothing here is a security control. The signature is a snapshot for
 * comparison, not an integrity hash, and it lives inside the record it
 * describes. Its job is to make "who looked at this value, and which value"
 * answerable, and to keep a stale approval from covering a new number.
 *
 * Manual entries need no review: the person who typed a value is the review.
 */
import type { Encounter, VitalKey } from '../db/schema'

/** The current value behind a provenance key, in a shape that can be compared. */
export function fieldValue(encounter: Encounter, key: string): unknown {
  if (key.startsWith('vitals.')) return encounter.vitals[key.slice('vitals.'.length) as VitalKey]
  if (key.startsWith('prescription.')) {
    const p = encounter.prescriptions.find((p) => p.id === key.slice('prescription.'.length))
    // A fixed order, so two equivalent prescriptions produce the same
    // signature regardless of how the object was assembled.
    return p ? [p.drug, p.dose, p.frequencyPerDay, p.durationDays, p.notes] : undefined
  }
  if (key === 'chiefComplaint' || key === 'diagnosis' || key === 'notes') return encounter[key]
  return undefined
}

/**
 * An exact snapshot of a field and where it came from.
 *
 * Not an integrity or security hash. It is stripped from every de-identified
 * export because it quotes the value and the raw dictation verbatim.
 */
export function fieldSignature(encounter: Encounter, key: string): string {
  const p = encounter.provenance[key]
  return JSON.stringify([fieldValue(encounter, key), p?.source, p?.rawText, p?.confidence])
}

/** Every field the machine filled in that currently holds a value. */
export function machineFields(encounter: Encounter): string[] {
  return Object.entries(encounter.provenance)
    .filter(([key, p]) => {
      const value = fieldValue(encounter, key)
      return p.source !== 'manual' && value !== undefined && value !== ''
    })
    .map(([key]) => key)
}

/** True when a signed-in reviewer has ticked this field as it currently stands. */
export function isReviewed(encounter: Encounter, key: string): boolean {
  const review = encounter.fieldReviews?.[key]
  return Boolean(review?.by) && review!.signature === fieldSignature(encounter, key)
}

/**
 * True when a field was ticked once and has changed since.
 *
 * Shown differently from "never looked at": a value that moved under an
 * approval is the case this whole module exists for, and the reviewer should
 * be told that is what happened rather than see a plain empty checkbox.
 */
export function isStale(encounter: Encounter, key: string): boolean {
  const review = encounter.fieldReviews?.[key]
  return Boolean(review?.by) && review!.signature !== fieldSignature(encounter, key)
}

/** Machine fields still waiting for a tick. Empty means the record may be confirmed. */
export function pendingReviews(encounter: Encounter): string[] {
  return machineFields(encounter).filter((key) => !isReviewed(encounter, key))
}

export interface ReviewProgress {
  total: number
  done: number
  pending: string[]
}

export function reviewProgress(encounter: Encounter): ReviewProgress {
  const fields = machineFields(encounter)
  const pending = fields.filter((key) => !isReviewed(encounter, key))
  return { total: fields.length, done: fields.length - pending.length, pending }
}

/**
 * The record with every unconfirmed machine value taken out of it.
 *
 * The principle, stated once: **a machine value no human has confirmed is not
 * part of the record.** For a draft that is enforced by the draft/final split,
 * since nothing counts a draft. For a *confirmed* record being corrected it
 * was not enforced at all, and that was a real hole: `finaliseEncounter`
 * guards the moment a draft becomes final, but an amendment writes into a
 * record that is already final, so a photo read during a correction put an
 * unconfirmed weight and an unconfirmed diagnosis straight into the next
 * research export and counted the diagnosis as a malaria case in the monthly
 * return to the ministry. The README claimed the opposite in its first
 * paragraph.
 *
 * Demoting the record back to `draft` would fix the leak and break something
 * worse: the consultation really did happen, it was confirmed by a human once,
 * and dropping it out of a monthly figure that may already have been submitted
 * is its own kind of wrong. So the *record* stands and the *unconfirmed field*
 * is withheld, which is the smaller and more honest claim.
 *
 * Nothing is lost by this. `mergeExtraction` never overwrites a value that is
 * already there, so a machine value on an amendment is always a field that was
 * previously blank; withholding it restores exactly what the confirmed record
 * said. The count travels in the export manifest so a recipient can see that
 * something was held back rather than never recorded.
 *
 * Applied where the record leaves the device (`deidentify`) and where it
 * becomes a statistic (`aggregateMonth`), not at the query boundary: the
 * clinician holding the phone must still see the value, or they can never
 * review it.
 */
export function withholdPendingFields(encounter: Encounter): {
  encounter: Encounter
  withheld: string[]
} {
  const withheld = pendingReviews(encounter)
  if (withheld.length === 0) return { encounter, withheld }

  const vitals = { ...encounter.vitals }
  const provenance = { ...encounter.provenance }
  let prescriptions = encounter.prescriptions
  const next: Encounter = { ...encounter, vitals, provenance }

  for (const key of withheld) {
    delete provenance[key]
    if (key.startsWith('vitals.')) {
      delete vitals[key.slice('vitals.'.length) as VitalKey]
    } else if (key.startsWith('prescription.')) {
      const id = key.slice('prescription.'.length)
      prescriptions = prescriptions.filter((p) => p.id !== id)
    } else if (key === 'chiefComplaint' || key === 'diagnosis' || key === 'notes') {
      next[key] = undefined
    }
  }

  next.prescriptions = prescriptions
  return { encounter: next, withheld }
}

/** Apply `withholdPendingFields` across a set, with the total held back. */
export function withholdAcross(encounters: Encounter[]): {
  encounters: Encounter[]
  withheld: number
} {
  let withheld = 0
  const out = encounters.map((e) => {
    const result = withholdPendingFields(e)
    withheld += result.withheld.length
    return result.encounter
  })
  return { encounters: out, withheld }
}

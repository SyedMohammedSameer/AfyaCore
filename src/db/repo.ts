import { db } from './db'
import { newId } from '../lib/id'
import { recordAudit } from '../lib/audit'
import type { ConsentState, Encounter, FieldProvenance, Patient, Prescription, Vitals } from './schema'

/** Strip diacritics and case so "Rakotoarisoa" and "RAKOTOÀRISOA" match. */
export function normalise(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
}

function buildSearchKey(p: Pick<Patient, 'givenName' | 'familyName' | 'registerNo' | 'phone'>): string {
  return normalise([p.familyName, p.givenName, p.registerNo ?? '', p.phone ?? ''].join(' ')).replace(/\s+/g, ' ')
}

export type NewPatientInput = Omit<Patient, 'id' | 'createdAt' | 'updatedAt' | 'searchKey'>

export async function createPatient(input: NewPatientInput): Promise<string> {
  const now = Date.now()
  const patient: Patient = {
    ...input,
    id: newId(),
    searchKey: buildSearchKey(input),
    createdAt: now,
    updatedAt: now,
  }
  await db.patients.add(patient)
  await recordAudit({ action: 'patient.create', subjectType: 'patient', subjectId: patient.id })
  return patient.id
}

export async function updatePatient(id: string, changes: Partial<NewPatientInput>): Promise<void> {
  const existing = await db.patients.get(id)
  if (!existing) throw new Error(`Patient ${id} not found`)
  const merged = { ...existing, ...changes }
  await db.patients.update(id, {
    ...changes,
    searchKey: buildSearchKey(merged),
    updatedAt: Date.now(),
    // Any local edit invalidates the previous server acknowledgement.
    syncedAt: undefined,
  })
  // Field names, never values. Knowing that a phone number was changed is
  // governance; recording what it was changed to would put the identifier in a
  // second place with weaker protections.
  await recordAudit({
    action: 'patient.update',
    subjectType: 'patient',
    subjectId: id,
    detail: Object.keys(changes).join(','),
  })
}

/**
 * Substring search across the normalised key.
 *
 * Deliberately a full scan rather than a prefix index: a clinician holding a
 * paper card often types the *given* name when the record is filed under the
 * family name, and prefix-only matching fails exactly when it is needed most.
 * A rural facility's roster is in the low thousands, where a scan is instant.
 */
export async function searchPatients(query: string, limit = 50): Promise<Patient[]> {
  const q = normalise(query)
  const live = (p: Patient) => p.deletedAt === undefined
  const collection = q
    ? db.patients.filter((p) => live(p) && p.searchKey.includes(q))
    : db.patients.orderBy('updatedAt').reverse().filter(live)
  const rows = await collection.limit(limit).toArray()
  return q ? rows.sort((a, b) => b.updatedAt - a.updatedAt) : rows
}

export async function createDraftEncounter(patientId: string): Promise<string> {
  const now = Date.now()
  const encounter: Encounter = {
    id: newId(),
    patientId,
    occurredAt: now,
    vitals: {},
    prescriptions: [],
    provenance: {},
    attachmentIds: [],
    status: 'draft',
    createdAt: now,
    updatedAt: now,
  }
  await db.encounters.add(encounter)
  await recordAudit({
    action: 'encounter.create',
    subjectType: 'encounter',
    subjectId: encounter.id,
  })
  return encounter.id
}

export interface EncounterPatch {
  chiefComplaint?: string
  notes?: string
  diagnosis?: string
  vitals?: Vitals
  prescriptions?: Prescription[]
  occurredAt?: number
  /** Merged into, not replacing, existing provenance. */
  provenance?: Record<string, FieldProvenance>
}

/**
 * Deliberately not audited.
 *
 * This fires on every field edit while a consultation is being typed, so an
 * entry per call would bury the log in hundreds of rows per patient and make
 * the entries that matter unfindable. The pair that brackets it, `create` and
 * `finalise`/`amend`, is what a reviewer actually needs: a draft's intermediate
 * states are working notes, and the record is the thing a human confirmed.
 */
export async function patchEncounter(id: string, patch: EncounterPatch): Promise<void> {
  await db.transaction('rw', db.encounters, async () => {
    const existing = await db.encounters.get(id)
    if (!existing) throw new Error(`Encounter ${id} not found`)
    await db.encounters.update(id, {
      ...patch,
      vitals: patch.vitals ? { ...existing.vitals, ...patch.vitals } : existing.vitals,
      provenance: patch.provenance ? { ...existing.provenance, ...patch.provenance } : existing.provenance,
      updatedAt: Date.now(),
      syncedAt: undefined,
    })
  })
}

/** Promote a draft to a permanent record. The only place `status` becomes final. */
export async function finaliseEncounter(id: string): Promise<void> {
  const existing = await db.encounters.get(id)
  await db.encounters.update(id, { status: 'final', updatedAt: Date.now(), syncedAt: undefined })
  // Amending an already-final record is a different act from confirming a draft
  // for the first time, and a reviewer asking "was this changed after it was
  // signed off" needs the two to be distinguishable.
  await recordAudit({
    action: existing?.status === 'final' ? 'encounter.amend' : 'encounter.finalise',
    subjectType: 'encounter',
    subjectId: id,
  })
}

/**
 * Soft-delete an encounter.
 *
 * The row survives as a tombstone so the deletion can reach other devices; a
 * hard delete would simply reappear on the next pull. Attachments are removed
 * outright because they never sync and are the only thing here large enough to
 * be worth reclaiming.
 */
export async function deleteEncounter(id: string): Promise<void> {
  await db.transaction('rw', db.encounters, db.attachments, async () => {
    await db.attachments.where('encounterId').equals(id).delete()
    const now = Date.now()
    await db.encounters.update(id, {
      deletedAt: now,
      attachmentIds: [],
      updatedAt: now,
      syncedAt: undefined,
    })
  })
  await recordAudit({ action: 'encounter.delete', subjectType: 'encounter', subjectId: id })
}

/**
 * Soft-delete a patient and everything recorded about them.
 *
 * The patient row and every encounter row survive as tombstones, for the same
 * reason a deleted encounter does: a hard delete cannot propagate, so the other
 * phone at the facility would keep a record this device believes is gone. The
 * schema, the Dexie v2 index and the sync protocol were all built for this;
 * this is the function that finally sets the flag.
 *
 * Attachments are destroyed outright rather than tombstoned. They never sync,
 * so nothing else needs to learn they are gone, and they are the only thing
 * here large enough that keeping them would be a real cost.
 */
/**
 * Record what a patient said about their record being used for research.
 *
 * Separate from `updatePatient` on purpose. Consent is not another demographic
 * field: it is the thing that decides whether this person's record may leave
 * the facility, it has to carry who recorded it and when, and it is the one
 * change to a patient that a regulator will ask to see evidence of. Folding it
 * into a general update would lose all three.
 */
export async function recordResearchConsent(
  id: string,
  state: ConsentState,
  actorId?: string,
): Promise<void> {
  const now = Date.now()
  await db.patients.update(id, {
    researchConsent: state,
    researchConsentAt: now,
    researchConsentBy: actorId,
    updatedAt: now,
    syncedAt: undefined,
  })
  await recordAudit({
    action: 'consent.record',
    subjectType: 'patient',
    subjectId: id,
    // The state is in the detail because a withdrawal is the entry that
    // matters most and it is indistinguishable from a grant without it.
    detail: `research=${state}`,
  })
}

export async function deletePatient(id: string): Promise<void> {
  await db.transaction('rw', db.patients, db.encounters, db.attachments, db.audit, async () => {
    const now = Date.now()
    const encounters = await db.encounters.where('patientId').equals(id).toArray()

    for (const encounter of encounters) {
      await db.attachments.where('encounterId').equals(encounter.id).delete()
      await db.encounters.update(encounter.id, {
        deletedAt: now,
        attachmentIds: [],
        updatedAt: now,
        syncedAt: undefined,
      })
    }

    await db.patients.update(id, { deletedAt: now, updatedAt: now, syncedAt: undefined })
    // The consultation count is the part that matters on review: deleting a
    // patient with eleven consultations is a different act from deleting an
    // empty registration made by mistake.
    await recordAudit({
      action: 'patient.delete',
      subjectType: 'patient',
      subjectId: id,
      detail: `${encounters.length} encounters`,
    })
  })
}

export interface MergeOutcome {
  /** Encounters moved onto the surviving record. */
  moved: number
  /** Fields the surviving record was missing and inherited from the duplicate. */
  filled: string[]
}

/** Fields a merge is allowed to copy across when the survivor left them blank. */
const MERGEABLE_FIELDS = [
  'givenName',
  'birthDate',
  'approximateAge',
  'phone',
  'address',
  'registerNo',
] as const

/**
 * Decide what a merge copies from the duplicate onto the surviving record.
 *
 * Split out from `mergePatients` and pure, because this is the part with a
 * judgement in it: the transaction around it only moves rows. The rule is that
 * the survivor's own values are never overwritten, so a merge can add what was
 * missing but can never replace a phone number somebody deliberately corrected.
 */
export function mergeFields(
  keep: Patient,
  duplicate: Patient,
): { changes: Partial<Patient>; filled: string[] } {
  const changes: Partial<Patient> = {}
  const filled: string[] = []

  for (const field of MERGEABLE_FIELDS) {
    const mine = keep[field]
    const theirs = duplicate[field]
    // Empty string counts as blank: a patient registered in a hurry often has
    // a family name and nothing else.
    if ((mine === undefined || mine === '') && theirs !== undefined && theirs !== '') {
      Object.assign(changes, { [field]: theirs })
      filled.push(field)
    }
  }

  if (keep.sex === 'unknown' && duplicate.sex !== 'unknown') {
    changes.sex = duplicate.sex
    filled.push('sex')
  }

  // Precision travels with the date it describes, or it would claim a
  // day-accurate birth date the record does not actually have.
  if (changes.birthDate !== undefined) changes.birthDatePrecision = duplicate.birthDatePrecision

  return { changes, filled }
}

/**
 * Fold a duplicate patient into the one that is being kept.
 *
 * The same person registered twice is routine on a paper roster: a card is
 * mislaid, a name is spelled differently, and two rows accumulate different
 * halves of one clinical history. Merging has to move the *encounters*, because
 * a history split across two records is the actual harm, not the duplicate row.
 *
 * Two rules:
 *
 *  1. The surviving record's own values are never overwritten. Only fields it
 *     left blank are filled in from the duplicate, so a merge cannot quietly
 *     replace a phone number someone deliberately corrected.
 *  2. The duplicate becomes a tombstone rather than disappearing, so the merge
 *     reaches the facility's other devices instead of the duplicate reappearing
 *     on the next pull.
 */
export async function mergePatients(keepId: string, duplicateId: string): Promise<MergeOutcome> {
  if (keepId === duplicateId) throw new Error('Cannot merge a patient into itself')

  return db.transaction('rw', db.patients, db.encounters, db.audit, async () => {
    const [keep, duplicate] = await Promise.all([db.patients.get(keepId), db.patients.get(duplicateId)])
    if (!keep) throw new Error(`Patient ${keepId} not found`)
    if (!duplicate) throw new Error(`Patient ${duplicateId} not found`)

    const now = Date.now()

    const encounters = await db.encounters.where('patientId').equals(duplicateId).toArray()
    for (const encounter of encounters) {
      await db.encounters.update(encounter.id, {
        patientId: keepId,
        updatedAt: now,
        syncedAt: undefined,
      })
    }

    const { changes, filled } = mergeFields(keep, duplicate)

    await db.patients.update(keepId, {
      ...changes,
      searchKey: buildSearchKey({ ...keep, ...changes }),
      updatedAt: now,
      syncedAt: undefined,
    })
    await db.patients.update(duplicateId, { deletedAt: now, updatedAt: now, syncedAt: undefined })

    await recordAudit({
      action: 'patient.merge',
      subjectType: 'patient',
      subjectId: keepId,
      detail: `from=${duplicateId} moved=${encounters.length} filled=${filled.join(',')}`,
    })

    return { moved: encounters.length, filled }
  })
}

export async function addAttachment(
  encounterId: string,
  blob: Blob,
  width: number,
  height: number,
): Promise<string> {
  const id = newId()
  await db.transaction('rw', db.encounters, db.attachments, async () => {
    await db.attachments.add({
      id,
      encounterId,
      blob,
      width,
      height,
      byteSize: blob.size,
      createdAt: Date.now(),
    })
    const enc = await db.encounters.get(encounterId)
    if (enc) {
      await db.encounters.update(encounterId, {
        attachmentIds: [...enc.attachmentIds, id],
        updatedAt: Date.now(),
        syncedAt: undefined,
      })
    }
  })
  return id
}

export async function removeAttachment(encounterId: string, attachmentId: string): Promise<void> {
  await db.transaction('rw', db.encounters, db.attachments, async () => {
    await db.attachments.delete(attachmentId)
    const enc = await db.encounters.get(encounterId)
    if (enc) {
      await db.encounters.update(encounterId, {
        attachmentIds: enc.attachmentIds.filter((a) => a !== attachmentId),
        updatedAt: Date.now(),
      })
    }
  })
}

export async function patientEncounters(patientId: string): Promise<Encounter[]> {
  const rows = await db.encounters.where('patientId').equals(patientId).toArray()
  return rows.filter((e) => e.deletedAt === undefined).sort((a, b) => b.occurredAt - a.occurredAt)
}

/** Every live encounter. Tombstones are never shown, counted or exported. */
export async function liveEncounters(): Promise<Encounter[]> {
  const rows = await db.encounters.toArray()
  return rows.filter((e) => e.deletedAt === undefined)
}

/** Every live patient. */
export async function livePatients(): Promise<Patient[]> {
  const rows = await db.patients.toArray()
  return rows.filter((p) => p.deletedAt === undefined)
}

export async function livePatientCount(): Promise<number> {
  return db.patients.filter((p) => p.deletedAt === undefined).count()
}

export async function liveEncounterCount(): Promise<number> {
  return db.encounters.filter((e) => e.deletedAt === undefined).count()
}

/** Age in years, tolerating the several ways a birth date may be unknown. */
export function patientAge(p: Patient, now = Date.now()): number | undefined {
  if (p.birthDate) {
    const born = new Date(p.birthDate).getTime()
    if (!Number.isNaN(born)) return Math.floor((now - born) / 31_557_600_000)
  }
  return p.approximateAge
}

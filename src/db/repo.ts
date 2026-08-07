import { db } from './db'
import { newId } from '../lib/id'
import type { Encounter, FieldProvenance, Patient, Prescription, Vitals } from './schema'

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
  await db.encounters.update(id, { status: 'final', updatedAt: Date.now(), syncedAt: undefined })
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

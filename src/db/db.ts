import Dexie, { type EntityTable } from 'dexie'
import type { Attachment, Encounter, Patient, Setting } from './schema'

/**
 * The local database is the source of truth, not a cache.
 *
 * A health post in Madagascar may go days without connectivity, and 35% of the
 * population lives more than 10 km from a facility, meaning outreach visits
 * happen entirely offline. So writes always land locally and succeed
 * immediately; `syncedAt` records whether a server has since acknowledged them.
 * There is no code path where losing the network loses a consultation.
 */
class AfyaDB extends Dexie {
  patients!: EntityTable<Patient, 'id'>
  encounters!: EntityTable<Encounter, 'id'>
  attachments!: EntityTable<Attachment, 'id'>
  settings!: EntityTable<Setting, 'key'>

  constructor() {
    super('afyacore')
    this.version(1).stores({
      // `searchKey` is a normalised name blob; see repo.ts for why we index it.
      patients: 'id, familyName, givenName, registerNo, updatedAt, syncedAt, searchKey',
      encounters: 'id, patientId, occurredAt, status, updatedAt, syncedAt',
      attachments: 'id, encounterId, createdAt',
      settings: 'key',
    })

    // v2 adds soft-delete tombstones so a deletion can reach other devices.
    this.version(2).stores({
      patients: 'id, familyName, givenName, registerNo, updatedAt, syncedAt, searchKey, deletedAt',
      encounters: 'id, patientId, occurredAt, status, updatedAt, syncedAt, deletedAt',
      attachments: 'id, encounterId, createdAt',
      settings: 'key',
    })
  }
}

export const db = new AfyaDB()

/** Count of records not yet acknowledged by a server. Drives the sync badge. */
export async function pendingSyncCount(): Promise<number> {
  const [p, e] = await Promise.all([
    db.patients.filter((r) => r.syncedAt === undefined).count(),
    // Drafts are excluded: an unconfirmed consultation is not yet a record and
    // must not be counted as work waiting to leave the device.
    db.encounters.filter((r) => r.status === 'final' && r.syncedAt === undefined).count(),
  ])
  return p + e
}

/** Records changed locally since the last successful sync, tombstones included. */
export async function unsyncedRecords() {
  const [patients, encounters] = await Promise.all([
    db.patients.filter((r) => r.syncedAt === undefined).toArray(),
    db.encounters.filter((r) => r.syncedAt === undefined && r.status === 'final').toArray(),
  ])
  return { patients, encounters }
}

import Dexie, { type EntityTable } from 'dexie'
import type { Attachment, AuditEntry, Clinician, Encounter, Patient, Setting } from './schema'
import { encryptionMiddleware } from './encryption'

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
  clinicians!: EntityTable<Clinician, 'id'>
  audit!: EntityTable<AuditEntry, 'id'>

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

    // v3 adds staff accounts and the local audit trail. Neither syncs: an
    // account is a property of the phone it was created on, and the audit log
    // records local reads the server never sees.
    this.version(3).stores({
      patients: 'id, familyName, givenName, registerNo, updatedAt, syncedAt, searchKey, deletedAt',
      encounters: 'id, patientId, occurredAt, status, updatedAt, syncedAt, deletedAt',
      attachments: 'id, encounterId, createdAt',
      settings: 'key',
      clinicians: 'id, name, role, disabledAt',
      audit: 'id, seq, actorId, action, at',
    })

    /*
     * v4 drops the four indexes that were plaintext copies of a patient's
     * identity.
     *
     * An index is stored in the clear whatever the row is, so `searchKey` —
     * every patient's normalised name and register number, concatenated — sat
     * beside the ciphertext of their record and gave away most of what the
     * encryption was for. `familyName`, `givenName` and `registerNo` are the
     * same argument three more times.
     *
     * Nothing looked any of them up: `searchPatients` has always scanned with
     * a JS predicate rather than seeking on the index, so this costs nothing
     * at the query end. What remains indexed is ids and timestamps, which is
     * what `PLANS` in encryption.ts keeps readable and argues for there.
     */
    this.version(4).stores({
      patients: 'id, updatedAt, syncedAt, deletedAt',
      // `[status+syncedAt]` exists so the sync badge can be counted without
      // decrypting anything: both parts are plaintext, and a count request
      // never asks for values. See `pendingSyncCount`.
      encounters:
        'id, patientId, occurredAt, status, updatedAt, syncedAt, deletedAt, [status+syncedAt]',
      attachments: 'id, encounterId, createdAt',
      settings: 'key',
      clinicians: 'id, name, role, disabledAt',
      audit: 'id, seq, actorId, action, at',
    })

    this.use(encryptionMiddleware)
  }
}

export const db = new AfyaDB()

/**
 * Count of records not yet acknowledged by a server. Drives the sync badge.
 *
 * Counted by subtraction rather than by predicate, and that is not
 * micro-optimisation. This is a `useLiveQuery`, so it re-runs on every write
 * to either table — several times a minute during a consultation. A JS
 * predicate would make Dexie stream every row through it, which now means
 * decrypting the entire database to render a number in a corner.
 *
 * Both halves are index counts instead. A row whose `syncedAt` is undefined is
 * absent from that index entirely, which is exactly the set wanted, so "how
 * many are unsynced" is "how many there are" minus "how many are in the
 * index". No values are read, so nothing is decrypted.
 */
export async function pendingSyncCount(): Promise<number> {
  const [patients, syncedPatients, finals, syncedFinals] = await Promise.all([
    db.patients.count(),
    db.patients.where('syncedAt').aboveOrEqual(0).count(),
    // Drafts are excluded: an unconfirmed consultation is not yet a record and
    // must not be counted as work waiting to leave the device.
    db.encounters.where('status').equals('final').count(),
    db.encounters
      .where('[status+syncedAt]')
      .between(['final', Dexie.minKey], ['final', Dexie.maxKey], true, true)
      .count(),
  ])
  return patients - syncedPatients + (finals - syncedFinals)
}

/**
 * Records changed locally since the last successful sync, tombstones included.
 *
 * This one does decrypt everything, and it is the right place to: it runs once
 * per sync attempt, and the rows are about to be serialised and pushed anyway.
 */
export async function unsyncedRecords() {
  const [allPatients, finals] = await Promise.all([
    db.patients.toArray(),
    db.encounters.where('status').equals('final').toArray(),
  ])
  return {
    patients: allPatients.filter((r) => r.syncedAt === undefined),
    encounters: finals.filter((r) => r.syncedAt === undefined),
  }
}

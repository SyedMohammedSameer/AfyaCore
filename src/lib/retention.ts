/**
 * How long records are kept, and getting rid of the ones past it.
 *
 * ## Why this is not just a delete button
 *
 * `deletePatient` writes a tombstone: the row survives with `deletedAt` set so
 * the deletion can reach the other phones at the facility. That is correct for
 * sync — a hard delete cannot propagate, so the record would simply come back
 * on the next pull — and it is not erasure in the sense a regulator means. The
 * clinical content is still on the disk.
 *
 * Retention needs the other thing: the row genuinely gone. So a purge is a
 * different operation with different preconditions, and the preconditions are
 * what make it safe.
 *
 * ## What may be purged
 *
 * A record is eligible only when all of these hold:
 *
 *   - it is past the facility's retention period, measured from the encounter
 *     date rather than the row's creation, because retention law counts from
 *     when care was given
 *   - it is `final`, never a draft — a draft is unfinished work, not a record,
 *     and its age says nothing about whether it may be destroyed
 *   - it has been **synced**, so the facility's server holds it. Purging a
 *     record that never left the device destroys the only copy, and a phone
 *     that has been offline for a month is the normal case here, not an edge
 *     one.
 *
 * The third condition is the one that turns an irreversible operation into a
 * survivable one, and it is the reason this is not simply `where('occurredAt')
 * .below(cutoff).delete()`.
 *
 * ## What this deliberately does not do
 *
 * It does not run on a timer. A destructive operation with no human in the
 * loop, on a device that may be showing the wrong date, in a facility whose
 * retention period nobody has confirmed with counsel, is not a feature — it is
 * a way to lose a year of consultations at 3am. An administrator asks for it,
 * sees the count first, and confirms.
 *
 * It also does not purge the server. `npm run admin retention:purge` is the
 * matching operation there. Documented rather than automated, because the
 * device cannot know the server's retention obligations and should not assume
 * them.
 */
import { db } from '../db/db'
import { recordAudit } from './audit'
import { getCountryProfile } from './facility'

const RETENTION_KEY = 'facility.retentionYears'

export interface RetentionStatus {
  /** Years configured, or null when nobody has established one. */
  years: number | null
  /** Where the figure came from, which decides how much to trust it. */
  source: 'facility' | 'country' | 'unset'
  /** Encounters eligible for purge under the rules above. */
  eligible: number
  /**
   * Encounters past the period that cannot be purged because they have never
   * synced. Reported separately: this is a backup problem, not a retention
   * one, and silently counting them as "kept" hides it.
   */
  blockedUnsynced: number
}

/**
 * The retention period this facility operates under.
 *
 * Falls back to the country profile, which is `null` for most of the nine
 * because we could not establish it from a primary source. Null means "find
 * out", never "keep forever" — and with no period set, nothing is ever
 * eligible, so the safe direction is also the default.
 */
export async function getRetentionYears(): Promise<{
  years: number | null
  source: RetentionStatus['source']
}> {
  const row = await db.settings.get(RETENTION_KEY)
  if (typeof row?.value === 'number' && row.value > 0) {
    return { years: row.value, source: 'facility' }
  }
  const profile = await getCountryProfile()
  if (profile.law.retentionYears) return { years: profile.law.retentionYears, source: 'country' }
  return { years: null, source: 'unset' }
}

export async function setRetentionYears(years: number | null): Promise<void> {
  await db.settings.put({ key: RETENTION_KEY, value: years ?? 0 })
  await recordAudit({
    action: 'facility.configure',
    subjectType: 'device',
    detail: `retentionYears=${years ?? 'unset'}`,
  })
}

/** Milliseconds in a year, averaged over the leap cycle. */
const YEAR_MS = 365.2425 * 86_400_000

export function retentionCutoff(years: number, now = Date.now()): number {
  return now - years * YEAR_MS
}

/**
 * What a purge would do, without doing it.
 *
 * Always shown before the destructive call. An administrator confirming
 * "delete 1,284 consultations" is making a decision; one confirming "run
 * retention purge" is agreeing to a phrase.
 */
export async function retentionStatus(now = Date.now()): Promise<RetentionStatus> {
  const { years, source } = await getRetentionYears()
  if (years === null) return { years: null, source, eligible: 0, blockedUnsynced: 0 }

  const cutoff = retentionCutoff(years, now)
  const old = await db.encounters.filter((e) => e.occurredAt < cutoff && e.status === 'final').toArray()

  return {
    years,
    source,
    eligible: old.filter((e) => e.syncedAt !== undefined).length,
    blockedUnsynced: old.filter((e) => e.syncedAt === undefined).length,
  }
}

export interface PurgeResult {
  encounters: number
  attachments: number
  patients: number
}

/**
 * Destroy records past the retention period. Irreversible.
 *
 * Patients are removed only when nothing of theirs is left: a patient row with
 * no encounters is a registration, and keeping it would leave a roster of
 * names with no clinical justification for holding them — which is the
 * identifying half of the data surviving the clinical half it was collected
 * for.
 */
export async function purgeExpired(now = Date.now()): Promise<PurgeResult> {
  const { years } = await getRetentionYears()
  if (years === null) return { encounters: 0, attachments: 0, patients: 0 }

  const cutoff = retentionCutoff(years, now)
  const result: PurgeResult = { encounters: 0, attachments: 0, patients: 0 }

  await db.transaction('rw', db.encounters, db.attachments, db.patients, db.audit, async () => {
    const doomed = await db.encounters
      .filter((e) => e.occurredAt < cutoff && e.status === 'final' && e.syncedAt !== undefined)
      .toArray()

    const touchedPatients = new Set<string>()
    for (const encounter of doomed) {
      const attachments = await db.attachments.where('encounterId').equals(encounter.id).toArray()
      await db.attachments.where('encounterId').equals(encounter.id).delete()
      result.attachments += attachments.length
      await db.encounters.delete(encounter.id)
      result.encounters++
      touchedPatients.add(encounter.patientId)
    }

    for (const patientId of touchedPatients) {
      const remaining = await db.encounters.where('patientId').equals(patientId).count()
      if (remaining === 0) {
        await db.patients.delete(patientId)
        result.patients++
      }
    }

    // Inside the transaction: an audit entry written after a purge that then
    // failed would describe a deletion that never happened.
    await recordAudit({
      action: 'retention.purge',
      subjectType: 'patient',
      detail:
        `years=${years} encounters=${result.encounters} ` +
        `attachments=${result.attachments} patients=${result.patients}`,
    })
  })

  return result
}

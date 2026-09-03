/**
 * Local audit trail.
 *
 * The server logs what *devices* did. This logs what *people* did, which is the
 * question a data-protection regulator and a clinical incident review both
 * actually ask: who opened this record, who amended it, who exported it, who
 * deleted it. Most of that never reaches the server, because reading a record
 * is a purely local act.
 *
 * Same hash chain as the server (`server/audit.mjs`), and the same honest limit,
 * only more so: this table lives in IndexedDB on a phone whose holder can open
 * devtools. The chain makes an *edit* detectable, not a wholesale rewrite. What
 * it genuinely gives is that a record cannot be quietly altered by the app, by
 * a sync, or by a bug, and that any inconsistency is visible rather than
 * assumed away. Treat it as a clinical governance record, not as evidence
 * against a determined device owner.
 *
 * Entries name a record id, never its contents. An audit log that quotes the
 * note it is describing is a second copy of the medical record with none of its
 * protections.
 */
import Dexie from 'dexie'
import { db } from '../db/db'
import type { AuditAction, AuditEntry, Role } from '../db/schema'

export const GENESIS_HASH = '0'.repeat(64)

const encoder = new TextEncoder()

const toHex = (buffer: ArrayBuffer) =>
  [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('')

/**
 * Canonical serialisation.
 *
 * Field order is fixed here rather than inherited from object key order,
 * because `JSON.stringify` follows insertion order and a chain that depends on
 * how an object happened to be built is not a chain.
 */
function canonical(entry: Omit<AuditEntry, 'hash' | 'prevHash' | 'id'>): string {
  return JSON.stringify([
    entry.seq,
    entry.actorId ?? '',
    entry.action,
    entry.subjectType ?? '',
    entry.subjectId ?? '',
    entry.detail ?? '',
    entry.at,
  ])
}

async function sha256(input: string): Promise<string> {
  return toHex(await crypto.subtle.digest('SHA-256', encoder.encode(input)))
}

export async function chainHash(
  prevHash: string,
  entry: Omit<AuditEntry, 'hash' | 'prevHash' | 'id'>,
): Promise<string> {
  return sha256(prevHash + canonical(entry))
}

/**
 * The account actions are attributed to, set once when someone signs in.
 *
 * Module-level rather than threaded through every repository call. Passing an
 * actor id into `createPatient`, `patchEncounter`, `deletePatient` and the rest
 * would mean every one of ~30 call sites has to remember to pass it, and the
 * failure mode of forgetting is an audit entry attributed to nobody, which is
 * exactly the thing the audit trail exists to prevent. One value, set by the
 * session provider, cannot be forgotten at a call site.
 */
let currentActorId: string | undefined

/**
 * The role travels with the actor.
 *
 * Permission checks were previously only in components, which meant the
 * declared matrix in identity.ts was a description of the UI rather than a
 * property of the system: anything reachable from code — a service call, a
 * background sync, a future screen that forgot the check — was ungated. A
 * service boundary cannot ask React who is signed in, so the role lives here,
 * beside the actor id it is already tracking, and `requirePermission` in
 * identity.ts reads it.
 */
let currentRole: Role | undefined

export function setCurrentActor(id: string | undefined, role?: Role): void {
  currentActorId = id
  currentRole = id ? role : undefined
}

export function getCurrentActor(): string | undefined {
  return currentActorId
}

export function getCurrentRole(): Role | undefined {
  return currentRole
}

export interface RecordAuditInput {
  actorId?: string
  action: AuditAction
  subjectType?: 'patient' | 'encounter' | 'export' | 'device' | 'account'
  subjectId?: string
  /** Short, non-clinical context: a count, a format name, a field list. */
  detail?: string
}

/**
 * Append one entry.
 *
 * Serialised through a transaction because two concurrent appends reading the
 * same head would both chain onto it, and the loser would silently break the
 * chain it was meant to protect.
 *
 * The hash has to be wrapped in `Dexie.waitFor`. Dexie commits a transaction as
 * soon as its microtask queue drains, and `crypto.subtle.digest` returns a
 * native promise that Dexie does not know to wait on, so awaiting it directly
 * commits the transaction early and every audited write throws
 * `PrematureCommitError`. `waitFor` is the documented way to hold a transaction
 * open across a non-Dexie promise, and this is precisely the case it exists
 * for. Nothing about it is optional: without it, creating a patient fails.
 */
export async function recordAudit(input: RecordAuditInput): Promise<void> {
  await db.transaction('rw', db.audit, async () => {
    const last = await db.audit.orderBy('seq').last()
    const seq = (last?.seq ?? 0) + 1
    const body = {
      seq,
      actorId: input.actorId ?? currentActorId,
      action: input.action,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      detail: input.detail?.slice(0, 500),
      at: Date.now(),
    }
    const prevHash = last?.hash ?? GENESIS_HASH
    const hash = await Dexie.waitFor(chainHash(prevHash, body))
    await db.audit.add({ ...body, id: `${seq}`, prevHash, hash })
  })
}

export interface ChainVerification {
  ok: boolean
  entries: number
  head?: string
  brokenAt?: number
  reason?: 'prev_hash_mismatch' | 'hash_mismatch' | 'sequence_gap'
  /**
   * The sequence number verification started from. Greater than 1 once the log
   * has been trimmed, and reported rather than hidden: "verified from 4,001"
   * is a different claim from "verified from the beginning", and conflating
   * them would be the one dishonest thing an audit trail must not do.
   */
  from: number
}

/**
 * Walk the chain and report the first entry that does not verify.
 *
 * Verification starts at the oldest retained entry, not at genesis, because
 * `trimAudit` may have discarded a prefix. That entry's own `prevHash` is taken
 * on trust: it links to a record that no longer exists on this device.
 */
export async function verifyAuditChain(): Promise<ChainVerification> {
  const rows = await db.audit.orderBy('seq').toArray()
  if (rows.length === 0) return { ok: true, entries: 0, head: GENESIS_HASH, from: 1 }

  const first = rows[0]!
  let prevHash = first.prevHash
  let expectedSeq = first.seq
  const from = first.seq

  for (const row of rows) {
    if (row.seq !== expectedSeq) {
      return { ok: false, entries: expectedSeq - from, brokenAt: row.seq, reason: 'sequence_gap', from }
    }
    if (row.prevHash !== prevHash) {
      return {
        ok: false,
        entries: expectedSeq - from,
        brokenAt: row.seq,
        reason: 'prev_hash_mismatch',
        from,
      }
    }
    // Not inside a transaction, so no waitFor is needed here.
    const expected = await chainHash(prevHash, {
      seq: row.seq,
      actorId: row.actorId,
      action: row.action,
      subjectType: row.subjectType,
      subjectId: row.subjectId,
      detail: row.detail,
      at: row.at,
    })
    if (expected !== row.hash) {
      return { ok: false, entries: expectedSeq - from, brokenAt: row.seq, reason: 'hash_mismatch', from }
    }
    prevHash = row.hash
    expectedSeq++
  }

  return { ok: true, entries: rows.length, head: prevHash, from }
}

/** Most recent entries first, for the audit screen. */
export async function recentAudit(limit = 200): Promise<AuditEntry[]> {
  return db.audit.orderBy('seq').reverse().limit(limit).toArray()
}

/**
 * Drop the oldest entries once the log grows past a bound.
 *
 * A phone has finite storage and the log grows with every consultation opened.
 * Trimming from the front keeps the chain internally consistent for everything
 * that remains, at the cost of not being able to verify back to genesis. That
 * is why `verifyAuditChain` reports the sequence it started from instead of
 * silently implying it checked everything.
 *
 * Deliberately generous: 20,000 entries is years of a busy outpatient clinic.
 */
export async function trimAudit(keep = 20_000): Promise<number> {
  const total = await db.audit.count()
  if (total <= keep) return 0
  const excess = total - keep
  const oldest = await db.audit.orderBy('seq').limit(excess).toArray()
  await db.audit.bulkDelete(oldest.map((e) => e.id))
  return excess
}

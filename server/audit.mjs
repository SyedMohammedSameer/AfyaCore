/**
 * Tamper-evident audit log.
 *
 * Every data-protection regime AfyaCore is likely to meet (Madagascar's Loi
 * n°2014-038, Kenya's DPA 2019, Nigeria's NDPA 2023, POPIA, and GDPR where a
 * European partner is involved) requires a record of who accessed what, and
 * requires it to be reliable. A log an administrator can silently edit is not
 * evidence of anything.
 *
 * So each entry commits to the one before it: `hash = SHA-256(prev_hash ||
 * canonical entry)`. Deleting or altering any row breaks every hash after it,
 * and `verifyChain` finds the first break. This does not stop a determined
 * administrator with filesystem access from rewriting the whole chain, and it
 * is not claimed to: it makes tampering *detectable* rather than impossible,
 * which is the honest guarantee for a single-server deployment. Anchoring the
 * head hash off-box (printed in the monthly report, mailed to the district)
 * turns detection into prevention, and is the documented next step.
 */
import { createHash } from 'node:crypto'

export const GENESIS_HASH = '0'.repeat(64)

/**
 * Canonical serialisation of an entry.
 *
 * Field order is fixed here rather than taken from object key order, because
 * JSON.stringify follows insertion order and a chain that depends on how an
 * object happened to be built is not a chain.
 */
function canonical(entry) {
  return JSON.stringify([
    entry.facilityId ?? '',
    entry.deviceId ?? '',
    entry.actorId ?? '',
    entry.action,
    entry.detail ?? '{}',
    entry.at,
  ])
}

export function chainHash(prevHash, entry) {
  return createHash('sha256').update(prevHash).update(canonical(entry)).digest('hex')
}

export function makeAuditLog(db) {
  const insert = db.prepare(`
    INSERT INTO audit (facility_id, device_id, actor_id, action, detail, at, prev_hash, hash)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const head = db.prepare('SELECT hash FROM audit ORDER BY seq DESC LIMIT 1')
  const all = db.prepare('SELECT * FROM audit ORDER BY seq')
  const byFacility = db.prepare(
    'SELECT * FROM audit WHERE facility_id = ? ORDER BY seq DESC LIMIT ?',
  )

  return {
    /**
     * Append one entry.
     *
     * Detail is bounded because it is written from field input, and an audit
     * log that can be filled with megabytes by a malicious client is a denial
     * of service against the thing meant to catch the attack.
     */
    record({ facilityId, deviceId, actorId, action, detail }) {
      const at = Date.now()
      const entry = {
        facilityId,
        deviceId,
        actorId,
        action,
        detail: JSON.stringify(detail ?? {}).slice(0, 2000),
        at,
      }
      const prevHash = head.get()?.hash ?? GENESIS_HASH
      const hash = chainHash(prevHash, entry)
      insert.run(
        entry.facilityId ?? null,
        entry.deviceId ?? null,
        entry.actorId ?? null,
        entry.action,
        entry.detail,
        at,
        prevHash,
        hash,
      )
      return hash
    },

    head: () => head.get()?.hash ?? GENESIS_HASH,

    recent: (facilityId, limit = 100) => byFacility.all(facilityId, limit),

    /**
     * Walk the chain and report the first row that does not verify.
     *
     * Returns `{ ok: true, entries }` or `{ ok: false, brokenAt, reason }`.
     */
    verifyChain() {
      let prevHash = GENESIS_HASH
      let count = 0
      for (const row of all.all()) {
        if (row.prev_hash !== prevHash) {
          return { ok: false, brokenAt: row.seq, reason: 'prev_hash_mismatch', entries: count }
        }
        const expected = chainHash(prevHash, {
          facilityId: row.facility_id,
          deviceId: row.device_id,
          actorId: row.actor_id,
          action: row.action,
          detail: row.detail,
          at: row.at,
        })
        if (expected !== row.hash) {
          return { ok: false, brokenAt: row.seq, reason: 'hash_mismatch', entries: count }
        }
        prevHash = row.hash
        count++
      }
      return { ok: true, entries: count, head: prevHash }
    },
  }
}

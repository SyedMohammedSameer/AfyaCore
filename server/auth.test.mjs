/**
 * Tests for the server's authentication and audit layers.
 *
 * These run against the real schema in an in-memory database rather than a
 * mock, because the properties being asserted (a code is single use, a token
 * scopes to exactly one facility, the audit chain breaks when a row is edited)
 * are properties of the SQL as much as of the JavaScript.
 */
import { describe, expect, it } from 'vitest'
import { openStore } from './store.mjs'
import {
  makeAuthQueries,
  hashSecret,
  verifySecret,
  generateEnrolmentCode,
  normaliseCode,
  bearerFrom,
} from './auth.mjs'
import { makeAuditLog, GENESIS_HASH } from './audit.mjs'

function freshAuth() {
  const db = openStore(':memory:')
  const auth = makeAuthQueries(db)
  auth.upsertFacility('CSB2-Test', 'CSB2 Test', 'MG')
  return { db, auth }
}

describe('secret hashing', () => {
  it('verifies a correct secret and rejects a wrong one', () => {
    const stored = hashSecret('correct horse')
    expect(verifySecret('correct horse', stored)).toBe(true)
    expect(verifySecret('wrong horse', stored)).toBe(false)
  })

  it('never stores the secret itself', () => {
    expect(hashSecret('hunter2')).not.toContain('hunter2')
  })

  it('salts, so the same secret hashes differently each time', () => {
    expect(hashSecret('same')).not.toBe(hashSecret('same'))
  })

  it('rejects a malformed stored hash rather than throwing', () => {
    expect(verifySecret('x', 'not-a-hash')).toBe(false)
    expect(verifySecret('x', '')).toBe(false)
  })
})

describe('enrolment codes', () => {
  it('avoids characters that are ambiguous when read aloud', () => {
    for (let i = 0; i < 200; i++) {
      expect(generateEnrolmentCode()).not.toMatch(/[OIL01UV]/)
    }
  })

  it('normalises case and separators, because it is typed off a phone call', () => {
    expect(normaliseCode('ab23-cd45')).toBe('AB23CD45')
    expect(normaliseCode('AB23 CD45')).toBe('AB23CD45')
  })
})

describe('device enrolment', () => {
  it('exchanges a valid code for a token scoped to the facility', () => {
    const { auth } = freshAuth()
    const { code } = auth.createEnrolmentCode('CSB2-Test')

    const result = auth.enrolDevice(code, 'Nurse phone')
    expect(result).not.toBeNull()
    expect(result.facilityId).toBe('CSB2-Test')
    expect(result.token).toMatch(/^afya_/)
  })

  it('refuses a code that has already been used', () => {
    const { auth } = freshAuth()
    const { code } = auth.createEnrolmentCode('CSB2-Test')

    expect(auth.enrolDevice(code, 'first')).not.toBeNull()
    expect(auth.enrolDevice(code, 'second')).toBeNull()
  })

  it('refuses an expired code', () => {
    const { auth } = freshAuth()
    const { code } = auth.createEnrolmentCode('CSB2-Test', -1000)
    expect(auth.enrolDevice(code, 'late')).toBeNull()
  })

  it('refuses a code that was never issued', () => {
    const { auth } = freshAuth()
    expect(auth.enrolDevice('2345-6789', 'guess')).toBeNull()
  })
})

describe('token authentication', () => {
  it('resolves a token to its device and facility', () => {
    const { auth } = freshAuth()
    const { code } = auth.createEnrolmentCode('CSB2-Test')
    const { token, deviceId } = auth.enrolDevice(code, 'Nurse phone')

    const device = auth.authenticate(token)
    expect(device.id).toBe(deviceId)
    expect(device.facility_id).toBe('CSB2-Test')
  })

  it('rejects a token that was never issued', () => {
    const { auth } = freshAuth()
    expect(auth.authenticate('afya_totally-made-up')).toBeNull()
    expect(auth.authenticate('not-even-a-token')).toBeNull()
    expect(auth.authenticate(null)).toBeNull()
  })

  it('rejects a revoked token, which is what a lost phone depends on', () => {
    const { auth } = freshAuth()
    const { code } = auth.createEnrolmentCode('CSB2-Test')
    const { token, deviceId } = auth.enrolDevice(code, 'Lost phone')

    expect(auth.authenticate(token)).not.toBeNull()
    expect(auth.revokeDevice(deviceId)).toBe(true)
    expect(auth.authenticate(token)).toBeNull()
  })

  it('confines a token to one facility', () => {
    const { auth } = freshAuth()
    auth.upsertFacility('CSB1-Other', 'Somebody else', 'MG')

    const { code } = auth.createEnrolmentCode('CSB2-Test')
    const { token } = auth.enrolDevice(code, 'phone')

    // The server derives scope from this field alone; there is no code path
    // that reads a facility id out of a request body.
    expect(auth.authenticate(token).facility_id).toBe('CSB2-Test')
  })
})

describe('bearer parsing', () => {
  it('accepts the header shape a fetch() actually sends', () => {
    expect(bearerFrom('Bearer afya_abc')).toBe('afya_abc')
    expect(bearerFrom('bearer afya_abc')).toBe('afya_abc')
  })

  it('rejects anything else', () => {
    expect(bearerFrom('Basic abc')).toBeNull()
    expect(bearerFrom('afya_abc')).toBeNull()
    expect(bearerFrom(undefined)).toBeNull()
  })
})

describe('audit chain', () => {
  it('starts from genesis and chains each entry to the last', () => {
    const db = openStore(':memory:')
    const audit = makeAuditLog(db)

    expect(audit.head()).toBe(GENESIS_HASH)
    audit.record({ facilityId: 'F', action: 'sync', detail: { pushed: 1 } })
    const first = audit.head()
    expect(first).not.toBe(GENESIS_HASH)

    audit.record({ facilityId: 'F', action: 'sync', detail: { pushed: 2 } })
    expect(audit.head()).not.toBe(first)
    expect(audit.verifyChain()).toMatchObject({ ok: true, entries: 2 })
  })

  it('detects an edited entry', () => {
    const db = openStore(':memory:')
    const audit = makeAuditLog(db)
    for (let i = 0; i < 5; i++) {
      audit.record({ facilityId: 'F', action: 'sync', detail: { i } })
    }
    expect(audit.verifyChain().ok).toBe(true)

    // Someone quietly rewrites what an entry says happened.
    db.exec(`UPDATE audit SET action = 'nothing_to_see' WHERE seq = 3`)

    const result = audit.verifyChain()
    expect(result.ok).toBe(false)
    expect(result.brokenAt).toBe(3)
    expect(result.reason).toBe('hash_mismatch')
  })

  it('detects a deleted entry', () => {
    const db = openStore(':memory:')
    const audit = makeAuditLog(db)
    for (let i = 0; i < 5; i++) {
      audit.record({ facilityId: 'F', action: 'sync', detail: { i } })
    }
    db.exec('DELETE FROM audit WHERE seq = 3')

    const result = audit.verifyChain()
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('prev_hash_mismatch')
  })

  it('bounds detail, so a client cannot flood the log', () => {
    const db = openStore(':memory:')
    const audit = makeAuditLog(db)
    audit.record({ facilityId: 'F', action: 'sync', detail: { blob: 'x'.repeat(100_000) } })
    const [row] = audit.recent('F', 1)
    expect(row.detail.length).toBeLessThanOrEqual(2000)
  })
})

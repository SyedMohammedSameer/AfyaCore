/**
 * Authentication for the AfyaCore sync server.
 *
 * The threat this closes is the one the prototype documented and did not fix: a
 * facility id is a guessable string, and until now knowing one was enough to
 * read and write a facility's entire record set. Facility scope is now derived
 * from a bearer token, never from the request body, so a caller can only ever
 * touch the facility their token was issued for.
 *
 * Enrolment is deliberately shaped around how a device actually reaches a
 * health post: an administrator generates a short code on the server, reads it
 * to the person holding the phone, and that code is single-use and expires. A
 * code is assumed to leak, so its value has to decay on its own rather than
 * depend on the channel it travelled over.
 *
 * Zero dependencies. `node:crypto` gives us scrypt, which is memory-hard, and
 * timing-safe comparison, which matters because a token check is the one place
 * an attacker gets unlimited attempts at a secret.
 */
import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto'

/** Cost parameters. N=2^15 keeps a check near 50 ms on a small VPS. */
const SCRYPT_N = 32768
const SCRYPT_R = 8
const SCRYPT_P = 1
const KEY_LEN = 32

/**
 * scrypt needs roughly 128 * N * r bytes, which at these parameters is 33 MB,
 * just over Node's default 32 MB ceiling. The limit has to be stated explicitly
 * or the call throws. Derived from the parameters rather than hard-coded so
 * raising the cost later does not silently reintroduce the failure.
 */
const maxmemFor = (n, r) => 256 * n * r

export const ENROLMENT_TTL_MS = 24 * 60 * 60 * 1000

/**
 * Hash a secret for storage.
 *
 * Format is `scrypt$N$r$p$salt$hash`, all base64url, so the cost parameters
 * travel with the hash and can be raised later without invalidating what is
 * already stored.
 */
export function hashSecret(secret) {
  const salt = randomBytes(16)
  const derived = scryptSync(secret, salt, KEY_LEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: maxmemFor(SCRYPT_N, SCRYPT_R),
  })
  return [
    'scrypt',
    SCRYPT_N,
    SCRYPT_R,
    SCRYPT_P,
    salt.toString('base64url'),
    derived.toString('base64url'),
  ].join('$')
}

/** Constant-time verification of a secret against a stored hash. */
export function verifySecret(secret, stored) {
  try {
    const [scheme, n, r, p, salt, expected] = String(stored).split('$')
    if (scheme !== 'scrypt') return false
    const derived = scryptSync(secret, Buffer.from(salt, 'base64url'), KEY_LEN, {
      N: Number(n),
      r: Number(r),
      p: Number(p),
      maxmem: maxmemFor(Number(n), Number(r)),
    })
    const want = Buffer.from(expected, 'base64url')
    // timingSafeEqual throws on a length mismatch, which would itself leak.
    if (want.length !== derived.length) return false
    return timingSafeEqual(derived, want)
  } catch {
    return false
  }
}

/**
 * A fast, deterministic lookup key for a bearer token.
 *
 * Bearer tokens are 256-bit random values, so they have no entropy problem that
 * a slow KDF would fix, and a sync request must not pay 50 ms of scrypt on
 * every call. SHA-256 gives us an indexable column; the token itself is still
 * never stored.
 */
export function tokenLookupHash(token) {
  return createHash('sha256').update(token).digest('base64url')
}

/** 256 bits, base64url, prefixed so a leaked token is greppable in logs. */
export function generateToken() {
  return `afya_${randomBytes(32).toString('base64url')}`
}

/**
 * A human-readable enrolment code.
 *
 * Read aloud over a phone line, so it avoids characters that are ambiguous when
 * spoken or written by hand: no O/0, no I/1/L, no U/V confusion. 8 characters
 * from a 28-symbol alphabet is ~38 bits, which is fine for a single-use secret
 * that expires in a day and is rate limited.
 */
const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTWXY'

export function generateEnrolmentCode() {
  const bytes = randomBytes(8)
  let code = ''
  for (let i = 0; i < 8; i++) code += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length]
  return `${code.slice(0, 4)}-${code.slice(4)}`
}

/** Codes are compared case-insensitively and without their separator. */
export function normaliseCode(code) {
  return String(code).toUpperCase().replace(/[^0-9A-Z]/g, '')
}

export function makeAuthQueries(db) {
  const insertFacility = db.prepare(
    'INSERT INTO facilities (id, name, country, created_at) VALUES (?, ?, ?, ?) ON CONFLICT (id) DO UPDATE SET name = excluded.name, country = excluded.country',
  )
  const getFacility = db.prepare('SELECT * FROM facilities WHERE id = ?')
  const listFacilities = db.prepare('SELECT * FROM facilities ORDER BY created_at')

  const insertEnrolment = db.prepare(
    'INSERT INTO enrolments (code_hash, facility_id, expires_at, created_at) VALUES (?, ?, ?, ?)',
  )
  const listLiveEnrolments = db.prepare(
    'SELECT * FROM enrolments WHERE used_at IS NULL AND expires_at > ?',
  )
  const consumeEnrolment = db.prepare(
    'UPDATE enrolments SET used_at = ?, used_by = ? WHERE code_hash = ? AND used_at IS NULL',
  )

  const insertDevice = db.prepare(
    'INSERT INTO devices (id, facility_id, name, token_hash, created_at) VALUES (?, ?, ?, ?, ?)',
  )
  const getDeviceByToken = db.prepare(
    'SELECT * FROM devices WHERE token_hash = ? AND revoked_at IS NULL',
  )
  const touchDevice = db.prepare('UPDATE devices SET last_seen_at = ? WHERE id = ?')
  const revokeDevice = db.prepare(
    'UPDATE devices SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL',
  )
  const listDevices = db.prepare('SELECT * FROM devices WHERE facility_id = ? ORDER BY created_at')

  return {
    /** Create or rename a facility. Idempotent, so re-running setup is safe. */
    upsertFacility(id, name, country = 'MG') {
      insertFacility.run(id, name, country, Date.now())
      return getFacility.get(id)
    },

    getFacility: (id) => getFacility.get(id),
    listFacilities: () => listFacilities.all(),

    /**
     * Mint a single-use enrolment code for a facility.
     *
     * Returns the plaintext once. It is stored only as a scrypt hash, so an
     * administrator who loses the code has to issue another one; there is no
     * path that recovers it.
     */
    createEnrolmentCode(facilityId, ttlMs = ENROLMENT_TTL_MS) {
      const code = generateEnrolmentCode()
      const now = Date.now()
      insertEnrolment.run(hashSecret(normaliseCode(code)), facilityId, now + ttlMs, now)
      return { code, expiresAt: now + ttlMs }
    },

    /**
     * Exchange an enrolment code for a device token.
     *
     * Codes are hashed, so we cannot look one up directly; we verify against
     * every live code instead. That set is small by construction (unused,
     * unexpired) and the whole point of an enrolment code is that it exists for
     * minutes, not months.
     */
    enrolDevice(code, deviceName) {
      const normalised = normaliseCode(code)
      const now = Date.now()
      const candidates = listLiveEnrolments.all(now)

      for (const row of candidates) {
        if (!verifySecret(normalised, row.code_hash)) continue

        const deviceId = `dev_${randomBytes(9).toString('base64url')}`
        const token = generateToken()

        // Consume the code first. If two phones race on the same code, the
        // UPDATE ... WHERE used_at IS NULL means exactly one of them wins.
        const consumed = consumeEnrolment.run(now, deviceId, row.code_hash)
        if (consumed.changes !== 1) return null

        insertDevice.run(
          deviceId,
          row.facility_id,
          String(deviceName || 'unnamed device').slice(0, 120),
          tokenLookupHash(token),
          now,
        )
        return { token, deviceId, facilityId: row.facility_id }
      }
      return null
    },

    /**
     * Resolve a bearer token to its device.
     *
     * The facility id on the returned device is the *only* facility scope the
     * request gets. Nothing downstream reads a facility id out of the body.
     */
    authenticate(token) {
      if (typeof token !== 'string' || !token.startsWith('afya_')) return null
      const device = getDeviceByToken.get(tokenLookupHash(token))
      if (!device) return null
      const facility = getFacility.get(device.facility_id)
      if (!facility || facility.disabled_at) return null
      touchDevice.run(Date.now(), device.id)
      return device
    },

    revokeDevice: (id) => revokeDevice.run(Date.now(), id).changes === 1,
    listDevices: (facilityId) => listDevices.all(facilityId),
  }
}

/** Pull a bearer token out of an Authorization header. */
export function bearerFrom(header) {
  if (typeof header !== 'string') return null
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim())
  return match ? match[1] : null
}

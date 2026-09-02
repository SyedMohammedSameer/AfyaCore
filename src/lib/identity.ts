/**
 * Staff accounts and device lock.
 *
 * Two separate questions get confused in clinical software, so they are kept
 * apart here:
 *
 *   - *Who is using this phone right now?* Answered by a short PIN, because the
 *     phone is shared, handed between a nurse and a midwife during a shift, and
 *     a password typed on a cracked screen between patients will simply be
 *     written on the case.
 *   - *May this phone talk to the server?* Answered by the device token from
 *     enrolment, which is unrelated and much stronger.
 *
 * A 4–6 digit PIN is weak, and pretending otherwise would be the dishonest part.
 * It is not what protects the records from someone who takes the phone away and
 * has time: full-disk encryption is. What it does is bound *attribution* (the
 * audit trail names an account, so "who deleted this consultation" has an
 * answer) and stop the casual case, a phone left on a desk in a waiting room.
 * The lockout below makes online guessing impractical; an attacker with the
 * IndexedDB file and no time limit is explicitly out of scope, and SECURITY.md
 * says so.
 */
import { db } from '../db/db'
import { newId } from './id'
import type { Clinician, Role } from '../db/schema'

/**
 * PBKDF2 iterations.
 *
 * Deliberately high for the search space: a 4-digit PIN is 10,000 candidates,
 * so the only defence available offline is making each candidate expensive.
 * 600k SHA-256 iterations is the OWASP 2023 figure and costs roughly a quarter
 * of a second on the low-end Android hardware this targets, which is tolerable
 * once per shift and painful times ten thousand.
 */
const PBKDF2_ITERATIONS = 600_000
const SALT_BYTES = 16
const KEY_BITS = 256

const MIN_PIN_LENGTH = 4
const MAX_PIN_LENGTH = 12

/** Wrong-PIN attempts before the device locks staff out for a while. */
export const MAX_PIN_ATTEMPTS = 5
export const LOCKOUT_MS = 5 * 60_000

/** How long a session survives without interaction. */
export const DEFAULT_IDLE_TIMEOUT_MS = 15 * 60_000

const SETTING_KEYS = {
  attempts: 'auth.failedAttempts',
  lockedUntil: 'auth.lockedUntil',
  idleTimeout: 'auth.idleTimeoutMs',
} as const

const encoder = new TextEncoder()

const toBase64 = (bytes: ArrayBuffer) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes)))

const fromBase64 = (value: string) =>
  Uint8Array.from(atob(value), (c) => c.charCodeAt(0))

/**
 * Derive PIN material.
 *
 * Exported because encryption at rest wraps the data key with a key derived the
 * same way: the PIN a clinician types has to unlock both the session and the
 * records, or the second one is protecting nothing.
 */
export async function derivePinKey(
  pin: string,
  salt: Uint8Array,
  iterations = PBKDF2_ITERATIONS,
): Promise<ArrayBuffer> {
  const base = await crypto.subtle.importKey('raw', encoder.encode(pin), 'PBKDF2', false, [
    'deriveBits',
  ])
  return crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations },
    base,
    KEY_BITS,
  )
}

/** `pbkdf2$iterations$salt$hash`, so the cost can be raised without a migration. */
export async function hashPin(pin: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES))
  const derived = await derivePinKey(pin, salt)
  return ['pbkdf2', PBKDF2_ITERATIONS, toBase64(salt.buffer), toBase64(derived)].join('$')
}

/**
 * Constant-time PIN verification.
 *
 * A plain string compare would return faster on an early mismatch. That leak is
 * mostly theoretical against a local UI, but the correct version is four lines,
 * so there is no reason to ship the version that has to be argued about.
 */
export async function verifyPin(pin: string, stored: string): Promise<boolean> {
  try {
    const [scheme, iterations, salt, expected] = stored.split('$')
    if (scheme !== 'pbkdf2') return false
    const derived = new Uint8Array(
      await derivePinKey(pin, fromBase64(salt!), Number(iterations)),
    )
    const want = fromBase64(expected!)
    if (want.length !== derived.length) return false
    let diff = 0
    for (let i = 0; i < want.length; i++) diff |= want[i]! ^ derived[i]!
    return diff === 0
  } catch {
    return false
  }
}

export interface PinPolicyResult {
  ok: boolean
  reason?: 'too_short' | 'too_long' | 'not_numeric' | 'sequential' | 'repeated'
}

/**
 * Reject the PINs that make the lockout pointless.
 *
 * An attacker with five guesses will spend them on 0000, 1234 and 1111. Barring
 * those costs staff nothing and removes most of the value of guessing at all.
 */
export function checkPinPolicy(pin: string): PinPolicyResult {
  if (pin.length < MIN_PIN_LENGTH) return { ok: false, reason: 'too_short' }
  if (pin.length > MAX_PIN_LENGTH) return { ok: false, reason: 'too_long' }
  if (!/^\d+$/.test(pin)) return { ok: false, reason: 'not_numeric' }
  if (/^(\d)\1*$/.test(pin)) return { ok: false, reason: 'repeated' }

  const digits = [...pin].map(Number)
  const ascending = digits.every((d, i) => i === 0 || d === digits[i - 1]! + 1)
  const descending = digits.every((d, i) => i === 0 || d === digits[i - 1]! - 1)
  if (ascending || descending) return { ok: false, reason: 'sequential' }

  return { ok: true }
}

/* ------------------------------------------------------------------ *
 * Accounts
 * ------------------------------------------------------------------ */

export interface NewClinicianInput {
  name: string
  role: Role
  pin: string
}

export async function createClinician(input: NewClinicianInput): Promise<string> {
  const policy = checkPinPolicy(input.pin)
  if (!policy.ok) throw new Error(`weak_pin:${policy.reason}`)

  const clinician: Clinician = {
    id: newId(),
    name: input.name.trim(),
    role: input.role,
    pinHash: await hashPin(input.pin),
    createdAt: Date.now(),
  }
  await db.clinicians.add(clinician)
  return clinician.id
}

export async function setPin(clinicianId: string, pin: string): Promise<void> {
  const policy = checkPinPolicy(pin)
  if (!policy.ok) throw new Error(`weak_pin:${policy.reason}`)
  await db.clinicians.update(clinicianId, { pinHash: await hashPin(pin) })
}

export async function activeClinicians(): Promise<Clinician[]> {
  const rows = await db.clinicians.toArray()
  return rows.filter((c) => c.disabledAt === undefined).sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * Disable an account rather than deleting it.
 *
 * Audit entries reference the account that made them. Deleting the row would
 * leave a trail pointing at nobody, which defeats the point of keeping one.
 */
export async function disableClinician(id: string): Promise<void> {
  await db.clinicians.update(id, { disabledAt: Date.now() })
}

/** True before anyone has been enrolled: the first-run account setup case. */
export async function needsFirstAccount(): Promise<boolean> {
  return (await activeClinicians()).length === 0
}

/* ------------------------------------------------------------------ *
 * Lockout
 * ------------------------------------------------------------------ */

export interface LockoutState {
  attemptsRemaining: number
  lockedUntil: number | null
}

async function readNumber(key: string): Promise<number> {
  const row = await db.settings.get(key)
  return typeof row?.value === 'number' ? row.value : 0
}

export async function lockoutState(now = Date.now()): Promise<LockoutState> {
  const [attempts, lockedUntil] = await Promise.all([
    readNumber(SETTING_KEYS.attempts),
    readNumber(SETTING_KEYS.lockedUntil),
  ])
  if (lockedUntil > now) return { attemptsRemaining: 0, lockedUntil }
  return { attemptsRemaining: Math.max(0, MAX_PIN_ATTEMPTS - attempts), lockedUntil: null }
}

/**
 * Try to sign in.
 *
 * The count is per device, not per account: an attacker who gets five tries
 * against every account in turn has as many tries as there are staff, which is
 * not a limit. Counters live in IndexedDB and can be cleared by anyone with
 * devtools; this stops a person holding the phone, not a forensic examiner, and
 * that is the honest scope of a PIN.
 */
export async function signIn(
  clinicianId: string,
  pin: string,
  now = Date.now(),
): Promise<{ ok: boolean; clinician?: Clinician; lockout: LockoutState }> {
  const state = await lockoutState(now)
  if (state.lockedUntil) return { ok: false, lockout: state }

  const clinician = await db.clinicians.get(clinicianId)
  if (!clinician || clinician.disabledAt !== undefined) {
    return { ok: false, lockout: state }
  }

  if (await verifyPin(pin, clinician.pinHash)) {
    await db.settings.bulkPut([
      { key: SETTING_KEYS.attempts, value: 0 },
      { key: SETTING_KEYS.lockedUntil, value: 0 },
    ])
    await db.clinicians.update(clinicianId, { lastSignInAt: now })
    return { ok: true, clinician, lockout: { attemptsRemaining: MAX_PIN_ATTEMPTS, lockedUntil: null } }
  }

  const attempts = (await readNumber(SETTING_KEYS.attempts)) + 1
  const locked = attempts >= MAX_PIN_ATTEMPTS
  await db.settings.bulkPut([
    { key: SETTING_KEYS.attempts, value: locked ? 0 : attempts },
    { key: SETTING_KEYS.lockedUntil, value: locked ? now + LOCKOUT_MS : 0 },
  ])

  return {
    ok: false,
    lockout: locked
      ? { attemptsRemaining: 0, lockedUntil: now + LOCKOUT_MS }
      : { attemptsRemaining: MAX_PIN_ATTEMPTS - attempts, lockedUntil: null },
  }
}

/* ------------------------------------------------------------------ *
 * Roles
 * ------------------------------------------------------------------ */

/**
 * What each role may do.
 *
 * Kept small on purpose. A permission model with twenty flags is one nobody
 * configures correctly, and in a facility of four people the only distinction
 * that matters is between recording care and changing how the facility is set
 * up. Everyone can do clinical work; not everyone can enrol a device, export
 * identified data, or add an account.
 */
export const PERMISSIONS = {
  clinician: ['record', 'amend', 'export.deidentified'],
  admin: [
    'record',
    'amend',
    'export.deidentified',
    'export.identified',
    'manage.staff',
    'manage.device',
    'delete.patient',
    'view.audit',
  ],
} as const satisfies Record<Role, readonly string[]>

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS][number]

export function can(role: Role | undefined, permission: Permission): boolean {
  if (!role) return false
  return (PERMISSIONS[role] as readonly string[]).includes(permission)
}

/* ------------------------------------------------------------------ *
 * Idle timeout
 * ------------------------------------------------------------------ */

export async function getIdleTimeoutMs(): Promise<number> {
  const value = await readNumber(SETTING_KEYS.idleTimeout)
  return value > 0 ? value : DEFAULT_IDLE_TIMEOUT_MS
}

export async function setIdleTimeoutMs(ms: number): Promise<void> {
  await db.settings.put({ key: SETTING_KEYS.idleTimeout, value: ms })
}

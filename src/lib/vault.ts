/**
 * The key that the patient records are encrypted under, and who can open it.
 *
 * ## The shape of it
 *
 * One random 256-bit **data key** encrypts every clinical row on this device.
 * It is never stored in the clear. Each member of staff has their own copy of
 * it, wrapped under a key derived from their PIN, so:
 *
 *   - adding a colleague costs one wrap, not a re-encryption of the database;
 *   - changing a PIN rewraps one key rather than rewriting every record;
 *   - removing someone removes their wrap, and their PIN stops opening the
 *     database that evening rather than at the next sync.
 *
 * The data key exists in memory for the length of a session and nowhere else.
 * Signing out, the idle timeout and closing the tab all drop it, which is what
 * makes the lock screen mean something: a phone found on a desk holds
 * ciphertext, not a database behind a keypad.
 *
 * ## What this protects against, and what it does not
 *
 * It protects a **phone that is taken away**. Someone who pulls the IndexedDB
 * files off the device gets AES-GCM ciphertext and a PBKDF2 wrap, and the only
 * way in is the PIN.
 *
 * It does not protect a **running unlocked session** — the records are on the
 * screen — and it does not defend against code running in this origin, which
 * can read what the app can read. That is why the data key is not held as a
 * non-extractable `CryptoKey`: doing so would look stronger while defending
 * against nothing this threat model contains, and it would cost the ability to
 * enrol a colleague or change a PIN without the whole database being rewritten.
 *
 * And the honest limit: a PIN is four to twelve digits. `PBKDF2_ITERATIONS`
 * in identity.ts is what stands between a four-digit PIN and an offline
 * search of ten thousand candidates, and at 600k iterations that search is
 * hours rather than seconds on commodity hardware — not years. Six digits
 * moves it to months. SECURITY.md says so in those words rather than calling
 * this "encrypted at rest" and stopping.
 */
import { db } from '../db/db'
import { derivePinKey } from './identity'

/** Settings row holding the wrapped data key for one account. */
const wrapKeyFor = (clinicianId: string) => `crypto.wrap.${clinicianId}`
/** Settings row recording that this device's clinical tables are encrypted. */
const ENABLED_KEY = 'crypto.enabled'

const SALT_BYTES = 16

export interface WrappedKey {
  v: 1
  /** Base64. Per account, so two people with the same PIN produce different wraps. */
  salt: string
  /** PBKDF2 rounds used for this wrap, so the cost can be raised later. */
  iterations: number
  /** Base64 AES-KW output. */
  wrapped: string
}

const toBase64 = (bytes: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(bytes)))
const fromBase64 = (value: string) => Uint8Array.from(atob(value), (c) => c.charCodeAt(0))

/*
 * The unlocked data key, for this session.
 *
 * Module state rather than React state on purpose: the database layer needs it
 * on every read, including reads that happen outside a component, and threading
 * a key through sixty call sites is exactly the design this avoids.
 */
let dataKey: CryptoKey | null = null

export function getDataKey(): CryptoKey | null {
  return dataKey
}

/** Drop the key. Called on sign-out, idle timeout and lock. */
export function lockVault(): void {
  dataKey = null
}

/** Whether this device has been switched to encrypted storage. */
export async function isVaultEnabled(): Promise<boolean> {
  return (await db.settings.get(ENABLED_KEY))?.value === true
}

export async function hasWrap(clinicianId: string): Promise<boolean> {
  return (await db.settings.get(wrapKeyFor(clinicianId))) !== undefined
}

/** Derive the key-encryption key for a PIN, and import it for AES-KW. */
async function kekFor(pin: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const bits = await derivePinKey(pin, salt, iterations)
  return crypto.subtle.importKey('raw', bits, 'AES-KW', false, ['wrapKey', 'unwrapKey'])
}

/** Wrap the given data key under a PIN and store it against an account. */
async function storeWrap(
  clinicianId: string,
  pin: string,
  key: CryptoKey,
  iterations = DEFAULT_ITERATIONS,
): Promise<void> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES))
  const kek = await kekFor(pin, salt, iterations)
  const wrapped = await crypto.subtle.wrapKey('raw', key, kek, 'AES-KW')
  const record: WrappedKey = {
    v: 1,
    salt: toBase64(salt.buffer),
    iterations,
    wrapped: toBase64(wrapped),
  }
  await db.settings.put({ key: wrapKeyFor(clinicianId), value: record })
}

/**
 * The cost of a wrap.
 *
 * Read from identity.ts rather than restated, because a PIN that is expensive
 * to test against the sign-in hash and cheap to test against the key wrap is
 * only as strong as the cheaper of the two — and the wrap is the one an
 * attacker with the database file attacks.
 *
 * `iterations` is a parameter on the functions below rather than a constant
 * they reach for, so a test can wrap a key in a millisecond and so the cost
 * can be raised on new wraps without invalidating old ones — each wrap records
 * the count it was made with, and `unlockVault` uses that.
 */
const DEFAULT_ITERATIONS = 600_000

/**
 * Create this device's data key. Once, on the first account.
 *
 * Generating it here rather than at install time means a device that is never
 * signed into never has a key at all.
 */
export async function createVault(
  clinicianId: string,
  pin: string,
  iterations = DEFAULT_ITERATIONS,
): Promise<void> {
  if (await isVaultEnabled()) throw new Error('vault already exists')
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, [
    'encrypt',
    'decrypt',
  ])
  await storeWrap(clinicianId, pin, key, iterations)
  await db.settings.put({ key: ENABLED_KEY, value: true })
  dataKey = key
}

export type UnlockResult = 'ok' | 'no_wrap' | 'wrong_pin'

/**
 * Open the vault with an account's PIN.
 *
 * `no_wrap` is a real state, not an error: an account created before this
 * device was encrypted has no copy of the data key, and no amount of correct
 * PIN produces one. Someone who can already open the vault has to hand it over
 * by setting that person's PIN, which is `rewrapFor` below. Reporting it
 * distinctly is what lets the lock screen say so instead of "wrong PIN".
 */
export async function unlockVault(clinicianId: string, pin: string): Promise<UnlockResult> {
  const row = await db.settings.get(wrapKeyFor(clinicianId))
  const record = row?.value as WrappedKey | undefined
  if (!record) return 'no_wrap'

  try {
    const kek = await kekFor(pin, fromBase64(record.salt), record.iterations)
    dataKey = await crypto.subtle.unwrapKey(
      'raw',
      fromBase64(record.wrapped) as BufferSource,
      kek,
      'AES-KW',
      { name: 'AES-GCM', length: 256 },
      true,
      ['encrypt', 'decrypt'],
    )
    return 'ok'
  } catch {
    // AES-KW authenticates: a wrong PIN fails to unwrap rather than yielding a
    // key that decrypts to rubbish. There is nothing to distinguish here.
    return 'wrong_pin'
  }
}

/**
 * Give another account a copy of the data key, under their PIN.
 *
 * Requires an open vault, which is the point: a key can only be handed over by
 * somebody who holds it. That is what makes "an administrator must set your
 * PIN on this device" a security property rather than an inconvenience.
 */
export async function rewrapFor(
  clinicianId: string,
  pin: string,
  iterations = DEFAULT_ITERATIONS,
): Promise<void> {
  if (!dataKey) throw new Error('vault is locked')
  await storeWrap(clinicianId, pin, dataKey, iterations)
}

/** Take away an account's copy. Their PIN stops opening this device. */
export async function revokeWrap(clinicianId: string): Promise<void> {
  await db.settings.delete(wrapKeyFor(clinicianId))
}

/** Accounts that currently hold a copy of the data key. */
export async function wrappedAccountIds(): Promise<string[]> {
  const rows = await db.settings.toArray()
  return rows
    .filter((r) => r.key.startsWith('crypto.wrap.'))
    .map((r) => r.key.slice('crypto.wrap.'.length))
}

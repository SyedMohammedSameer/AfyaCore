/**
 * Signing in, and opening the records.
 *
 * These are two separate acts and this module is where they are joined. A PIN
 * proves *who is holding the phone*, which is `identity.signIn`; the same PIN
 * unwraps *the key the records are encrypted under*, which is `vault`. Doing
 * one without the other would give either a session that cannot read anything
 * or a decrypted database with nobody's name against the audit trail.
 *
 * It lives in its own file rather than inside identity.ts because the vault
 * derives its key-encryption key with `derivePinKey` from identity.ts, and a
 * module that imports its own importer is a cycle waiting to be tripped over
 * by a bundler.
 */
import { db } from '../db/db'
import { encryptExistingRows } from '../db/encryption'
import {
  createClinician,
  signIn as attemptSignIn,
  type LockoutState,
  type NewClinicianInput,
} from './identity'
import { createVault, isVaultEnabled, lockVault, rewrapFor, unlockVault } from './vault'
import type { Clinician } from '../db/schema'

export interface UnlockOutcome {
  ok: boolean
  clinician?: Clinician
  lockout: LockoutState
  /**
   * Set when the PIN was right and the records still did not open.
   *
   * `no_key` is an account that predates this device being encrypted, or one
   * whose copy of the key was revoked. There is no self-service path out of
   * it and there should not be: somebody who already holds the key has to set
   * this person's PIN, which is the only way a key is ever handed over.
   */
  reason?: 'no_key'
}

/**
 * Try a PIN against an account, and open the vault with it.
 *
 * A PIN that verifies but cannot unwrap the key is **not** counted as a failed
 * attempt. It is not a guess, it is a correctly-remembered PIN for an account
 * that has no key on this device, and locking someone out for five minutes
 * over it would be punishing them for an administrator's omission.
 */
export async function unlockDevice(
  clinicianId: string,
  pin: string,
  now = Date.now(),
): Promise<UnlockOutcome> {
  /*
   * Both derivations at once, not one after the other.
   *
   * Signing in checks the PIN against its stored hash *and* unwraps the data
   * key, and each of those is 600k rounds of PBKDF2 — around 250 ms on a
   * desktop and well over a second on the phones this targets. Run in
   * sequence that is a visible stall on the lock screen at the start of every
   * shift and after every idle timeout. They depend on nothing of each
   * other's, so the wait is the slower of the two rather than their sum.
   *
   * Starting the unwrap before knowing the PIN is right gives nothing away: a
   * wrong PIN fails to unwrap, and if the verify comes back false the outcome
   * below is a failure regardless of what the unwrap did.
   */
  const enabled = await isVaultEnabled()
  const [result, unlocked] = await Promise.all([
    attemptSignIn(clinicianId, pin, now),
    enabled ? unlockVault(clinicianId, pin) : Promise.resolve(null),
  ])

  if (!result.ok || !result.clinician) {
    // A failed sign-in must not leave a key open behind the lock screen.
    lockVault()
    return result
  }

  if (!enabled) {
    /*
     * First sign-in on a device that already holds plaintext records.
     *
     * The key is created for whoever is standing there, and their colleagues
     * get one when an administrator next sets their PIN. That is the only
     * honest ordering: nobody present knows anybody else's PIN, so nobody
     * present can wrap the key for them.
     */
    await createVault(clinicianId, pin)
    await encryptExistingRows(db)
    return result
  }

  if (unlocked === 'ok') return result
  return { ok: false, lockout: result.lockout, reason: 'no_key' }
}

/**
 * Create an account and give it a copy of the key.
 *
 * The first account on the device creates the key. Every account after it is
 * enrolled by somebody who is already signed in, and takes a copy wrapped
 * under the PIN they choose — which is why the administrator adding them has
 * to type it, and why an account cannot be created while the vault is locked.
 */
export async function enrolClinician(input: NewClinicianInput): Promise<string> {
  const id = await createClinician(input)
  if (await isVaultEnabled()) await rewrapFor(id, input.pin)
  else await createVault(id, input.pin)
  return id
}

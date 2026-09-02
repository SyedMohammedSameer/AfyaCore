/**
 * Tests for PIN handling and the permission table.
 *
 * These are pure functions on purpose: everything that touches IndexedDB is
 * factored out so the security-relevant logic can be tested in Node with no
 * DOM, matching the convention the rest of the suite already follows.
 */
import { describe, expect, it } from 'vitest'
import { checkPinPolicy, hashPin, verifyPin, can, PERMISSIONS } from './identity'

describe('PIN hashing', () => {
  it('verifies the right PIN and rejects the wrong one', async () => {
    const stored = await hashPin('8317')
    expect(await verifyPin('8317', stored)).toBe(true)
    expect(await verifyPin('8318', stored)).toBe(false)
  })

  it('never stores the PIN itself', async () => {
    expect(await hashPin('8317')).not.toContain('8317')
  })

  it('salts, so two accounts with the same PIN do not look alike', async () => {
    expect(await hashPin('8317')).not.toBe(await hashPin('8317'))
  })

  it('records the iteration count, so the cost can be raised later', async () => {
    const [scheme, iterations] = (await hashPin('8317')).split('$')
    expect(scheme).toBe('pbkdf2')
    expect(Number(iterations)).toBeGreaterThanOrEqual(600_000)
  })

  it('returns false rather than throwing on a corrupt stored hash', async () => {
    expect(await verifyPin('8317', 'garbage')).toBe(false)
    expect(await verifyPin('8317', '')).toBe(false)
    expect(await verifyPin('8317', 'pbkdf2$1$$')).toBe(false)
  })
})

describe('PIN policy', () => {
  it('accepts an ordinary PIN', () => {
    expect(checkPinPolicy('8317')).toEqual({ ok: true })
    expect(checkPinPolicy('907412')).toEqual({ ok: true })
  })

  it('rejects the PINs an attacker would spend five guesses on', () => {
    // With a five-attempt lockout, barring these removes most of the value of
    // guessing at all.
    expect(checkPinPolicy('0000').reason).toBe('repeated')
    expect(checkPinPolicy('1111').reason).toBe('repeated')
    expect(checkPinPolicy('1234').reason).toBe('sequential')
    expect(checkPinPolicy('4321').reason).toBe('sequential')
  })

  it('rejects a PIN that is too short to be worth anything', () => {
    expect(checkPinPolicy('123').reason).toBe('too_short')
  })

  it('rejects non-digits, because the keypad only offers digits', () => {
    expect(checkPinPolicy('abcd').reason).toBe('not_numeric')
  })
})

describe('permissions', () => {
  it('lets both roles do clinical work', () => {
    expect(can('clinician', 'record')).toBe(true)
    expect(can('admin', 'record')).toBe(true)
    expect(can('clinician', 'amend')).toBe(true)
  })

  it('confines facility administration to admins', () => {
    expect(can('clinician', 'manage.staff')).toBe(false)
    expect(can('clinician', 'manage.device')).toBe(false)
    expect(can('clinician', 'view.audit')).toBe(false)
    expect(can('admin', 'manage.staff')).toBe(true)
  })

  it('lets anyone export de-identified data but not identified data', () => {
    // The distinction that matters for data protection: a de-identified export
    // is reporting, an identified one is disclosure.
    expect(can('clinician', 'export.deidentified')).toBe(true)
    expect(can('clinician', 'export.identified')).toBe(false)
    expect(can('admin', 'export.identified')).toBe(true)
  })

  it('denies everything when nobody is signed in', () => {
    expect(can(undefined, 'record')).toBe(false)
    expect(can(undefined, 'export.deidentified')).toBe(false)
  })

  it('gives admins a superset of what clinicians can do', () => {
    for (const permission of PERMISSIONS.clinician) {
      expect(PERMISSIONS.admin).toContain(permission)
    }
  })
})

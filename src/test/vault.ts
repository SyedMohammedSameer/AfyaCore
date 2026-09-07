/**
 * An open vault, for suites that touch the encrypted tables.
 *
 * Every clinical table now refuses to be written while the vault is locked, so
 * a test that writes a patient has to open one first. That is the property
 * under test elsewhere, not an obstacle: `encryption.test.ts` asserts the
 * refusal deliberately.
 *
 * One iteration of PBKDF2, because these wraps protect nothing — the cost of
 * a real one is the point of the real one, and paying it in every suite would
 * add a quarter of a second per file to a run that is currently six seconds.
 */
import { createVault, isVaultEnabled, lockVault, unlockVault } from '../lib/vault'

export const TEST_PIN = '4729'
export const TEST_ACCOUNT = 'test-admin'

export async function openTestVault(
  clinicianId = TEST_ACCOUNT,
  pin = TEST_PIN,
): Promise<void> {
  if (await isVaultEnabled()) {
    const result = await unlockVault(clinicianId, pin)
    if (result !== 'ok') throw new Error(`test vault would not open: ${result}`)
    return
  }
  await createVault(clinicianId, pin, 1)
}

export { lockVault }

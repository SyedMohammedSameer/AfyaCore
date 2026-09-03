/**
 * The disclosure gate.
 *
 * These assert the default, which is the part that matters: an app that ships
 * with dictation enabled and a disclosure nobody read is the state this
 * replaced.
 */
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../db/db'

const modeFor = vi.fn<(lang: string) => Promise<'on-device' | 'remote'>>()
vi.mock('./speech', () => ({
  recogniser: {
    get available() {
      return available
    },
    requiresNetwork: true,
    modeFor: (lang: string) => modeFor(lang),
    start: () => {},
    stop: () => {},
  },
}))

let available = true

const { dictationState, dictationAllowed, dictationLeavesDevice, acknowledgeRemoteDictation } =
  await import('./dictation')

/**
 * No pack installed, stated rather than implied.
 *
 * These tests would pass without it, because `installedPack` fetches a
 * relative URL and the failure is caught — but they would be passing by
 * accident, on a network error, and the day someone adds a fetch polyfill to
 * the test setup the whole disclosure suite would start describing a
 * different code path.
 */
const noPack = { findPack: async () => null }

beforeEach(async () => {
  await db.delete()
  await db.open()
  available = true
  modeFor.mockReset()
})

describe('dictation disclosure', () => {
  it('is off by default when audio would leave the device', async () => {
    // The default that matters. Nobody has been told, so nobody has agreed.
    modeFor.mockResolvedValue('remote')
    const state = await dictationState('fr-FR', noPack)
    expect(state.status).toBe('needs-disclosure')
    expect(dictationAllowed(state)).toBe(false)
  })

  it('asks for nothing when recognition is on-device', async () => {
    // No disclosure is owed when there is nothing to disclose. Asking anyway
    // would train staff to dismiss the prompt that does matter.
    modeFor.mockResolvedValue('on-device')
    const state = await dictationState('fr-FR', noPack)
    expect(state.status).toBe('on-device')
    expect(dictationAllowed(state)).toBe(true)
  })

  it('allows dictation once acknowledged, and records when', async () => {
    modeFor.mockResolvedValue('remote')
    await acknowledgeRemoteDictation(true)
    const state = await dictationState('fr-FR', noPack)
    expect(state.status).toBe('remote-acknowledged')
    expect(dictationAllowed(state)).toBe(true)
  })

  it('can be withdrawn, and dictation stops again', async () => {
    modeFor.mockResolvedValue('remote')
    await acknowledgeRemoteDictation(true)
    await acknowledgeRemoteDictation(false)
    expect(dictationAllowed(await dictationState('fr-FR', noPack))).toBe(false)
  })

  it('audits both the acknowledgement and the withdrawal', async () => {
    // A withdrawal that leaves no trace is indistinguishable from never having
    // acknowledged, which is the entry a reviewer most needs to find.
    await acknowledgeRemoteDictation(true)
    await acknowledgeRemoteDictation(false)
    const details = (await db.audit.toArray()).map((a) => a.detail)
    expect(details).toContain('remoteDictation=acknowledged')
    expect(details).toContain('remoteDictation=withdrawn')
  })

  it('reports unavailable rather than needing a disclosure it cannot act on', async () => {
    available = false
    expect((await dictationState('fr-FR', noPack)).status).toBe('unavailable')
  })

  it('does not carry an acknowledgement across to on-device', async () => {
    // Acknowledging the remote service is not a standing permission; if the
    // browser later recognises locally, the honest state is on-device.
    await acknowledgeRemoteDictation(true)
    modeFor.mockResolvedValue('on-device')
    expect((await dictationState('fr-FR', noPack)).status).toBe('on-device')
  })
})

describe('the vendored model', () => {
  const withPack = { findPack: async () => 'whisper-base' as const }

  it('takes precedence over the remote service and asks for no disclosure', async () => {
    modeFor.mockResolvedValue('remote')
    const state = await dictationState('fr-FR', withPack)
    expect(state).toEqual({ status: 'local-model', pack: 'whisper-base' })
    expect(dictationAllowed(state)).toBe(true)
    expect(dictationLeavesDevice(state)).toBe(false)
  })

  it('takes precedence over the browser on-device path too', async () => {
    // Both keep audio local, so this is not a privacy decision. It is a
    // reliability one: the browser's language pack can vanish with an update
    // and does so silently, while a file on the facility's own server does not.
    modeFor.mockResolvedValue('on-device')
    expect((await dictationState('fr-FR', withPack)).status).toBe('local-model')
  })

  it('works in a browser with no Web Speech API at all', async () => {
    // The local path needs a microphone and a worker, not the vendor's API.
    // Firefox and older WebViews land here, and used to be told dictation was
    // simply unavailable.
    available = false
    modeFor.mockResolvedValue('remote')
    expect((await dictationState('fr-FR', withPack)).status).toBe('local-model')
  })

  it('is not used for a language the model would answer wrongly', async () => {
    // Whisper produces confident French for Malagasy rather than failing.
    // Malagasy therefore stays on the browser path, disclosure and all.
    modeFor.mockResolvedValue('remote')
    expect((await dictationState('mg-MG', withPack)).status).toBe('needs-disclosure')
  })

  it('does not consult the pack for a language it cannot serve', async () => {
    const findPack = vi.fn(async () => 'whisper-base' as const)
    modeFor.mockResolvedValue('remote')
    await dictationState('mg-MG', { findPack })
    expect(findPack).not.toHaveBeenCalled()
  })

  it('falls back rather than failing when no pack is installed', async () => {
    modeFor.mockResolvedValue('remote')
    expect((await dictationState('fr-FR', noPack)).status).toBe('needs-disclosure')
  })
})

describe('dictationLeavesDevice', () => {
  it('is false only for the two local paths', () => {
    expect(dictationLeavesDevice({ status: 'local-model', pack: 'whisper-base' })).toBe(false)
    expect(dictationLeavesDevice({ status: 'on-device' })).toBe(false)
  })

  it('is true for every path that reaches a third party', () => {
    expect(dictationLeavesDevice({ status: 'needs-disclosure' })).toBe(true)
    expect(dictationLeavesDevice({ status: 'remote-acknowledged', at: 1 })).toBe(true)
    // Unavailable cannot send anything, but it is not a claim that audio stays
    // local either, and this function is asked in order to make that claim.
    expect(dictationLeavesDevice({ status: 'unavailable' })).toBe(true)
  })
})

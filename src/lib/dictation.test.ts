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

const { dictationState, dictationAllowed, acknowledgeRemoteDictation } = await import('./dictation')

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
    const state = await dictationState('fr-FR')
    expect(state.status).toBe('needs-disclosure')
    expect(dictationAllowed(state)).toBe(false)
  })

  it('asks for nothing when recognition is on-device', async () => {
    // No disclosure is owed when there is nothing to disclose. Asking anyway
    // would train staff to dismiss the prompt that does matter.
    modeFor.mockResolvedValue('on-device')
    const state = await dictationState('fr-FR')
    expect(state.status).toBe('on-device')
    expect(dictationAllowed(state)).toBe(true)
  })

  it('allows dictation once acknowledged, and records when', async () => {
    modeFor.mockResolvedValue('remote')
    await acknowledgeRemoteDictation(true)
    const state = await dictationState('fr-FR')
    expect(state.status).toBe('remote-acknowledged')
    expect(dictationAllowed(state)).toBe(true)
  })

  it('can be withdrawn, and dictation stops again', async () => {
    modeFor.mockResolvedValue('remote')
    await acknowledgeRemoteDictation(true)
    await acknowledgeRemoteDictation(false)
    expect(dictationAllowed(await dictationState('fr-FR'))).toBe(false)
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
    expect((await dictationState('fr-FR')).status).toBe('unavailable')
  })

  it('does not carry an acknowledgement across to on-device', async () => {
    // Acknowledging the remote service is not a standing permission; if the
    // browser later recognises locally, the honest state is on-device.
    await acknowledgeRemoteDictation(true)
    modeFor.mockResolvedValue('on-device')
    expect((await dictationState('fr-FR')).status).toBe('on-device')
  })
})

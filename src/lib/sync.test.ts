/**
 * Tests for the sync client.
 *
 * This module was rewritten when device enrolment landed and had no coverage at
 * all, which is the wrong state for the code that decides whether a
 * consultation survives contact with a server.
 *
 * `fetch` is injected rather than mocked globally, so each test states exactly
 * what the server said and nothing depends on ordering. IndexedDB is real
 * (via `fake-indexeddb`), because the properties worth checking here are about
 * what ends up in the local store.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import 'fake-indexeddb/auto'
import { db } from '../db/db'
import {
  enrolDevice,
  getSyncSettings,
  isEnrolled,
  runSync,
  setSyncSettings,
  unenrolDevice,
} from './sync'
import type { Encounter, Patient } from '../db/schema'
import { setCurrentActor } from './audit'

const SERVER = 'https://sync.example.org'

/** A fetch stand-in that answers with one JSON payload and records the call. */
function stubFetch(status: number, payload: unknown) {
  const calls: Array<{ url: string; init: RequestInit }> = []
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init })
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => payload,
    } as Response
  }) as unknown as typeof fetch
  return { impl, calls }
}

const patient = (over: Partial<Patient> = {}): Patient => ({
  id: 'p1',
  familyName: 'RAKOTOARISOA',
  givenName: 'Voahirana',
  sex: 'female',
  preferredLang: 'mg',
  searchKey: 'rakotoarisoa voahirana',
  createdAt: 0,
  updatedAt: 100,
  ...over,
})

const encounter = (over: Partial<Encounter> = {}): Encounter => ({
  id: 'e1',
  patientId: 'p1',
  occurredAt: 0,
  vitals: {},
  prescriptions: [],
  provenance: {},
  attachmentIds: [],
  status: 'final',
  createdAt: 0,
  updatedAt: 100,
  ...over,
})

const emptyPull = { cursor: 0, pushed: 0, conflicts: [], changes: { patients: [], encounters: [] } }

beforeEach(async () => {
  // Service boundaries now enforce the permission matrix, so a test that
  // never signs in is refused. Admin here because these exercise the
  // operation rather than the gate; the gate has its own tests.
  setCurrentActor('test-admin', 'admin')
  await db.delete()
  await db.open()
})

describe('enrolment', () => {
  it('refuses to enrol before a server is configured', async () => {
    const result = await enrolDevice('ABCD-2345', 'phone')
    expect(result).toEqual({ ok: false, error: 'not_configured' })
  })

  it('stores the token, device and facility the server issues', async () => {
    await setSyncSettings({ serverUrl: SERVER })
    const { impl } = stubFetch(200, {
      token: 'afya_abc',
      deviceId: 'dev_1',
      facilityId: 'CSB2-Test',
    })

    const result = await enrolDevice('ABCD-2345', 'Nurse phone', { fetchImpl: impl })
    expect(result).toEqual({ ok: true, facilityId: 'CSB2-Test' })

    const settings = await getSyncSettings()
    expect(settings).toMatchObject({
      token: 'afya_abc',
      deviceId: 'dev_1',
      facilityId: 'CSB2-Test',
    })
    expect(isEnrolled(settings)).toBe(true)
  })

  it('surfaces the server reason for a refused code', async () => {
    await setSyncSettings({ serverUrl: SERVER })
    const { impl } = stubFetch(401, { error: 'invalid_code' })
    expect(await enrolDevice('WRNG-0000', 'phone', { fetchImpl: impl })).toEqual({
      ok: false,
      error: 'invalid_code',
    })
  })

  it('reports a network failure rather than throwing into the UI', async () => {
    await setSyncSettings({ serverUrl: SERVER })
    const impl = (async () => {
      throw new Error('offline')
    }) as unknown as typeof fetch
    expect(await enrolDevice('ABCD-2345', 'phone', { fetchImpl: impl })).toEqual({
      ok: false,
      error: 'network',
    })
  })

  it('does not let a caller choose its own facility', async () => {
    // The entire security property. `setSyncSettings` accepts only a server
    // URL; facility, token and device id are issued by enrolment.
    await setSyncSettings({ serverUrl: SERVER } as { serverUrl: string; facilityId?: string })
    expect((await getSyncSettings()).facilityId).toBe('')
  })
})

describe('un-enrolling', () => {
  it('forgets the credentials but keeps the records', async () => {
    // Un-enrolling is what happens when a phone changes hands. It must never be
    // a way to destroy a clinic's consultations by accident.
    await setSyncSettings({ serverUrl: SERVER })
    const { impl } = stubFetch(200, { token: 'afya_abc', deviceId: 'dev_1', facilityId: 'F' })
    await enrolDevice('ABCD-2345', 'phone', { fetchImpl: impl })
    await db.patients.put(patient())

    await unenrolDevice()

    const settings = await getSyncSettings()
    expect(isEnrolled(settings)).toBe(false)
    expect(settings.serverUrl).toBe(SERVER)
    expect(await db.patients.count()).toBe(1)
  })
})

describe('running a sync', () => {
  async function enrolled() {
    await setSyncSettings({ serverUrl: SERVER })
    const { impl } = stubFetch(200, { token: 'afya_tok', deviceId: 'dev_1', facilityId: 'CSB2' })
    await enrolDevice('ABCD-2345', 'phone', { fetchImpl: impl })
  }

  it('does nothing useful until the device is enrolled', async () => {
    await setSyncSettings({ serverUrl: SERVER })
    const { impl, calls } = stubFetch(200, emptyPull)
    const outcome = await runSync({ fetchImpl: impl })
    expect(outcome.error).toBe('not_configured')
    expect(calls).toHaveLength(0)
  })

  it('authenticates with the bearer token', async () => {
    await enrolled()
    const { impl, calls } = stubFetch(200, emptyPull)
    await runSync({ fetchImpl: impl })

    const headers = calls[0]!.init.headers as Record<string, string>
    expect(headers.authorization).toBe('Bearer afya_tok')
  })

  it('does not send a facility id, because the token carries the scope', async () => {
    await enrolled()
    const { impl, calls } = stubFetch(200, emptyPull)
    await runSync({ fetchImpl: impl })

    const body = JSON.parse(calls[0]!.init.body as string)
    expect(body.facilityId).toBeUndefined()
  })

  it('attributes the sync to the signed-in clinician', async () => {
    await enrolled()
    const { impl, calls } = stubFetch(200, emptyPull)
    await runSync({ fetchImpl: impl, actorId: 'clin_7' })

    expect(JSON.parse(calls[0]!.init.body as string).actorId).toBe('clin_7')
  })

  it('reads a 401 as "no longer enrolled", not as a network problem', async () => {
    // Telling staff to check their signal would send them chasing the wrong
    // thing entirely when an administrator has revoked the device.
    await enrolled()
    const { impl } = stubFetch(401, { error: 'unauthorised' })
    expect((await runSync({ fetchImpl: impl })).error).toBe('unauthorised')
  })

  it('reports a timeout distinctly from a network failure', async () => {
    await enrolled()
    const impl = (async () => {
      const err = new Error('aborted')
      err.name = 'AbortError'
      throw err
    }) as unknown as typeof fetch
    expect((await runSync({ fetchImpl: impl })).error).toBe('timeout')
  })

  it('pushes only records the server has not acknowledged', async () => {
    await enrolled()
    await db.patients.bulkPut([
      patient({ id: 'pending' }),
      patient({ id: 'acked', syncedAt: 5 }),
    ])
    const { impl, calls } = stubFetch(200, emptyPull)
    await runSync({ fetchImpl: impl })

    const body = JSON.parse(calls[0]!.init.body as string)
    expect(body.changes.patients.map((p: Patient) => p.id)).toEqual(['pending'])
  })

  it('never pushes a draft consultation', async () => {
    // An unconfirmed record must not leave the device or reach a statistic.
    await enrolled()
    await db.encounters.bulkPut([
      encounter({ id: 'draft', status: 'draft' }),
      encounter({ id: 'final', status: 'final' }),
    ])
    const { impl, calls } = stubFetch(200, emptyPull)
    await runSync({ fetchImpl: impl })

    const body = JSON.parse(calls[0]!.init.body as string)
    expect(body.changes.encounters.map((e: Encounter) => e.id)).toEqual(['final'])
  })
})

describe('applying what the server sends back', () => {
  async function enrolled() {
    await setSyncSettings({ serverUrl: SERVER })
    const { impl } = stubFetch(200, { token: 'afya_tok', deviceId: 'dev_1', facilityId: 'CSB2' })
    await enrolDevice('ABCD-2345', 'phone', { fetchImpl: impl })
  }

  it('writes a record it has never seen', async () => {
    await enrolled()
    const { impl } = stubFetch(200, {
      ...emptyPull,
      cursor: 9,
      changes: { patients: [patient({ id: 'new' })], encounters: [] },
    })
    const outcome = await runSync({ fetchImpl: impl })

    expect(outcome.pulled).toBe(1)
    expect(outcome.cursor).toBe(9)
    expect(await db.patients.get('new')).toBeDefined()
  })

  it('keeps the local copy when timestamps are equal', async () => {
    // Equal keeps local, so a device never churns its own records back and
    // forth with the server.
    await enrolled()
    await db.patients.put(patient({ familyName: 'LOCAL', updatedAt: 100 }))
    const { impl } = stubFetch(200, {
      ...emptyPull,
      changes: { patients: [patient({ familyName: 'REMOTE', updatedAt: 100 })], encounters: [] },
    })
    await runSync({ fetchImpl: impl })

    expect((await db.patients.get('p1'))?.familyName).toBe('LOCAL')
  })

  it('applies a strictly newer record', async () => {
    await enrolled()
    await db.patients.put(patient({ familyName: 'OLD', updatedAt: 100 }))
    const { impl } = stubFetch(200, {
      ...emptyPull,
      changes: { patients: [patient({ familyName: 'NEW', updatedAt: 200 })], encounters: [] },
    })
    await runSync({ fetchImpl: impl })

    expect((await db.patients.get('p1'))?.familyName).toBe('NEW')
  })

  it('refuses to overwrite a local draft, however new the remote record is', async () => {
    // A draft may be half-typed on the phone in someone's hand. Replacing it
    // would delete work in front of the person doing it.
    await enrolled()
    await db.encounters.put(encounter({ status: 'draft', notes: 'half typed', updatedAt: 1 }))
    const { impl } = stubFetch(200, {
      ...emptyPull,
      changes: {
        patients: [],
        encounters: [encounter({ status: 'final', notes: 'from server', updatedAt: 999 })],
      },
    })
    const outcome = await runSync({ fetchImpl: impl })

    expect(outcome.refused).toBe(1)
    expect(outcome.pulled).toBe(0)
    expect((await db.encounters.get('e1'))?.notes).toBe('half typed')
  })

  it('marks pushed records as acknowledged', async () => {
    await enrolled()
    await db.patients.put(patient({ updatedAt: 100 }))
    const { impl } = stubFetch(200, emptyPull)
    await runSync({ fetchImpl: impl })

    expect((await db.patients.get('p1'))?.syncedAt).toBeDefined()
  })

  it('leaves a record edited mid-flight still pending', async () => {
    // The race that silently loses an edit: the record changed while the
    // request was in the air, so acknowledging it would mark work as synced
    // that the server never saw.
    await enrolled()
    await db.patients.put(patient({ updatedAt: 100 }))

    const impl = (async () => {
      // Simulate the clinician editing the record before the response lands.
      await db.patients.update('p1', { updatedAt: 500, syncedAt: undefined })
      return { ok: true, status: 200, json: async () => emptyPull } as Response
    }) as unknown as typeof fetch

    await runSync({ fetchImpl: impl })
    expect((await db.patients.get('p1'))?.syncedAt).toBeUndefined()
  })

  it('does not advance the cursor when the request failed', async () => {
    await enrolled()
    const ok = stubFetch(200, { ...emptyPull, cursor: 42 })
    await runSync({ fetchImpl: ok.impl })

    const failed = stubFetch(500, {})
    await runSync({ fetchImpl: failed.impl })

    const next = stubFetch(200, emptyPull)
    await runSync({ fetchImpl: next.impl })
    expect(JSON.parse(next.calls[0]!.init.body as string).cursor).toBe(42)
  })

  it('counts conflicts the server reported', async () => {
    await enrolled()
    const { impl } = stubFetch(200, {
      ...emptyPull,
      conflicts: [{ kind: 'patients', id: 'p1', reason: 'server_newer' }],
    })
    expect((await runSync({ fetchImpl: impl })).conflicts).toBe(1)
  })
})

describe('a record the server rejected', () => {
  async function enrolled() {
    await setSyncSettings({ serverUrl: SERVER })
    const { impl } = stubFetch(200, { token: 'afya_tok', deviceId: 'dev_1', facilityId: 'CSB2' })
    await enrolDevice('ABCD-2345', 'phone', { fetchImpl: impl })
  }

  /**
   * The failure this guards against, in order:
   *
   *   1. Device pushes a stale row.
   *   2. Server keeps its own copy and reports a conflict.
   *   3. Device marks the row synced anyway.
   *   4. The pull never corrects it, because the canonical row's sequence is
   *      below the device's cursor.
   *
   * The two copies then differ for good. And since `purgeExpired` treats
   * `syncedAt !== undefined` as proof the server holds the record, the
   * diverged local row becomes eligible for destruction — divergence turning
   * into data loss.
   */
  const stale = () =>
    patient({ id: 'p1', familyName: 'RAKOTOARISOA', updatedAt: 1000, syncedAt: undefined })

  const canonical = {
    ...patient({ id: 'p1', familyName: 'RASOAMANANA', updatedAt: 5000 }),
  }

  it('is not marked as synced', async () => {
    await enrolled()
    await db.patients.put(stale())
    const { impl } = stubFetch(200, {
      ...emptyPull,
      pushed: 0,
      conflicts: [{ kind: 'patients', id: 'p1', reason: 'server_newer', record: canonical }],
    })

    await runSync({ fetchImpl: impl })
    const row = await db.patients.get('p1')
    // Either it took the canonical row (and is synced as that), or it stayed
    // pending — but it must never be the stale body marked as acknowledged.
    expect(row!.familyName === 'RAKOTOARISOA' && row!.syncedAt !== undefined).toBe(false)
  })

  it('converges on the server copy', async () => {
    await enrolled()
    await db.patients.put(stale())
    const { impl } = stubFetch(200, {
      ...emptyPull,
      conflicts: [{ kind: 'patients', id: 'p1', reason: 'server_newer', record: canonical }],
    })

    await runSync({ fetchImpl: impl })
    expect((await db.patients.get('p1'))!.familyName).toBe('RASOAMANANA')
  })

  it('leaves the row pending when an older server sends no body', async () => {
    // Backwards compatible: against a server that reports conflicts without
    // the canonical record, the client cannot converge — but it must still
    // refuse to claim the row is synced. Pending is recoverable; a false
    // acknowledgement is not.
    await enrolled()
    await db.patients.put(stale())
    const { impl } = stubFetch(200, {
      ...emptyPull,
      conflicts: [{ kind: 'patients', id: 'p1', reason: 'server_newer' }],
    })

    await runSync({ fetchImpl: impl })
    expect((await db.patients.get('p1'))!.syncedAt).toBeUndefined()
  })

  it('still acknowledges the records that were accepted', async () => {
    // The fix must not throw away the acknowledgement for everything else.
    await enrolled()
    await db.patients.put(stale())
    await db.patients.put(patient({ id: 'p2', updatedAt: 1000, syncedAt: undefined }))
    const { impl } = stubFetch(200, {
      ...emptyPull,
      conflicts: [{ kind: 'patients', id: 'p1', reason: 'server_newer', record: canonical }],
    })

    await runSync({ fetchImpl: impl })
    expect((await db.patients.get('p2'))!.syncedAt).toBeDefined()
  })

  it('does not overwrite a local draft with a conflicting server copy', async () => {
    // Conflicts go through applyPulled, so the draft protection still applies:
    // a consultation somebody is part-way through typing is not replaced.
    await enrolled()
    await db.encounters.put(
      encounter({ id: 'e1', status: 'draft', updatedAt: 1000, syncedAt: undefined }),
    )
    const { impl } = stubFetch(200, {
      ...emptyPull,
      conflicts: [
        {
          kind: 'encounters',
          id: 'e1',
          reason: 'server_newer',
          record: { ...encounter({ id: 'e1', updatedAt: 9000 }), diagnosis: 'from server' },
        },
      ],
    })

    await runSync({ fetchImpl: impl })
    const row = await db.encounters.get('e1')
    expect(row!.status).toBe('draft')
    expect(row!.diagnosis).not.toBe('from server')
  })
})

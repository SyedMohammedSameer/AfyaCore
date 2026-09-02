/**
 * End-to-end tests for the sync server's HTTP surface.
 *
 * These exist because the access-control properties they check were, until
 * now, verified exactly once: by hand, with curl, in a terminal that no longer
 * exists. "An unauthenticated request cannot read a facility's records" is the
 * single most important claim this project makes, and a claim nobody can re-run
 * is not evidence of anything.
 *
 * The real server is booted against an in-memory database on an ephemeral port,
 * so what is exercised is the actual request path: routing, auth, rate
 * limiting, CORS, the audit chain and the error handler. Nothing is mocked.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createSyncApp } from './sync-server.mjs'

const ORIGIN = 'https://afyacore.example.org'

let app
let base

async function boot(options = {}) {
  app = createSyncApp({ dbPath: ':memory:', allowedOrigins: [ORIGIN], ...options })
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${app.server.address().port}`
  return app
}

/** Create a facility and mint a code, the way `cli.mjs` does. */
function facility(id = 'CSB2-Test') {
  app.auth.upsertFacility(id, `Facility ${id}`, 'MG')
  return app.auth.createEnrolmentCode(id).code
}

const post = (path, body, headers = {}) =>
  fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })

/** Enrol a device and return its bearer token. */
async function enrol(code, name = 'Nurse phone') {
  const response = await post('/enrol', { code, deviceName: name })
  const payload = await response.json()
  return payload.token
}

beforeEach(async () => {
  await boot()
})

afterEach(async () => {
  await app?.close()
})

describe('access control', () => {
  it('refuses a sync with no token', async () => {
    // The whole reason the auth layer exists. Before it, this returned the
    // facility's entire record set to anyone who guessed the id.
    const response = await post('/sync', { facilityId: 'CSB2-Test', cursor: 0 })
    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: 'unauthorised' })
  })

  it('refuses a sync with a made-up token', async () => {
    const response = await post('/sync', { cursor: 0 }, { authorization: 'Bearer afya_nonsense' })
    expect(response.status).toBe(401)
  })

  it('refuses a malformed Authorization header', async () => {
    const response = await post('/sync', { cursor: 0 }, { authorization: 'Basic abc' })
    expect(response.status).toBe(401)
  })

  it('accepts a sync with a token from enrolment', async () => {
    const token = await enrol(facility())
    const response = await post('/sync', { cursor: 0 }, { authorization: `Bearer ${token}` })
    expect(response.status).toBe(200)
  })

  it('ignores a facilityId in the body and uses the token', async () => {
    // The property that makes the fix airtight: scope is not compared against
    // the body, it is taken from the token, so there is no comparison to get
    // wrong. A client claiming another facility gets its own, not an error.
    app.auth.upsertFacility('OTHER-FACILITY', 'Someone else', 'MG')
    const token = await enrol(facility('MINE'))

    const response = await post(
      '/sync',
      { facilityId: 'OTHER-FACILITY', cursor: 0 },
      { authorization: `Bearer ${token}` },
    )
    expect((await response.json()).facilityId).toBe('MINE')
  })

  it('never returns another facility records', async () => {
    // Push a record as facility A.
    const tokenA = await enrol(facility('FAC-A'))
    await post(
      '/sync',
      { cursor: 0, changes: { patients: [{ id: 'p1', updatedAt: 1, familyName: 'RAKOTO' }] } },
      { authorization: `Bearer ${tokenA}` },
    )

    // Facility B pulls from zero and must see nothing.
    const tokenB = await enrol(facility('FAC-B'))
    const response = await post('/sync', { cursor: 0 }, { authorization: `Bearer ${tokenB}` })
    const payload = await response.json()
    expect(payload.facilityId).toBe('FAC-B')
    expect(payload.changes.patients).toEqual([])
  })

  it('refuses a revoked token, which is what a lost phone depends on', async () => {
    const code = facility()
    const response = await post('/enrol', { code, deviceName: 'Lost phone' })
    const { token, deviceId } = await response.json()

    expect((await post('/sync', { cursor: 0 }, { authorization: `Bearer ${token}` })).status).toBe(200)

    app.auth.revokeDevice(deviceId)

    expect((await post('/sync', { cursor: 0 }, { authorization: `Bearer ${token}` })).status).toBe(401)
  })
})

describe('enrolment', () => {
  it('rejects a code that was never issued', async () => {
    facility()
    const response = await post('/enrol', { code: '2345-6789' })
    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: 'invalid_code' })
  })

  it('rejects a code the second time it is used', async () => {
    const code = facility()
    expect((await post('/enrol', { code })).status).toBe(200)
    expect((await post('/enrol', { code })).status).toBe(401)
  })

  it('gives the same answer for wrong, used and expired codes', async () => {
    // Distinguishing them would tell an attacker which half of a guess landed.
    const used = facility()
    await post('/enrol', { code: used })
    const expired = app.auth.createEnrolmentCode('CSB2-Test', -1000).code

    const bodies = await Promise.all(
      [used, expired, '2345-6789'].map(async (code) => (await post('/enrol', { code })).json()),
    )
    expect(bodies).toEqual([
      { error: 'invalid_code' },
      { error: 'invalid_code' },
      { error: 'invalid_code' },
    ])
  })
})

describe('rate limiting', () => {
  it('throttles enrolment attempts, which is what makes a 38-bit code safe', async () => {
    await boot({ limits: { enrol: 3, sync: 240 } })
    facility()

    const statuses = []
    for (let i = 0; i < 5; i++) {
      statuses.push((await post('/enrol', { code: '2345-6789' })).status)
    }
    // Three attempts land, the rest are refused without even being checked.
    expect(statuses).toEqual([401, 401, 401, 429, 429])
  })

  it('throttles sync per device rather than per address', async () => {
    await boot({ limits: { enrol: 10, sync: 2 } })
    const token = await enrol(facility())
    const auth = { authorization: `Bearer ${token}` }

    expect((await post('/sync', { cursor: 0 }, auth)).status).toBe(200)
    expect((await post('/sync', { cursor: 0 }, auth)).status).toBe(200)
    expect((await post('/sync', { cursor: 0 }, auth)).status).toBe(429)
  })
})

describe('CORS', () => {
  it('permits the configured origin', async () => {
    const response = await fetch(`${base}/sync`, { method: 'OPTIONS', headers: { origin: ORIGIN } })
    expect(response.status).toBe(204)
    expect(response.headers.get('access-control-allow-origin')).toBe(ORIGIN)
  })

  it('refuses an origin nobody configured', async () => {
    // It previously allowed `*`, meaning any page on the internet could drive a
    // facility's server using a logged-in browser.
    const response = await fetch(`${base}/sync`, {
      method: 'OPTIONS',
      headers: { origin: 'https://evil.example' },
    })
    expect(response.headers.get('access-control-allow-origin')).toBeNull()
  })
})

describe('response hygiene', () => {
  it('forbids caching, because a sync response is patient data', async () => {
    const token = await enrol(facility())
    const response = await post('/sync', { cursor: 0 }, { authorization: `Bearer ${token}` })
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(response.headers.get('referrer-policy')).toBe('no-referrer')
  })

  it('says nothing about what exists on an unauthenticated health check', async () => {
    facility('SECRET-FACILITY')
    const body = await (await fetch(`${base}/health`)).json()
    expect(body).toEqual({ ok: true, service: 'afyacore-sync' })
    expect(JSON.stringify(body)).not.toContain('SECRET')
  })

  it('404s an unknown path', async () => {
    expect((await fetch(`${base}/admin`)).status).toBe(404)
  })
})

describe('robustness', () => {
  it('survives a malformed body without dropping the process', async () => {
    // A throw inside the handler used to kill the server, which takes a whole
    // facility offline until somebody notices and restarts it.
    const token = await enrol(facility())
    const bad = await post('/sync', 'not json at all', { authorization: `Bearer ${token}` })
    expect(bad.status).toBe(400)

    // Still serving.
    expect((await fetch(`${base}/health`)).status).toBe(200)
  })

  it('drops records that cannot take part in last-write-wins', async () => {
    const token = await enrol(facility())
    const response = await post(
      '/sync',
      {
        cursor: 0,
        changes: {
          patients: [
            { id: 'good', updatedAt: 5 },
            { id: 'no-timestamp' },
            { updatedAt: 5 },
            null,
            'not an object',
          ],
        },
      },
      { authorization: `Bearer ${token}` },
    )
    expect((await response.json()).pushed).toBe(1)
  })
})

describe('push and pull', () => {
  it('reports a conflict rather than overwriting a newer server record', async () => {
    const token = await enrol(facility())
    const auth = { authorization: `Bearer ${token}` }

    await post('/sync', { cursor: 0, changes: { patients: [{ id: 'p1', updatedAt: 100 }] } }, auth)
    const stale = await post(
      '/sync',
      { cursor: 0, changes: { patients: [{ id: 'p1', updatedAt: 50 }] } },
      auth,
    )

    const payload = await stale.json()
    expect(payload.pushed).toBe(0)
    expect(payload.conflicts[0]).toMatchObject({ id: 'p1', reason: 'server_newer' })
  })

  it('treats an identical re-push as idempotent', async () => {
    const token = await enrol(facility())
    const auth = { authorization: `Bearer ${token}` }
    const change = { cursor: 0, changes: { patients: [{ id: 'p1', updatedAt: 100 }] } }

    await post('/sync', change, auth)
    const retry = await post('/sync', change, auth)
    // Equal timestamps keep the server copy, so a retried push after a dropped
    // connection cannot churn the sequence.
    expect((await retry.json()).pushed).toBe(0)
  })

  it('advances the cursor so a device does not re-read what it has seen', async () => {
    const token = await enrol(facility())
    const auth = { authorization: `Bearer ${token}` }

    const first = await (
      await post('/sync', { cursor: 0, changes: { patients: [{ id: 'p1', updatedAt: 1 }] } }, auth)
    ).json()
    expect(first.changes.patients).toHaveLength(1)

    const second = await (await post('/sync', { cursor: first.cursor }, auth)).json()
    expect(second.changes.patients).toEqual([])
  })

  it('carries a tombstone through, because a delete has to propagate', async () => {
    const token = await enrol(facility())
    const auth = { authorization: `Bearer ${token}` }

    await post('/sync', { cursor: 0, changes: { patients: [{ id: 'p1', updatedAt: 1 }] } }, auth)
    await post(
      '/sync',
      { cursor: 0, changes: { patients: [{ id: 'p1', updatedAt: 2, deletedAt: 2 }] } },
      auth,
    )

    const pulled = await (await post('/sync', { cursor: 0 }, auth)).json()
    expect(pulled.changes.patients[0]).toMatchObject({ id: 'p1', deletedAt: 2 })
  })
})

describe('the audit trail', () => {
  it('records a failed enrolment even though there is no facility yet', async () => {
    // Precisely the events worth keeping. An audit log that can only describe
    // authenticated traffic cannot record an attack.
    facility()
    await post('/enrol', { code: '2345-6789' })
    expect(app.audit.verifyChain().ok).toBe(true)

    const all = app.db.prepare('SELECT action FROM audit ORDER BY seq').all()
    expect(all.map((r) => r.action)).toContain('enrol.failed')
  })

  it('records an unauthorised sync attempt', async () => {
    await post('/sync', { cursor: 0 })
    const all = app.db.prepare('SELECT action FROM audit ORDER BY seq').all()
    expect(all.map((r) => r.action)).toContain('sync.unauthorised')
  })

  it('records counts, never record contents', async () => {
    const token = await enrol(facility())
    await post(
      '/sync',
      {
        cursor: 0,
        actorId: 'clin_01',
        changes: { patients: [{ id: 'p1', updatedAt: 1, familyName: 'RAKOTOARISOA' }] },
      },
      { authorization: `Bearer ${token}` },
    )

    const rows = app.db.prepare("SELECT detail, actor_id FROM audit WHERE action = 'sync'").all()
    expect(rows[0].actor_id).toBe('clin_01')
    expect(rows[0].detail).toContain('"pushed":1')
    // An audit log that duplicates the clinical record doubles the blast radius
    // of losing it.
    expect(rows[0].detail).not.toContain('RAKOTOARISOA')
  })

  it('stays verifiable across a realistic session', async () => {
    const token = await enrol(facility())
    const auth = { authorization: `Bearer ${token}` }
    await post('/sync', { cursor: 0, changes: { patients: [{ id: 'p1', updatedAt: 1 }] } }, auth)
    await post('/sync', { cursor: 0 }, auth)
    await post('/enrol', { code: 'wrong' })

    expect(app.audit.verifyChain().ok).toBe(true)
  })

  it('detects tampering with a sync entry', async () => {
    const token = await enrol(facility())
    await post('/sync', { cursor: 0 }, { authorization: `Bearer ${token}` })

    app.db.exec("UPDATE audit SET detail = '{\"pushed\":999}' WHERE action = 'sync'")

    const result = app.audit.verifyChain()
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('hash_mismatch')
  })
})

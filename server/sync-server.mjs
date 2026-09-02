#!/usr/bin/env node
/**
 * AfyaCore sync server.
 *
 * A facility's records live on the phone. This server exists so they can also
 * reach the district without a USB stick, and so a facility running two phones
 * sees one roster.
 *
 * Deliberately zero dependencies: `node:sqlite`, `node:http` and `node:crypto`
 * are all standard library from Node 22. Whoever runs this is likely an NGO IT
 * volunteer on a small VPS, and "node server/sync-server.mjs" with nothing to
 * install is worth more than any framework convenience.
 *
 * Protocol: cursor-based push then pull, over a single authenticated POST.
 *
 *   POST /sync            Authorization: Bearer afya_...
 *   { cursor, actorId, changes: { patients: [], encounters: [] } }
 *   -> { cursor, changes: { patients: [], encounters: [] }, pushed, conflicts }
 *
 * The client pushes what it has, then receives everything it has not seen.
 * `cursor` is a server-assigned monotonic sequence, not a timestamp, so device
 * clock skew (common on phones that lose power) cannot cause a record to be
 * skipped on pull.
 *
 * Facility scope comes from the bearer token and is never read from the request
 * body. That is the whole point of the auth layer: previously, knowing a
 * guessable facility id was enough to read a facility's entire record set.
 *
 * Administration is a CLI, not an HTTP surface: `node server/cli.mjs --help`.
 * There is no admin endpoint to leave unauthenticated by accident.
 */
import { createServer } from 'node:http'
import { createServer as createTlsServer } from 'node:https'
import { readFileSync } from 'node:fs'
import { openStore, makeRecordQueries, isValidRecord, KINDS, KIND_OF, PAGE_SIZE } from './store.mjs'
import { makeAuthQueries, bearerFrom } from './auth.mjs'
import { makeAuditLog } from './audit.mjs'

const PORT = Number(process.env.PORT ?? 8787)
const DB_PATH = process.env.AFYACORE_DB ?? './server/data/afyacore.db'
const MAX_BODY_BYTES = 8 * 1024 * 1024

/**
 * Allowed browser origins. A PWA calls this cross-origin, so CORS has to be
 * permitted, but `*` meant any page on the internet could drive a logged-in
 * device's server. Defaults to none: a deployer states their origin.
 */
const ALLOWED_ORIGINS = (process.env.AFYACORE_ALLOWED_ORIGINS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)

const db = openStore(DB_PATH)
const records = makeRecordQueries(db)
const auth = makeAuthQueries(db)
const audit = makeAuditLog(db)

/* ------------------------------------------------------------------ *
 * Rate limiting
 * ------------------------------------------------------------------ */

/**
 * Fixed-window counters, in memory.
 *
 * Enrolment is the endpoint that matters: an 8-character code is ~38 bits, and
 * without a limit an attacker could simply walk the space. 10 attempts per
 * minute per address turns that into centuries. Sync is limited far more
 * loosely, because a device catching up after a week offline is legitimate and
 * should not be throttled into failure.
 */
const WINDOW_MS = 60_000
const LIMITS = { enrol: 10, sync: 240 }
const buckets = new Map()

function rateLimited(kind, key) {
  const now = Date.now()
  const id = `${kind}:${key}`
  const bucket = buckets.get(id)
  if (!bucket || now >= bucket.resetAt) {
    buckets.set(id, { count: 1, resetAt: now + WINDOW_MS })
    return false
  }
  bucket.count++
  return bucket.count > LIMITS[kind]
}

// Unbounded maps are a slow leak on a long-running process.
setInterval(() => {
  const now = Date.now()
  for (const [id, bucket] of buckets) if (now >= bucket.resetAt) buckets.delete(id)
}, WINDOW_MS).unref()

/* ------------------------------------------------------------------ *
 * Sync
 * ------------------------------------------------------------------ */

function applyPush(facilityId, changes) {
  const incoming = []
  for (const kind of KINDS) {
    for (const record of changes?.[kind] ?? []) {
      if (isValidRecord(record)) incoming.push({ kind, record })
    }
  }
  if (incoming.length === 0) return { pushed: 0, conflicts: [] }

  const conflicts = []
  let seq = records.nextSeq(facilityId, incoming.length)
  let pushed = 0

  // One transaction so a dropped connection mid-push cannot leave a facility's
  // sequence advanced past records that were never written.
  db.exec('BEGIN IMMEDIATE')
  try {
    for (const { kind, record } of incoming) {
      const existing = records.selectOne.get(facilityId, KIND_OF[kind], record.id)

      // Last write wins on updatedAt. Equal timestamps keep the server's copy,
      // which makes a retried push idempotent rather than churning the sequence.
      if (existing && existing.updated_at >= record.updatedAt) {
        conflicts.push({
          kind,
          id: record.id,
          reason: 'server_newer',
          serverUpdatedAt: existing.updated_at,
        })
        continue
      }

      records.upsert.run(
        facilityId,
        KIND_OF[kind],
        record.id,
        record.updatedAt,
        record.deletedAt ?? null,
        ++seq,
        JSON.stringify(record),
      )
      pushed++
    }
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }

  return { pushed, conflicts }
}

function readPull(facilityId, cursor) {
  const rows = records.selectSince.all(facilityId, cursor, PAGE_SIZE)
  const changes = { patients: [], encounters: [] }
  let latest = cursor
  for (const row of rows) {
    const bucket = row.kind === 'patient' ? 'patients' : 'encounters'
    changes[bucket].push(JSON.parse(row.body))
    if (row.seq > latest) latest = row.seq
  }
  // `hasMore` lets a device that has been offline for months catch up in pages
  // rather than timing out on one enormous response.
  return { changes, cursor: latest, hasMore: rows.length === PAGE_SIZE }
}

/* ------------------------------------------------------------------ *
 * HTTP
 * ------------------------------------------------------------------ */

function corsHeaders(origin) {
  if (!origin || !ALLOWED_ORIGINS.includes(origin)) return {}
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-headers': 'content-type, authorization',
    'access-control-allow-methods': 'POST, GET, OPTIONS',
    'access-control-max-age': '600',
    vary: 'origin',
  }
}

function send(res, status, payload, origin) {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    // A sync response is patient data. Nothing may cache it, anywhere.
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    ...corsHeaders(origin),
  })
  res.end(body)
}

function readBody(req) {
  return new Promise((resolvePromise, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        reject(new Error('payload too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolvePromise(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

/**
 * Client address for rate limiting.
 *
 * `x-forwarded-for` is trusted only when the deployer says they are behind a
 * proxy, because otherwise a client can spoof the header and defeat the limit
 * by changing one string.
 */
const TRUST_PROXY = process.env.AFYACORE_TRUST_PROXY === '1'

function clientAddress(req) {
  if (TRUST_PROXY) {
    const forwarded = req.headers['x-forwarded-for']
    if (typeof forwarded === 'string' && forwarded) return forwarded.split(',')[0].trim()
  }
  return req.socket.remoteAddress ?? 'unknown'
}

const route = async (req, res) => {
  const origin = req.headers.origin
  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders(origin))
    return res.end()
  }

  // Liveness only. Deliberately says nothing about facilities or devices: an
  // unauthenticated endpoint should not confirm what exists on the server.
  if (req.method === 'GET' && req.url === '/health') {
    return send(res, 200, { ok: true, service: 'afyacore-sync' }, origin)
  }

  const address = clientAddress(req)

  /* --- Device enrolment: the one endpoint reachable without a token --- */
  if (req.method === 'POST' && req.url === '/enrol') {
    if (rateLimited('enrol', address)) return send(res, 429, { error: 'rate_limited' }, origin)
    try {
      const payload = JSON.parse((await readBody(req)) || '{}')
      const result = auth.enrolDevice(payload.code ?? '', payload.deviceName ?? '')
      if (!result) {
        // One message for a wrong code, an expired code and a used code alike.
        // Distinguishing them tells an attacker which half of the guess landed.
        audit.record({
          facilityId: null,
          action: 'enrol.failed',
          detail: { address, deviceName: String(payload.deviceName ?? '').slice(0, 60) },
        })
        return send(res, 401, { error: 'invalid_code' }, origin)
      }
      audit.record({
        facilityId: result.facilityId,
        deviceId: result.deviceId,
        action: 'enrol.succeeded',
        detail: { address, deviceName: payload.deviceName },
      })
      return send(
        res,
        200,
        { token: result.token, deviceId: result.deviceId, facilityId: result.facilityId },
        origin,
      )
    } catch (err) {
      return send(res, 400, { error: 'bad_request' }, origin)
    }
  }

  if (req.method !== 'POST' || !req.url?.startsWith('/sync')) {
    return send(res, 404, { error: 'not_found' }, origin)
  }

  /* --- Everything below requires a device token --- */
  const device = auth.authenticate(bearerFrom(req.headers.authorization))
  if (!device) {
    audit.record({ facilityId: null, action: 'sync.unauthorised', detail: { address } })
    return send(res, 401, { error: 'unauthorised' }, origin)
  }

  if (rateLimited('sync', device.id)) return send(res, 429, { error: 'rate_limited' }, origin)

  try {
    const raw = await readBody(req)
    const payload = raw ? JSON.parse(raw) : {}

    // Facility scope comes from the token. A facilityId in the body is ignored
    // entirely rather than checked, so there is no comparison to get wrong.
    const facilityId = device.facility_id

    const cursor = Number.isFinite(payload.cursor) ? Number(payload.cursor) : 0
    const actorId = typeof payload.actorId === 'string' ? payload.actorId.slice(0, 64) : null

    const { pushed, conflicts } = applyPush(facilityId, payload.changes)
    // Pull happens after push so a device immediately sees the canonical
    // version of anything the server rejected as stale.
    const pull = readPull(facilityId, cursor)

    // The audit entry names counts, never record contents: an audit log that
    // duplicates the clinical record doubles the blast radius of losing it.
    audit.record({
      facilityId,
      deviceId: device.id,
      actorId,
      action: 'sync',
      detail: {
        pushed,
        conflicts: conflicts.length,
        pulled: pull.changes.patients.length + pull.changes.encounters.length,
        cursor,
      },
    })

    send(
      res,
      200,
      {
        serverTime: Date.now(),
        facilityId,
        pushed,
        conflicts,
        changes: pull.changes,
        cursor: pull.cursor,
        hasMore: pull.hasMore,
      },
      origin,
    )
  } catch (err) {
    send(res, 400, { error: 'bad_request', detail: String(err?.message ?? err) }, origin)
  }
}

/**
 * Nothing thrown by a request may stop the process.
 *
 * A facility syncing at the end of a clinic day cannot tell the difference
 * between "the server rejected my request" and "the server is gone", but the
 * second one loses the whole facility until somebody notices and restarts it.
 * One malformed request must never be able to cause that.
 *
 * The detail is logged and not returned: an internal error message can name a
 * table, a path, or a column, and none of that belongs in a response.
 */
const handler = async (req, res) => {
  try {
    await route(req, res)
  } catch (err) {
    console.error('unhandled request error:', err)
    if (!res.headersSent) {
      try {
        send(res, 500, { error: 'internal_error' }, req.headers.origin)
      } catch {
        res.destroy()
      }
    } else {
      res.destroy()
    }
  }
}

/* ------------------------------------------------------------------ *
 * Boot
 * ------------------------------------------------------------------ */

const TLS_CERT = process.env.AFYACORE_TLS_CERT
const TLS_KEY = process.env.AFYACORE_TLS_KEY

const server =
  TLS_CERT && TLS_KEY
    ? createTlsServer({ cert: readFileSync(TLS_CERT), key: readFileSync(TLS_KEY) }, handler)
    : createServer(handler)

server.listen(PORT, () => {
  const scheme = TLS_CERT && TLS_KEY ? 'https' : 'http'
  console.log(`afyacore sync server listening on ${scheme}://0.0.0.0:${PORT}`)
  console.log(`database: ${DB_PATH}`)
  console.log(`facilities: ${auth.listFacilities().length}`)

  if (scheme === 'http') {
    console.log(
      'NOTE: serving plain HTTP. Terminate TLS at a reverse proxy, or set ' +
        'AFYACORE_TLS_CERT and AFYACORE_TLS_KEY to serve it here.',
    )
  }
  if (ALLOWED_ORIGINS.length === 0) {
    console.log(
      'NOTE: AFYACORE_ALLOWED_ORIGINS is unset, so no browser origin is permitted. ' +
        'Set it to the app origin, e.g. https://afyacore.example.org',
    )
  }
  console.log('admin: node server/cli.mjs --help')
})

process.on('SIGTERM', () => server.close(() => db.close()))
process.on('SIGINT', () => server.close(() => db.close()))

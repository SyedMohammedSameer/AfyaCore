#!/usr/bin/env node
/**
 * AfyaCore sync server.
 *
 * A facility's records live on the phone. This server exists so they can also
 * reach the district without a USB stick, and so a facility running two phones
 * sees one roster.
 *
 * Deliberately zero dependencies: `node:sqlite` and `node:http` are both in the
 * standard library from Node 22. Whoever runs this is likely an NGO IT
 * volunteer on a small VPS, and "node server/sync-server.mjs" with nothing to
 * install is worth more than any framework convenience.
 *
 * Protocol: cursor-based push then pull, over a single POST.
 *
 *   POST /sync
 *   { facilityId, deviceId, cursor, changes: { patients: [], encounters: [] } }
 *   -> { cursor, changes: { patients: [], encounters: [] }, pushed, conflicts }
 *
 * The client pushes what it has, then receives everything it has not seen.
 * `cursor` is a server-assigned monotonic sequence, not a timestamp, so device
 * clock skew (common on phones that lose power) cannot cause a record to be
 * skipped on pull.
 *
 * NOT IMPLEMENTED YET, deliberately: authentication and an audit trail. Do not
 * put real patient data on a public instance until those exist. See README.
 */
import { createServer } from 'node:http'
import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const PORT = Number(process.env.PORT ?? 8787)
const DB_PATH = resolve(process.env.AFYACORE_DB ?? './server/data/afyacore.db')
const MAX_BODY_BYTES = 8 * 1024 * 1024
const PAGE_SIZE = 500

mkdirSync(dirname(DB_PATH), { recursive: true })
const db = new DatabaseSync(DB_PATH)

db.exec(`
  PRAGMA journal_mode = WAL;

  CREATE TABLE IF NOT EXISTS records (
    facility_id TEXT NOT NULL,
    kind        TEXT NOT NULL,
    id          TEXT NOT NULL,
    updated_at  INTEGER NOT NULL,
    deleted_at  INTEGER,
    seq         INTEGER NOT NULL,
    body        TEXT NOT NULL,
    PRIMARY KEY (facility_id, kind, id)
  );

  -- Pull is always "everything after this cursor", so the sequence is the index
  -- that matters.
  CREATE INDEX IF NOT EXISTS records_by_seq ON records (facility_id, seq);

  CREATE TABLE IF NOT EXISTS counters (
    facility_id TEXT PRIMARY KEY,
    value       INTEGER NOT NULL
  );
`)

const KINDS = ['patients', 'encounters']
const KIND_OF = { patients: 'patient', encounters: 'encounter' }

const selectOne = db.prepare(
  'SELECT updated_at, deleted_at FROM records WHERE facility_id = ? AND kind = ? AND id = ?',
)
const upsert = db.prepare(`
  INSERT INTO records (facility_id, kind, id, updated_at, deleted_at, seq, body)
  VALUES (?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT (facility_id, kind, id) DO UPDATE SET
    updated_at = excluded.updated_at,
    deleted_at = excluded.deleted_at,
    seq        = excluded.seq,
    body       = excluded.body
`)
const selectSince = db.prepare(
  'SELECT kind, body, seq FROM records WHERE facility_id = ? AND seq > ? ORDER BY seq LIMIT ?',
)
const readCounter = db.prepare('SELECT value FROM counters WHERE facility_id = ?')
const writeCounter = db.prepare(
  'INSERT INTO counters (facility_id, value) VALUES (?, ?) ON CONFLICT (facility_id) DO UPDATE SET value = excluded.value',
)

function nextSeq(facilityId, count) {
  const current = readCounter.get(facilityId)?.value ?? 0
  const updated = current + count
  writeCounter.run(facilityId, updated)
  return current
}

/**
 * Reject anything that is not a record we recognise.
 *
 * A sync endpoint accepts writes from the field, so it must never trust the
 * shape of what arrives. Records without an id or updatedAt cannot participate
 * in last-write-wins and are dropped rather than stored as junk.
 */
function isValidRecord(record) {
  return (
    record !== null &&
    typeof record === 'object' &&
    typeof record.id === 'string' &&
    record.id.length > 0 &&
    record.id.length <= 128 &&
    Number.isFinite(record.updatedAt)
  )
}

function applyPush(facilityId, changes) {
  const incoming = []
  for (const kind of KINDS) {
    for (const record of changes?.[kind] ?? []) {
      if (isValidRecord(record)) incoming.push({ kind, record })
    }
  }
  if (incoming.length === 0) return { pushed: 0, conflicts: [] }

  const conflicts = []
  let seq = nextSeq(facilityId, incoming.length)
  let pushed = 0

  // One transaction so a dropped connection mid-push cannot leave a facility's
  // sequence advanced past records that were never written.
  db.exec('BEGIN IMMEDIATE')
  try {
    for (const { kind, record } of incoming) {
      const existing = selectOne.get(facilityId, KIND_OF[kind], record.id)

      // Last write wins on updatedAt. Equal timestamps keep the server's copy,
      // which makes a retried push idempotent rather than churning the sequence.
      if (existing && existing.updated_at >= record.updatedAt) {
        conflicts.push({ kind, id: record.id, reason: 'server_newer', serverUpdatedAt: existing.updated_at })
        continue
      }

      upsert.run(
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
  const rows = selectSince.all(facilityId, cursor, PAGE_SIZE)
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

function send(res, status, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'content-type',
    'access-control-allow-methods': 'POST, GET, OPTIONS',
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

const server = createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return send(res, 204, {})

  if (req.method === 'GET' && req.url === '/health') {
    return send(res, 200, { ok: true, service: 'afyacore-sync', time: Date.now() })
  }

  if (req.method !== 'POST' || !req.url?.startsWith('/sync')) {
    return send(res, 404, { error: 'not_found' })
  }

  try {
    const raw = await readBody(req)
    const payload = raw ? JSON.parse(raw) : {}
    const facilityId = String(payload.facilityId ?? '').trim()
    if (!facilityId || facilityId.length > 128) {
      return send(res, 400, { error: 'facilityId_required' })
    }

    const cursor = Number.isFinite(payload.cursor) ? Number(payload.cursor) : 0
    const { pushed, conflicts } = applyPush(facilityId, payload.changes)
    // Pull happens after push so a device immediately sees the canonical
    // version of anything the server rejected as stale.
    const pull = readPull(facilityId, cursor)

    send(res, 200, {
      serverTime: Date.now(),
      pushed,
      conflicts,
      changes: pull.changes,
      cursor: pull.cursor,
      hasMore: pull.hasMore,
    })
  } catch (err) {
    send(res, 400, { error: 'bad_request', detail: String(err?.message ?? err) })
  }
})

server.listen(PORT, () => {
  console.log(`afyacore sync server listening on :${PORT}`)
  console.log(`database: ${DB_PATH}`)
  console.log('WARNING: no authentication. Do not expose real patient data publicly.')
})

process.on('SIGTERM', () => server.close(() => db.close()))
process.on('SIGINT', () => server.close(() => db.close()))

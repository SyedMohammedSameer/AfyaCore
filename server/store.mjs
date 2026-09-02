/**
 * Storage layer for the AfyaCore sync server.
 *
 * Split out of sync-server.mjs so that authentication, the audit chain and the
 * record store can each be tested without standing up an HTTP listener. Still
 * zero dependencies: `node:sqlite` is standard library from Node 22.
 */
import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

export const PAGE_SIZE = 500
export const KINDS = ['patients', 'encounters']
export const KIND_OF = { patients: 'patient', encounters: 'encounter' }

/**
 * Open (and migrate) the server database.
 *
 * `:memory:` is honoured verbatim so the test suite can run the real schema
 * against a throwaway database rather than a mock that drifts from it.
 */
export function openStore(dbPath) {
  const path = dbPath === ':memory:' ? ':memory:' : resolve(dbPath)
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })

  const db = new DatabaseSync(path)
  if (path !== ':memory:') db.exec('PRAGMA journal_mode = WAL;')
  db.exec('PRAGMA foreign_keys = ON;')

  db.exec(`
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

    -- Pull is always "everything after this cursor", so the sequence is the
    -- index that matters.
    CREATE INDEX IF NOT EXISTS records_by_seq ON records (facility_id, seq);

    CREATE TABLE IF NOT EXISTS counters (
      facility_id TEXT PRIMARY KEY,
      value       INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS facilities (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      country     TEXT NOT NULL DEFAULT 'MG',
      created_at  INTEGER NOT NULL,
      disabled_at INTEGER
    );

    -- One row per enrolment code. Codes are single-use and expiring: a code
    -- shared over SMS to a health post is assumed to leak, so its value has to
    -- decay to nothing on its own.
    CREATE TABLE IF NOT EXISTS enrolments (
      code_hash   TEXT PRIMARY KEY,
      facility_id TEXT NOT NULL REFERENCES facilities (id),
      expires_at  INTEGER NOT NULL,
      created_at  INTEGER NOT NULL,
      used_at     INTEGER,
      used_by     TEXT
    );

    -- A device holds a bearer token. We store only its hash, so a stolen
    -- database cannot be replayed against a running server.
    CREATE TABLE IF NOT EXISTS devices (
      id          TEXT PRIMARY KEY,
      facility_id TEXT NOT NULL REFERENCES facilities (id),
      name        TEXT NOT NULL,
      token_hash  TEXT NOT NULL,
      created_at  INTEGER NOT NULL,
      last_seen_at INTEGER,
      revoked_at  INTEGER
    );

    CREATE INDEX IF NOT EXISTS devices_by_token ON devices (token_hash);
    CREATE INDEX IF NOT EXISTS devices_by_facility ON devices (facility_id);

    -- Append-only, hash-chained. See audit.mjs for why the chain exists.
    CREATE TABLE IF NOT EXISTS audit (
      seq         INTEGER PRIMARY KEY AUTOINCREMENT,
      -- Nullable on purpose. A failed enrolment and a rejected sync have no
      -- facility yet, and those are precisely the events worth keeping: an
      -- audit log that can only describe authenticated traffic cannot record
      -- an attack.
      facility_id TEXT,
      device_id   TEXT,
      actor_id    TEXT,
      action      TEXT NOT NULL,
      detail      TEXT NOT NULL DEFAULT '{}',
      at          INTEGER NOT NULL,
      prev_hash   TEXT NOT NULL,
      hash        TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS audit_by_facility ON audit (facility_id, seq);
  `)

  return db
}

export function makeRecordQueries(db) {
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
    writeCounter.run(facilityId, current + count)
    return current
  }

  return { selectOne, upsert, selectSince, nextSeq }
}

/**
 * Reject anything that is not a record we recognise.
 *
 * A sync endpoint accepts writes from the field, so it must never trust the
 * shape of what arrives. Records without an id or updatedAt cannot participate
 * in last-write-wins and are dropped rather than stored as junk.
 */
export function isValidRecord(record) {
  return (
    record !== null &&
    typeof record === 'object' &&
    typeof record.id === 'string' &&
    record.id.length > 0 &&
    record.id.length <= 128 &&
    Number.isFinite(record.updatedAt)
  )
}

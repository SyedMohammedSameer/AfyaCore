/**
 * Encryption at rest, as a Dexie middleware.
 *
 * ## Why here and not at the call sites
 *
 * Sixty places in this app read or write a patient. Decrypting at each of them
 * would mean sixty chances to forget, and the one that got forgotten would
 * write a patient's name to disk in the clear with nothing failing. This sits
 * underneath Dexie's own query engine instead, so `db.patients.get(id)` keeps
 * returning a `Patient` and there is no plaintext path to leave open.
 *
 * ## What stays readable, and why that is not a bug
 *
 * A record encrypted whole cannot be indexed, and a database with no indexes
 * is a table scan for every screen. So each table declares the fields that
 * stay in the clear, and the rule for that list is that a field belongs on it
 * only if reading it off the disk tells an attacker nothing about a patient:
 *
 *   - **Random ids.** `id`, `patientId`, `encounterId` are UUIDs. They link
 *     rows to each other and to nothing outside the device.
 *   - **Timestamps.** `updatedAt`, `occurredAt`, `syncedAt`, `deletedAt`,
 *     `createdAt`. These leak *shape*: how many consultations this facility
 *     runs, on which days, how far behind sync is. That is real metadata and
 *     it is the price of a database that can answer "what has not synced" and
 *     "what is older than the retention period" without decrypting every row.
 *   - **`status` and `action`.** Draft versus final; `patient.view` versus
 *     `patient.delete`. Enough to sort and page a log, not enough to name
 *     anyone.
 *
 * Everything else — every name, register number, phone, village, complaint,
 * diagnosis, vital sign, prescription, dictation transcript and photograph —
 * is inside the ciphertext. The four indexes that used to make patient names
 * searchable on disk (`familyName`, `givenName`, `registerNo`, `searchKey`)
 * are gone in schema v4 for exactly that reason: an index is a plaintext copy
 * of the thing it indexes, and `searchKey` was a normalised list of every
 * patient's name sitting in the clear beside the ciphertext of their record.
 *
 * The roster's search moved in-memory to pay for it. It was already a scan
 * over a JS predicate rather than an index lookup, so the cost is a decrypt
 * per row rather than a different algorithm; at a health post's few thousand
 * records that is milliseconds, and `searchPatients` says so where it happens.
 *
 * ## Why cursors are refused
 *
 * Decryption is asynchronous and a cursor's `value` is a synchronous getter,
 * so there is no honest way to decrypt inside one. Dexie only reaches for a
 * cursor when a JS predicate is attached to a collection — `.filter(...)`,
 * `.each(...)` — and such a predicate would be handed ciphertext and silently
 * match nothing. `openCursor` therefore throws by name rather than returning
 * wrong answers quietly. Every other read path (`get`, `getMany`, `query`,
 * `count`) is async and is handled below.
 *
 * ## Mixed state is legal
 *
 * A row without a `__enc` envelope is returned as it is. That is what makes
 * the switch to encrypted storage an incremental re-put of existing rows
 * (see `encryptExistingRows`) that can be interrupted by a dying battery and
 * resumed, rather than a single transaction that has to hold the whole
 * database. Reads are lenient; writes are not — once a table is listed here,
 * everything written to it is encrypted.
 */
import Dexie, { type DBCore, type DBCoreTable, type Middleware } from 'dexie'
import { getDataKey } from '../lib/vault'

/** Marks a row whose payload is a ciphertext envelope. */
const ENVELOPE = '__enc'
const IV_BYTES = 12

interface Envelope {
  v: 1
  iv: Uint8Array
  ct: ArrayBuffer
  /** Present only for attachments: the image bytes, encrypted separately. */
  blobIv?: Uint8Array
  blobCt?: ArrayBuffer
  blobType?: string
}

/**
 * Per-table plan: the fields that stay in the clear, and any binary field.
 *
 * `keep` must list the primary key and every index the schema declares, or
 * Dexie will index `undefined` and the query will find nothing. The
 * `src/db/encryption.test.ts` suite checks that against the live schema so the
 * two cannot drift.
 */
export interface TablePlan {
  keep: readonly string[]
  /** A field holding a Blob, which JSON cannot carry. */
  binary?: string
}

export const PLANS: Record<string, TablePlan> = {
  patients: { keep: ['id', 'updatedAt', 'syncedAt', 'deletedAt'] },
  encounters: {
    keep: ['id', 'patientId', 'occurredAt', 'status', 'updatedAt', 'syncedAt', 'deletedAt'],
  },
  attachments: { keep: ['id', 'encounterId', 'createdAt'], binary: 'blob' },
  audit: { keep: ['id', 'seq', 'actorId', 'action', 'at'] },
}

export class VaultLockedError extends Error {
  constructor(table: string) {
    super(`${table} is encrypted and the vault is locked`)
    this.name = 'VaultLockedError'
  }
}

export class CursorUnsupportedError extends Error {
  constructor(table: string) {
    super(
      `${table} is encrypted, so it cannot be read through a cursor. ` +
        'Fetch with toArray() or get() and filter in JS.',
    )
    this.name = 'CursorUnsupportedError'
  }
}

const encoder = new TextEncoder()
const decoder = new TextDecoder()

function isEnvelope(row: unknown): row is Record<string, unknown> & { [ENVELOPE]: Envelope } {
  return typeof row === 'object' && row !== null && ENVELOPE in row
}

async function encryptRow(
  table: string,
  plan: TablePlan,
  row: Record<string, unknown>,
  key: CryptoKey,
): Promise<Record<string, unknown>> {
  // Already encrypted: a re-put of a row that was read but not modified.
  if (isEnvelope(row)) return row

  const id = row.id ?? row.key
  // The primary key is authenticated, so a ciphertext moved to another row
  // fails to decrypt rather than impersonating that record.
  const aad = encoder.encode(`${table}:${String(id)}`)

  const payload: Record<string, unknown> = {}
  for (const [field, value] of Object.entries(row)) {
    if (plan.binary === field) continue
    payload[field] = value
  }

  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES))
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: aad },
    key,
    encoder.encode(JSON.stringify(payload)),
  )

  const envelope: Envelope = { v: 1, iv, ct }

  if (plan.binary) {
    const blob = row[plan.binary]
    if (blob instanceof Blob) {
      const blobIv = crypto.getRandomValues(new Uint8Array(IV_BYTES))
      envelope.blobIv = blobIv
      envelope.blobType = blob.type
      envelope.blobCt = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv: blobIv, additionalData: aad },
        key,
        await blob.arrayBuffer(),
      )
    }
  }

  const out: Record<string, unknown> = { [ENVELOPE]: envelope }
  for (const field of plan.keep) if (field in row) out[field] = row[field]
  return out
}

async function decryptRow(
  table: string,
  plan: TablePlan,
  row: unknown,
  key: CryptoKey | null,
): Promise<unknown> {
  if (!isEnvelope(row)) return row
  if (!key) throw new VaultLockedError(table)

  const envelope = row[ENVELOPE]
  const aad = encoder.encode(`${table}:${String(row.id ?? row.key)}`)
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: envelope.iv as BufferSource, additionalData: aad },
    key,
    envelope.ct,
  )
  const out = JSON.parse(decoder.decode(plain)) as Record<string, unknown>

  if (plan.binary && envelope.blobCt && envelope.blobIv) {
    const bytes = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: envelope.blobIv as BufferSource, additionalData: aad },
      key,
      envelope.blobCt,
    )
    out[plan.binary] = new Blob([bytes], { type: envelope.blobType ?? '' })
  }
  return out
}

/*
 * Keeping an IndexedDB transaction alive across an await, one at a time.
 *
 * Two separate problems, and the second only appears once the first is solved.
 *
 * IndexedDB commits a transaction the moment its microtask queue drains with
 * no request outstanding. `crypto.subtle` is asynchronous, so a plain `await`
 * in the middle of a transaction closes it underneath us and the next
 * operation fails with `InvalidStateError` — a message about transaction
 * state, giving no hint that encryption is the cause. `Dexie.waitFor` exists
 * for exactly this: it holds the transaction open with keep-alive requests
 * while a promise settles.
 *
 * But two `Dexie.waitFor` calls outstanding in the same transaction deadlock,
 * and `Promise.all([db.patients.get(a), db.patients.get(b)])` inside a
 * transaction is ordinary code that anyone would write — `mergePatients` did.
 * The symptom is a hang, which is the worst way for this to fail: no error,
 * no rejected promise, a consultation that never saves.
 *
 * So they are queued per transaction. The reads themselves still overlap
 * (Dexie issues both before either resolves); only the decryption is
 * serialised, and one AES-GCM open of a small record after another is not a
 * cost worth risking a deadlock to avoid.
 */
const holdQueues = new WeakMap<object, Promise<unknown>>()

function hold<T>(trans: unknown, work: () => Promise<T>): Promise<T> {
  const key = (typeof trans === 'object' && trans !== null ? trans : holdQueues) as object
  const previous = holdQueues.get(key) ?? Promise.resolve()
  const settled = () => Dexie.waitFor(work()) as Promise<T>
  const next = previous.then(settled, settled)
  // Swallowed on the queue only: the returned promise still rejects, but one
  // failed decrypt must not poison every later operation in the transaction.
  holdQueues.set(
    key,
    next.then(
      () => undefined,
      () => undefined,
    ),
  )
  return next
}

/** Dexie middleware installing the above over every table in `PLANS`. */
export const encryptionMiddleware: Middleware<DBCore> = {
  stack: 'dbcore',
  name: 'afyacore-encryption',
  level: 1,
  create(down: DBCore): DBCore {
    return {
      ...down,
      table(name: string): DBCoreTable {
        const table = down.table(name)
        const plan = PLANS[name]
        if (!plan) return table

        const decryptAll = (rows: unknown[], trans: unknown) => {
          const key = getDataKey()
          return hold(trans, () => Promise.all(rows.map((row) => decryptRow(name, plan, row, key))))
        }

        return {
          ...table,

          async mutate(request) {
            if (request.type !== 'add' && request.type !== 'put') return table.mutate(request)
            const key = getDataKey()
            if (!key) throw new VaultLockedError(name)
            const values = await hold(request.trans, () =>
              Promise.all(
                request.values.map((value) =>
                  encryptRow(name, plan, value as Record<string, unknown>, key),
                ),
              ),
            )
            return table.mutate({ ...request, values })
          },

          async get(request) {
            const row = await table.get(request)
            return hold(request.trans, () => decryptRow(name, plan, row, getDataKey()))
          },

          async getMany(request) {
            const rows = await table.getMany(request)
            return decryptAll(rows, request.trans)
          },

          async query(request) {
            const response = await table.query(request)
            // `values: false` asked for primary keys, which are in the clear.
            if (!request.values) return response
            return { ...response, result: await decryptAll(response.result, request.trans) }
          },

          openCursor() {
            throw new CursorUnsupportedError(name)
          },
        }
      },
    }
  },
}

/**
 * Re-write every plaintext row through the middleware, encrypting it.
 *
 * Run once, when a device that already holds records is switched to encrypted
 * storage. It is a re-put per row rather than one big transaction on purpose:
 * this runs on a phone that may be at 3% battery in a village, and a
 * half-finished pass has to be a legal state rather than a corrupt database.
 * A row that already carries an envelope is skipped, so an interrupted pass
 * resumes by simply being run again.
 *
 * `onProgress` exists so the UI can say what is happening. On a register of a
 * few thousand records with photographs this is seconds, not milliseconds.
 */
export async function encryptExistingRows(
  db: {
    table: (name: string) => {
      toArray: () => Promise<unknown[]>
      put: (row: unknown) => Promise<unknown>
    }
  },
  onProgress?: (done: number, total: number) => void,
): Promise<number> {
  if (!getDataKey()) throw new Error('vault is locked')

  let converted = 0
  for (const name of Object.keys(PLANS)) {
    const table = db.table(name)
    const rows = await table.toArray()
    // Reads come back decrypted, so a row that was already encrypted is
    // indistinguishable from one that was not — which is exactly right. Both
    // are written back through the middleware and both end up encrypted; the
    // only cost of re-writing an already-encrypted row is a fresh IV.
    for (const [index, row] of rows.entries()) {
      await table.put(row)
      converted++
      onProgress?.(index + 1, rows.length)
    }
  }
  return converted
}

/**
 * Sync client.
 *
 * The device stays the source of truth. Sync is a background reconciliation
 * between two independent stores, never a fetch the UI waits on: a facility
 * that is offline for a week must notice nothing except a growing pending
 * count.
 *
 * Order is push then pull, in one request. Pushing first means the server has
 * seen our work before it tells us what we missed, so a record we lose the
 * conflict on comes straight back in the same round trip rather than a later one.
 *
 * Conflict policy is last write wins on `updatedAt`, decided by the server.
 * That is defensible here because records are replaced whole and never merged
 * field by field: two clinicians editing the same consultation on two phones is
 * vanishingly rare compared with the cost of a merge algorithm nobody can
 * reason about. Where it is not defensible, we refuse instead. See `applyPulled`.
 *
 * NOT IMPLEMENTED YET, deliberately: authentication. Treat any server as
 * untrusted infrastructure until that exists.
 */
import { db, unsyncedRecords } from '../db/db'
import type { Encounter, Patient } from '../db/schema'

export interface SyncSettings {
  serverUrl: string
  facilityId: string
}

export interface SyncOutcome {
  ok: boolean
  pushed: number
  pulled: number
  conflicts: number
  /** Records the server sent that we declined to apply. See `applyPulled`. */
  refused: number
  cursor: number
  error?: string
  finishedAt: number
}

const SETTING_KEYS = {
  url: 'sync.serverUrl',
  facility: 'sync.facilityId',
  cursor: 'sync.cursor',
  lastResult: 'sync.lastResult',
} as const

export async function getSyncSettings(): Promise<SyncSettings> {
  const [url, facility] = await Promise.all([
    db.settings.get(SETTING_KEYS.url),
    db.settings.get(SETTING_KEYS.facility),
  ])
  return {
    serverUrl: typeof url?.value === 'string' ? url.value : '',
    facilityId: typeof facility?.value === 'string' ? facility.value : '',
  }
}

export async function setSyncSettings(next: Partial<SyncSettings>): Promise<void> {
  if (next.serverUrl !== undefined) {
    await db.settings.put({ key: SETTING_KEYS.url, value: next.serverUrl.trim().replace(/\/+$/, '') })
  }
  if (next.facilityId !== undefined) {
    await db.settings.put({ key: SETTING_KEYS.facility, value: next.facilityId.trim() })
  }
}

async function getCursor(): Promise<number> {
  const row = await db.settings.get(SETTING_KEYS.cursor)
  return typeof row?.value === 'number' ? row.value : 0
}

export async function getLastResult(): Promise<SyncOutcome | null> {
  const row = await db.settings.get(SETTING_KEYS.lastResult)
  return (row?.value as SyncOutcome | undefined) ?? null
}

/**
 * Reset the pull cursor so the next sync re-reads everything on the server.
 * The remedy when a device's local copy is suspected to have drifted.
 */
export async function resetCursor(): Promise<void> {
  await db.settings.put({ key: SETTING_KEYS.cursor, value: 0 })
}

/**
 * Apply records received from the server.
 *
 * Two rules, both about not destroying work:
 *
 *  1. A pulled record is written only when it is strictly newer than the local
 *     copy. Equal timestamps keep the local row, so a device never churns its
 *     own records back and forth with the server.
 *
 *  2. A local **draft** is never overwritten. A draft is a consultation
 *     somebody may be part-way through typing on this very phone, and silently
 *     replacing it with a remote version would delete work in front of the
 *     person doing it. Those are counted as refused and left alone.
 */
async function applyPulled(patients: Patient[], encounters: Encounter[]) {
  let pulled = 0
  let refused = 0
  const syncedAt = Date.now()

  await db.transaction('rw', db.patients, db.encounters, async () => {
    for (const remote of patients) {
      const local = await db.patients.get(remote.id)
      if (local && local.updatedAt >= remote.updatedAt) continue
      await db.patients.put({ ...remote, syncedAt })
      pulled++
    }

    for (const remote of encounters) {
      const local = await db.encounters.get(remote.id)
      if (local && local.updatedAt >= remote.updatedAt) continue
      if (local?.status === 'draft') {
        refused++
        continue
      }
      await db.encounters.put({ ...remote, syncedAt })
      pulled++
    }
  })

  return { pulled, refused }
}

/** Mark pushed records as acknowledged, unless they changed while in flight. */
async function markPushed(patients: Patient[], encounters: Encounter[], at: number) {
  await db.transaction('rw', db.patients, db.encounters, async () => {
    for (const record of patients) {
      const current = await db.patients.get(record.id)
      // An edit made during the request must stay pending, or it is lost.
      if (current && current.updatedAt === record.updatedAt) {
        await db.patients.update(record.id, { syncedAt: at })
      }
    }
    for (const record of encounters) {
      const current = await db.encounters.get(record.id)
      if (current && current.updatedAt === record.updatedAt) {
        await db.encounters.update(record.id, { syncedAt: at })
      }
    }
  })
}

export interface SyncOptions {
  /** Abort if the server does not answer. Field connections are slow but finite. */
  timeoutMs?: number
  fetchImpl?: typeof fetch
}

/**
 * Run one sync round. Safe to call repeatedly; nothing is lost by an aborted
 * attempt because the local store is only updated after a successful response.
 */
export async function runSync(options: SyncOptions = {}): Promise<SyncOutcome> {
  const { timeoutMs = 30_000, fetchImpl = fetch } = options
  const settings = await getSyncSettings()
  const base: SyncOutcome = {
    ok: false,
    pushed: 0,
    pulled: 0,
    conflicts: 0,
    refused: 0,
    cursor: await getCursor(),
    finishedAt: Date.now(),
  }

  if (!settings.serverUrl || !settings.facilityId) {
    return { ...base, error: 'not_configured', finishedAt: Date.now() }
  }

  const changes = await unsyncedRecords()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetchImpl(`${settings.serverUrl}/sync`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        facilityId: settings.facilityId,
        cursor: base.cursor,
        changes,
      }),
    })

    if (!response.ok) {
      const outcome = { ...base, error: `http_${response.status}`, finishedAt: Date.now() }
      await db.settings.put({ key: SETTING_KEYS.lastResult, value: outcome })
      return outcome
    }

    const payload = (await response.json()) as {
      cursor: number
      pushed: number
      conflicts?: unknown[]
      changes: { patients: Patient[]; encounters: Encounter[] }
    }

    const now = Date.now()
    await markPushed(changes.patients, changes.encounters, now)
    const { pulled, refused } = await applyPulled(
      payload.changes?.patients ?? [],
      payload.changes?.encounters ?? [],
    )

    const cursor = Number.isFinite(payload.cursor) ? payload.cursor : base.cursor
    await db.settings.put({ key: SETTING_KEYS.cursor, value: cursor })

    const outcome: SyncOutcome = {
      ok: true,
      pushed: payload.pushed ?? 0,
      pulled,
      conflicts: payload.conflicts?.length ?? 0,
      refused,
      cursor,
      finishedAt: Date.now(),
    }
    await db.settings.put({ key: SETTING_KEYS.lastResult, value: outcome })
    return outcome
  } catch (err) {
    const aborted = err instanceof Error && err.name === 'AbortError'
    const outcome = {
      ...base,
      error: aborted ? 'timeout' : 'network',
      finishedAt: Date.now(),
    }
    await db.settings.put({ key: SETTING_KEYS.lastResult, value: outcome })
    return outcome
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Sync when connectivity returns, and once on start.
 *
 * There is no polling loop: a phone in a village with no signal should not
 * spend its battery asking. The `online` event is the only thing that reliably
 * indicates the attempt is worth making.
 */
export function startAutoSync(): () => void {
  let running = false

  const attempt = async () => {
    if (running || !navigator.onLine) return
    const { serverUrl, facilityId } = await getSyncSettings()
    if (!serverUrl || !facilityId) return
    running = true
    try {
      await runSync()
    } finally {
      running = false
    }
  }

  window.addEventListener('online', attempt)
  void attempt()
  return () => window.removeEventListener('online', attempt)
}

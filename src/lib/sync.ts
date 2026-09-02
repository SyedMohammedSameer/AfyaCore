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
 * A device authenticates with a bearer token obtained once, by enrolling with a
 * single-use code an administrator reads out. The facility a device belongs to
 * is a property of that token, not something the client asserts: a typed
 * facility id was previously the only thing standing between a stranger and a
 * facility's entire record set.
 */
import { db, unsyncedRecords } from '../db/db'
import type { Encounter, Patient } from '../db/schema'

export interface SyncSettings {
  serverUrl: string
  /** Set by enrolment, never typed. Empty until this device is enrolled. */
  facilityId: string
  /** Bearer token issued at enrolment. Empty until this device is enrolled. */
  token: string
  deviceId: string
}

/** A device can sync only once it holds a token for a configured server. */
export function isEnrolled(settings: SyncSettings): boolean {
  return Boolean(settings.serverUrl && settings.token)
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
  token: 'sync.token',
  deviceId: 'sync.deviceId',
  cursor: 'sync.cursor',
  lastResult: 'sync.lastResult',
} as const

const asString = (value: unknown) => (typeof value === 'string' ? value : '')

export async function getSyncSettings(): Promise<SyncSettings> {
  const [url, facility, token, deviceId] = await Promise.all([
    db.settings.get(SETTING_KEYS.url),
    db.settings.get(SETTING_KEYS.facility),
    db.settings.get(SETTING_KEYS.token),
    db.settings.get(SETTING_KEYS.deviceId),
  ])
  return {
    serverUrl: asString(url?.value),
    facilityId: asString(facility?.value),
    token: asString(token?.value),
    deviceId: asString(deviceId?.value),
  }
}

/**
 * The server URL is the only sync setting a person may type.
 *
 * Narrower than `Partial<SyncSettings>` on purpose: facility, token and device
 * id are issued by enrolment, and a signature that still accepted them would
 * let a caller believe it had set a facility when it had not.
 */
export async function setSyncSettings(next: { serverUrl?: string }): Promise<void> {
  if (next.serverUrl !== undefined) {
    await db.settings.put({ key: SETTING_KEYS.url, value: next.serverUrl.trim().replace(/\/+$/, '') })
  }
}

export interface EnrolmentResult {
  ok: boolean
  facilityId?: string
  error?: 'not_configured' | 'invalid_code' | 'rate_limited' | 'network' | 'timeout' | string
}

/**
 * Exchange a single-use code for this device's token.
 *
 * Run once per phone, in front of whoever is setting it up. The code is read
 * out by an administrator, is valid for a day, and cannot be used twice, so a
 * code overheard after the fact is worth nothing.
 */
export async function enrolDevice(
  code: string,
  deviceName: string,
  options: SyncOptions = {},
): Promise<EnrolmentResult> {
  const { timeoutMs = 30_000, fetchImpl = fetch } = options
  const { serverUrl } = await getSyncSettings()
  if (!serverUrl) return { ok: false, error: 'not_configured' }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetchImpl(`${serverUrl}/enrol`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({ code, deviceName }),
    })
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { error?: string }
      return { ok: false, error: body.error ?? `http_${response.status}` }
    }
    const payload = (await response.json()) as {
      token: string
      deviceId: string
      facilityId: string
    }
    await db.settings.bulkPut([
      { key: SETTING_KEYS.token, value: payload.token },
      { key: SETTING_KEYS.deviceId, value: payload.deviceId },
      { key: SETTING_KEYS.facility, value: payload.facilityId },
      // A newly enrolled device has seen nothing, so it pulls from the start.
      { key: SETTING_KEYS.cursor, value: 0 },
    ])
    return { ok: true, facilityId: payload.facilityId }
  } catch (err) {
    const aborted = err instanceof Error && err.name === 'AbortError'
    return { ok: false, error: aborted ? 'timeout' : 'network' }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Forget this device's credentials.
 *
 * Local records are deliberately left alone: un-enrolling is what someone does
 * when a phone changes hands or moves facility, and it must not be a way to
 * destroy a clinic's consultations by accident. Revoking the token server-side
 * is a separate administrative act (`cli.mjs device:revoke`), because a phone
 * that has been stolen cannot be asked to un-enrol itself.
 */
export async function unenrolDevice(): Promise<void> {
  await db.settings.bulkPut([
    { key: SETTING_KEYS.token, value: '' },
    { key: SETTING_KEYS.deviceId, value: '' },
    { key: SETTING_KEYS.facility, value: '' },
    { key: SETTING_KEYS.cursor, value: 0 },
  ])
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
  /**
   * The clinician this sync is attributed to in the server's audit log.
   *
   * Carried as an opaque local account id, never a name: the audit trail has to
   * answer "which account moved these records" without itself becoming a
   * directory of who works at the facility.
   */
  actorId?: string
}

/**
 * Run one sync round. Safe to call repeatedly; nothing is lost by an aborted
 * attempt because the local store is only updated after a successful response.
 */
export async function runSync(options: SyncOptions = {}): Promise<SyncOutcome> {
  const { timeoutMs = 30_000, fetchImpl = fetch, actorId } = options
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

  if (!isEnrolled(settings)) {
    return { ...base, error: 'not_configured', finishedAt: Date.now() }
  }

  const changes = await unsyncedRecords()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetchImpl(`${settings.serverUrl}/sync`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${settings.token}`,
      },
      signal: controller.signal,
      body: JSON.stringify({
        cursor: base.cursor,
        actorId,
        changes,
      }),
    })

    if (!response.ok) {
      // 401 means the token is gone: revoked by an administrator, or the
      // server's database was rebuilt. Either way this device is no longer
      // enrolled, and saying so is more useful than repeating "http_401".
      const outcome = {
        ...base,
        error: response.status === 401 ? 'unauthorised' : `http_${response.status}`,
        finishedAt: Date.now(),
      }
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
    if (!isEnrolled(await getSyncSettings())) return
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

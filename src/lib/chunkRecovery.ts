/**
 * Getting back on your feet when a deploy removes the chunk you are holding.
 *
 * ## The failure
 *
 * Every route in this app is a lazy `import()`, and every built file carries a
 * content hash. A deploy replaces those hashes. A browser that still holds the
 * previous `index.html` — from the service worker's precache, which serves the
 * shell cache-first, or from an open tab — therefore asks for chunk names the
 * server has just deleted, and the first navigation after a deploy dies:
 *
 *   Failed to fetch dynamically imported module: .../assets/NewPatient-<hash>.js
 *
 * On Netlify it arrived wearing a disguise. A single `/*` catch-all answered
 * the missing file with `index.html` and HTTP 200, so the browser reported a
 * MIME type error rather than a missing file. `netlify.toml` now returns a
 * real 404 for asset paths, which makes the failure legible; this module makes
 * it survivable.
 *
 * ## Why a plain reload is not the fix
 *
 * The stale shell is usually being served *by the service worker*, from its
 * precache, cache-first. Reloading fetches the same stale `index.html`, which
 * names the same dead hashes, which fails again. That is a loop, not a
 * recovery. So the precache has to go first, and the worker with it: the next
 * load then reaches the network, gets the current shell and registers a fresh
 * worker.
 *
 * Patient records are in IndexedDB and are not touched. The only thing thrown
 * away is a cache of files the server can serve again.
 *
 * ## Why it only ever happens once
 *
 * A recovery that can retry is a reload loop, and a reload loop on a clinical
 * app is worse than an error message: the clinician cannot even read what went
 * wrong. The attempt is recorded in `sessionStorage` before the reload, so a
 * second failure in the same tab falls through to the error boundary instead.
 *
 * Where `sessionStorage` cannot be written at all — private mode in some
 * browsers, storage disabled — this declines to reload rather than reloading
 * without a guard. Failing visibly beats spinning forever.
 */

const ATTEMPT_KEY = 'afyacore.chunkRecovery'

/** Everything this touches, injected so the whole path can be tested. */
export interface RecoveryEnv {
  storage: Storage | null
  caches: CacheStorage | null
  serviceWorker: ServiceWorkerContainer | null
  reload: () => void
  now?: () => number
}

function browserEnv(): RecoveryEnv {
  return {
    // Accessing these can throw outright rather than return null (a sandboxed
    // iframe, storage blocked by policy), so each is probed rather than read.
    storage: safely(() => window.sessionStorage),
    caches: safely(() => window.caches),
    serviceWorker: safely(() => navigator.serviceWorker),
    reload: () => window.location.reload(),
  }
}

function safely<T>(read: () => T): T | null {
  try {
    return read() ?? null
  } catch {
    return null
  }
}

/**
 * True when this error is a module that would not load.
 *
 * Matched on the message because the platform gives us nothing better: a
 * failed dynamic import rejects with a plain `TypeError` whose text differs
 * per engine. Deliberately broad — the cost of a false positive is one extra
 * reload on an error that was going to be fatal anyway, and the cost of a
 * false negative is a white screen after every deploy.
 */
export function isChunkLoadError(error: unknown): boolean {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
  return (
    /dynamically imported module/i.test(message) ||
    /Importing a module script failed/i.test(message) || // Safari
    /error loading dynamically imported module/i.test(message) || // Firefox
    /ChunkLoadError/i.test(message) ||
    /Loading chunk \d+ failed/i.test(message) ||
    // Chrome, when the SPA fallback hands back HTML for a .js request.
    /Expected a JavaScript(-or-Wasm)? module script/i.test(message)
  )
}

/**
 * Clear the stale shell and reload, at most once per tab.
 *
 * Returns true when a reload has been started, in which case the caller should
 * stop rather than surfacing an error the user will never see. Returns false
 * when it declined, and the caller should let the error through.
 */
export async function recoverFromStaleChunk(
  env: RecoveryEnv = browserEnv(),
): Promise<boolean> {
  if (!env.storage) return false
  if (env.storage.getItem(ATTEMPT_KEY)) return false

  try {
    env.storage.setItem(ATTEMPT_KEY, String((env.now ?? Date.now)()))
  } catch {
    // Quota or a storage policy. Without a durable marker the reload could
    // repeat forever, so decline.
    return false
  }

  // Order matters only in that the reload comes last. Both cleanups are
  // best-effort: a browser that refuses either still benefits from the reload,
  // because the shell may equally have been held by the HTTP cache, which the
  // `must-revalidate` header on index.html now prevents.
  await dropPrecaches(env.caches)
  await unregisterWorkers(env.serviceWorker)

  env.reload()
  return true
}

async function dropPrecaches(caches: CacheStorage | null): Promise<void> {
  if (!caches) return
  try {
    const names = await caches.keys()
    await Promise.all(
      names
        // Only the shell. The OCR pack, the models and their runtime are
        // hundreds of megabytes a facility downloaded once over a connection
        // it may not have again, and none of them is versioned by the deploy.
        .filter((name) => name.startsWith('workbox-precache'))
        .map((name) => caches.delete(name)),
    )
  } catch {
    // Nothing to do about it; the reload is still worth trying.
  }
}

async function unregisterWorkers(container: ServiceWorkerContainer | null): Promise<void> {
  if (!container) return
  try {
    const registrations = await container.getRegistrations()
    await Promise.all(registrations.map((registration) => registration.unregister()))
  } catch {
    // As above.
  }
}

/**
 * Forget that a recovery happened, so a future deploy can recover too.
 *
 * Called once a chunk has actually loaded. Without this the guard would be
 * spent for the life of the tab, and the second deploy of the day would show a
 * white screen to someone whose first recovery had worked perfectly.
 */
export function markChunkLoadSucceeded(env: Pick<RecoveryEnv, 'storage'> = browserEnv()): void {
  try {
    env.storage?.removeItem(ATTEMPT_KEY)
  } catch {
    // Never worth failing a working page over.
  }
}

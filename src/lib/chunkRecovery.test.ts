/**
 * The recovery path only ever runs when something has already broken, which
 * means it is never exercised in normal use and has to be right the first
 * time it fires. It is also the one piece of code whose failure mode is an
 * infinite reload loop, so the guard gets more attention than the happy path.
 */
import { describe, expect, it, vi } from 'vitest'
import {
  isChunkLoadError,
  markChunkLoadSucceeded,
  recoverFromStaleChunk,
  type RecoveryEnv,
} from './chunkRecovery'

/** A `sessionStorage` that works, in memory. */
function memoryStorage(): Storage {
  const map = new Map<string, string>()
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
    clear: () => map.clear(),
    key: (i) => [...map.keys()][i] ?? null,
    get length() {
      return map.size
    },
  } as Storage
}

function env(overrides: Partial<RecoveryEnv> = {}) {
  const deleted: string[] = []
  const unregistered: string[] = []
  const reload = vi.fn()
  const base: RecoveryEnv = {
    storage: memoryStorage(),
    caches: {
      keys: async () => [
        'workbox-precache-v2-https://afya-core.netlify.app/',
        'afyacore-models',
        'afyacore-ocr',
        'afyacore-model-manifests',
      ],
      delete: async (name: string) => {
        deleted.push(name)
        return true
      },
    } as unknown as CacheStorage,
    serviceWorker: {
      getRegistrations: async () => [
        { unregister: async () => void unregistered.push('sw') } as unknown as ServiceWorkerRegistration,
      ],
    } as unknown as ServiceWorkerContainer,
    reload,
    now: () => 1_700_000_000_000,
    ...overrides,
  }
  return { base, deleted, unregistered, reload }
}

describe('isChunkLoadError', () => {
  it('recognises what each engine says about a module that would not load', () => {
    // Chrome
    expect(
      isChunkLoadError(
        new TypeError(
          'Failed to fetch dynamically imported module: https://afya-core.netlify.app/assets/NewPatient-Drerh_5G.js',
        ),
      ),
    ).toBe(true)
    // Safari
    expect(isChunkLoadError(new TypeError('Importing a module script failed.'))).toBe(true)
    // Firefox
    expect(
      isChunkLoadError(new TypeError('error loading dynamically imported module')),
    ).toBe(true)
    // Webpack-era name, still thrown by some tooling.
    expect(isChunkLoadError(Object.assign(new Error('boom'), { name: 'ChunkLoadError' }))).toBe(true)
  })

  it('recognises the SPA fallback disguise', () => {
    // The exact production symptom: a catch-all redirect answered a .js
    // request with index.html, so the browser complained about MIME type
    // rather than about a missing file.
    expect(
      isChunkLoadError(
        new TypeError(
          'Failed to load module script: Expected a JavaScript-or-Wasm module script but the server responded with a MIME type of "text/html".',
        ),
      ),
    ).toBe(true)
  })

  it('leaves ordinary application errors alone', () => {
    // A false positive costs a reload on an error that was fatal anyway; this
    // is about not reloading the app on a bug a clinician could have worked
    // around, and losing whatever they were typing.
    expect(isChunkLoadError(new TypeError('Cannot read properties of undefined'))).toBe(false)
    expect(isChunkLoadError(new Error('patient not found'))).toBe(false)
    expect(isChunkLoadError('some string')).toBe(false)
    expect(isChunkLoadError(null)).toBe(false)
  })
})

describe('recoverFromStaleChunk', () => {
  it('clears the shell cache, unregisters the worker and reloads', async () => {
    const { base, deleted, unregistered, reload } = env()
    expect(await recoverFromStaleChunk(base)).toBe(true)
    expect(deleted).toEqual(['workbox-precache-v2-https://afya-core.netlify.app/'])
    expect(unregistered).toEqual(['sw'])
    expect(reload).toHaveBeenCalledOnce()
  })

  it('never deletes the model, OCR or runtime caches', async () => {
    // The whole point of those is that a facility downloaded 80 MB once, over
    // a connection it may not have again. A deploy renaming a JavaScript chunk
    // is not a reason to make them do it twice.
    const { base, deleted } = env()
    await recoverFromStaleChunk(base)
    expect(deleted).not.toContain('afyacore-models')
    expect(deleted).not.toContain('afyacore-ocr')
    expect(deleted).not.toContain('afyacore-model-manifests')
  })

  it('refuses a second attempt in the same tab', async () => {
    // The failure this prevents is worse than the one it recovers from: a
    // reload loop leaves the clinician unable to read any error at all.
    const { base, reload } = env()
    expect(await recoverFromStaleChunk(base)).toBe(true)
    expect(await recoverFromStaleChunk(base)).toBe(false)
    expect(await recoverFromStaleChunk(base)).toBe(false)
    expect(reload).toHaveBeenCalledOnce()
  })

  it('can recover again once a chunk has loaded', async () => {
    // Two deploys in a day is normal. A guard that never resets would show the
    // second one a white screen.
    const { base, reload } = env()
    await recoverFromStaleChunk(base)
    markChunkLoadSucceeded(base)
    expect(await recoverFromStaleChunk(base)).toBe(true)
    expect(reload).toHaveBeenCalledTimes(2)
  })

  it('declines when there is nowhere to record the attempt', async () => {
    // Without a durable marker the reload cannot be limited to one, so the
    // safe answer is to let the error surface.
    const { base, reload } = env({ storage: null })
    expect(await recoverFromStaleChunk(base)).toBe(false)
    expect(reload).not.toHaveBeenCalled()
  })

  it('declines when storage exists but refuses the write', async () => {
    const storage = memoryStorage()
    vi.spyOn(storage, 'setItem').mockImplementation(() => {
      throw new DOMException('QuotaExceededError')
    })
    const { base, reload } = env({ storage })
    expect(await recoverFromStaleChunk(base)).toBe(false)
    expect(reload).not.toHaveBeenCalled()
  })

  it('still reloads when caches are unavailable', async () => {
    // The shell may have been held by the HTTP cache rather than the service
    // worker, and the reload is what fixes that.
    const { base, reload } = env({ caches: null, serviceWorker: null })
    expect(await recoverFromStaleChunk(base)).toBe(true)
    expect(reload).toHaveBeenCalledOnce()
  })

  it('still reloads when clearing the cache throws', async () => {
    const { base, reload } = env({
      caches: {
        keys: async () => {
          throw new DOMException('SecurityError')
        },
        delete: async () => true,
      } as unknown as CacheStorage,
    })
    expect(await recoverFromStaleChunk(base)).toBe(true)
    expect(reload).toHaveBeenCalledOnce()
  })

  it('still reloads when unregistering the worker throws', async () => {
    const { base, reload } = env({
      serviceWorker: {
        getRegistrations: async () => {
          throw new DOMException('SecurityError')
        },
      } as unknown as ServiceWorkerContainer,
    })
    expect(await recoverFromStaleChunk(base)).toBe(true)
    expect(reload).toHaveBeenCalledOnce()
  })

  it('reloads only after the caches are cleared', async () => {
    // Reloading first would race: the old worker could still answer the
    // navigation from its precache and hand back the same dead shell.
    const order: string[] = []
    const { base } = env({
      caches: {
        keys: async () => ['workbox-precache-v2-x'],
        delete: async () => {
          order.push('cache-cleared')
          return true
        },
      } as unknown as CacheStorage,
      serviceWorker: {
        getRegistrations: async () => [
          {
            unregister: async () => {
              order.push('sw-unregistered')
              return true
            },
          } as unknown as ServiceWorkerRegistration,
        ],
      } as unknown as ServiceWorkerContainer,
      reload: () => order.push('reload'),
    })
    await recoverFromStaleChunk(base)
    expect(order).toEqual(['cache-cleared', 'sw-unregistered', 'reload'])
  })
})

describe('markChunkLoadSucceeded', () => {
  it('survives storage being unavailable', () => {
    expect(() => markChunkLoadSucceeded({ storage: null })).not.toThrow()
  })
})

import { readFile } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { defineConfig, type PluginOption } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// AfyaCore ships to Android phones over slow, metered connections. Every byte in
// the initial shell is a byte a CHU nurse waits for on 2G, so heavy work (ASR
// models, OCR) is deliberately kept out of the bundle and fetched on demand.
/**
 * Keep onnxruntime-web's WebAssembly cores out of the build.
 *
 * onnxruntime-web locates its core with `new URL("ort-wasm-....wasm",
 * import.meta.url)`. Vite treats that as an asset reference, resolves it, and
 * emits the file: 23.5 MB of `asyncify` core landing in `dist/` on every build.
 *
 * Nothing loads it from `assets/`. `src/lib/openmed.ts` and the speech worker
 * set `wasmPaths = '/ort/'`, and the runtime resolves its core by *filename*
 * against that prefix, where `npm run vendor:whisper` or `vendor:openmed` has
 * placed it (the asyncify core this bundle asks for, and the plain one). So
 * the emitted asset is pure deployment weight: a second copy of a 23 MB file
 * under a hashed name that no client ever requests.
 *
 * Rewriting the expression to the bare filename removes the asset reference
 * while leaving the runtime's own resolution untouched, which is the behaviour
 * we want anyway.
 */
function excludeOnnxWasm(): PluginOption {
  const ORT_URL = /new URL\((["'])(ort-wasm[\w.-]*\.wasm)\1\s*,\s*import\.meta\.url\)/g

  return {
    name: 'afyacore:exclude-onnx-wasm',
    enforce: 'pre',
    transform(code, id) {
      if (!id.includes('onnxruntime-web') || !ORT_URL.test(code)) return null
      ORT_URL.lastIndex = 0
      return { code: code.replace(ORT_URL, (_m, q, file) => `${q}${file}${q}`), map: null }
    },
  }
}

/**
 * Serve the vendored ONNX Runtime straight from `public/` during development.
 *
 * ONNX Runtime locates its WebAssembly core at runtime with a bare
 * `import('/ort/ort-wasm-simd-threaded.asyncify.mjs')`. In a production build
 * that is an ordinary request for a static file and it works. The dev server
 * routes it through Vite's module pipeline instead, which resolves it into
 * `public/`, refuses on principle, and answers with:
 *
 *   Failed to load url /ort/ort-wasm-simd-threaded.asyncify.mjs ... This file
 *   is in /public and will be copied as-is during build ... and therefore
 *   should not be imported from source code.
 *
 * So every on-device model failed on `npm run dev` and worked on
 * `npm run preview`, which is a miserable thing to discover by pressing the
 * only button on the Evidence Studio during a rehearsal. It was written down
 * as a known limitation; it is a five-line middleware.
 *
 * Registered in the body of `configureServer` rather than in a returned
 * function, which is what puts it ahead of Vite's own middlewares, so the
 * request is answered before anything tries to transform it. Dev only: the
 * build already copies these files verbatim.
 */
function serveVendoredRuntime(): PluginOption {
  const TYPES: Record<string, string> = {
    '.mjs': 'text/javascript',
    '.js': 'text/javascript',
    '.wasm': 'application/wasm',
  }

  return {
    name: 'afyacore:serve-vendored-runtime',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url?.split('?')[0]
        if (!url?.startsWith('/ort/')) return next()
        const file = join(process.cwd(), 'public', url)
        // Never serve outside public/ort, whatever the request path claims.
        if (!file.startsWith(join(process.cwd(), 'public', 'ort'))) return next()
        readFile(file).then(
          (body) => {
            res.setHeader('Content-Type', TYPES[extname(file)] ?? 'application/octet-stream')
            res.end(body)
          },
          // Not vendored on this machine. Falling through gives the app the
          // 404 it already knows how to report.
          () => next(),
        )
      })
    },
  }
}

export default defineConfig({
  plugins: [
    excludeOnnxWasm(),
    serveVendoredRuntime(),
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'AfyaCore',
        short_name: 'AfyaCore',
        description: 'Dossier patient hors ligne / Rakitra marary tsy mila aterineto',
        lang: 'fr',
        theme_color: '#0a6b52',
        background_color: '#f7f5f0',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        // The OCR runtime is ~7 MB. Precaching it would defeat the whole point
        // of a small install, so it is fetched on demand and cached below.
        // transformers.js is ~148 kB gzip and is only ever loaded by a facility
        // that installed the optional PII model. Precaching it would put it in
        // every install, including the ones that never use it, which is exactly
        // the cost this app is built to avoid.
        // The speech worker carries its own copy of transformers.js (a worker
        // is bundled as its own graph), so it is excluded for the same reason
        // and cached on first use by the rule below. 545 kB was being
        // precached on every install for a feature most installs never load.
        globIgnores: ['**/models/**', '**/ocr/**', '**/transformers*', '**/ort-*', '**/asr.worker*'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/ocr\//, /^\/models\//],
        cleanupOutdatedCaches: true,
        // Raise the per-file precache ceiling for the app's own chunks only.
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
        runtimeCaching: [
          {
            // Once a facility downloads the OCR pack it must keep working
            // offline forever, so this is CacheFirst with no expiry.
            urlPattern: ({ url }: { url: URL }) => url.pathname.startsWith('/ocr/'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'afyacore-ocr',
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // The sample dictations, a few hundred kB of synthetic speech used
            // for demonstrations. Not precached, for the same reason as the
            // models; kept once fetched so a booth demo survives the hall's
            // wifi going down between the first play and the second.
            urlPattern: ({ url }: { url: URL }) => url.pathname.startsWith('/samples/'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'afyacore-samples',
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            /*
             * Model *manifests* revalidate. Everything else about a model is
             * immutable and enormous; `config.json` is neither, and it is the
             * file `isPackAvailable` and `isModelAvailable` read to decide
             * whether a model is installed at all.
             *
             * Under the CacheFirst rule below that decision could never be
             * revised. Two ways it went wrong, and the second is the one that
             * matters: an administrator who removes a model leaves the app
             * still claiming it is there, and — worse — a probe that runs
             * before the model is vendored gets the SPA fallback, which a real
             * server answers with 200 and HTML, and that HTML is then pinned
             * forever. The app would go on sending dictation audio to a third
             * party while the administrator believed they had installed the
             * on-device model, with nothing on any screen to say so.
             *
             * Registration order matters: workbox takes the first matching
             * route, so this has to precede the CacheFirst rule.
             */
            urlPattern: ({ url }: { url: URL }) =>
              url.pathname.startsWith('/models/') && url.pathname.endsWith('/config.json'),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'afyacore-model-manifests',
              // Offline, the last known answer is the right one. Online, the
              // network is.
              networkTimeoutSeconds: 5,
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // The OpenMed PII model, same bargain as the OCR pack: ~67 MB that
            // a facility downloads once while it has signal, and must then keep
            // working with no network at all. Never precached, because the
            // whole premise is a 130 kB install over 2G.
            urlPattern: ({ url }: { url: URL }) =>
              url.pathname.startsWith('/models/') ||
              /\/(transformers|ort-|asr\.worker).*\.(js|wasm|mjs)$/.test(url.pathname),
            handler: 'CacheFirst',
            options: {
              cacheName: 'afyacore-models',
              cacheableResponse: { statuses: [0, 200] },
              // Range requests: onnxruntime streams large graphs in pieces.
              rangeRequests: true,
            },
          },
        ],
      },
    }),
  ],
  build: {
    target: 'es2022',
    // Surface bundle regressions loudly: the whole premise is a tiny shell.
    chunkSizeWarningLimit: 350,
  },
})

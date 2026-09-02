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
 * Nothing ever loads it. `src/lib/openmed.ts` sets `wasmPaths = '/ort/'`, and
 * the runtime resolves its core by *filename* against that prefix, where
 * `npm run vendor:openmed` has placed the single 13 MB core we actually use. So
 * the emitted asset is pure deployment weight: it quadruples the size of a
 * `dist/` a facility's server has to host, to ship a file no client requests.
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

export default defineConfig({
  plugins: [
    excludeOnnxWasm(),
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
        globIgnores: ['**/models/**', '**/ocr/**', '**/transformers*', '**/ort-*'],
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
            // The OpenMed PII model, same bargain as the OCR pack: ~67 MB that
            // a facility downloads once while it has signal, and must then keep
            // working with no network at all. Never precached, because the
            // whole premise is a 130 kB install over 2G.
            urlPattern: ({ url }: { url: URL }) =>
              url.pathname.startsWith('/models/') ||
              /\/(transformers|ort-).*\.(js|wasm|mjs)$/.test(url.pathname),
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

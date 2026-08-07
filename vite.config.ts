import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// AfyaCore ships to Android phones over slow, metered connections. Every byte in
// the initial shell is a byte a CHU nurse waits for on 2G, so heavy work (ASR
// models, OCR) is deliberately kept out of the bundle and fetched on demand.
export default defineConfig({
  plugins: [
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
        theme_color: '#0f766e',
        background_color: '#f8fafc',
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
        globIgnores: ['**/models/**', '**/ocr/**'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/ocr\//],
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

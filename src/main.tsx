import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { startAutoSync } from './lib/sync'
import './index.css'

const root = document.getElementById('root')
if (!root) throw new Error('#root not found')

/**
 * Ask the browser to make storage persistent.
 *
 * Without this, IndexedDB is evictable: a phone low on space can silently drop
 * a week of consultations. The request is best-effort, Chrome grants it once
 * the PWA is installed, but asking costs nothing and the downside of not
 * asking is losing patient records.
 */
navigator.storage?.persist?.().catch(() => {
  /* Not supported; data is still written, just evictable under pressure. */
})

/**
 * Sync when connectivity returns. No polling loop: a phone with no signal
 * should not spend battery asking.
 */
startAutoSync()

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

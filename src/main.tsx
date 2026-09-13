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

/**
 * Pick up a new deploy in a tab that is already open.
 *
 * The service worker calls skipWaiting and clientsClaim, so a new deploy takes
 * control of an open tab straight away, but the JavaScript that tab already
 * loaded keeps running. A screen that decided something once, such as whether
 * the speech model is installed, keeps showing the old answer until somebody
 * reloads. That is how the public demo went on saying "No local speech pack
 * found" after the deploy that started shipping the model had finished.
 *
 * Reloading the instant control changes would be worse here: the session lives
 * in memory, so a reload signs a clinician out in the middle of a consultation.
 * So the reload waits until the tab is hidden, when nobody is using it, and a
 * first install is never treated as an update.
 */
if ('serviceWorker' in navigator) {
  let controlled = Boolean(navigator.serviceWorker.controller)
  let updatePending = false
  const reloadIfHidden = () => {
    if (updatePending && document.visibilityState === 'hidden') {
      updatePending = false
      window.location.reload()
    }
  }
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (controlled) updatePending = true
    controlled = true
    reloadIfHidden()
  })
  document.addEventListener('visibilitychange', reloadIfHidden)
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

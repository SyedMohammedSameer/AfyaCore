/**
 * The gate between the microphone and a third party.
 *
 * `recogniser` uses the browser's Web Speech API, which in Chrome and Edge
 * streams captured audio to the vendor's recognition service. A clinician
 * dictating a consultation therefore sends the patient's name, complaint and
 * diagnosis, in their own voice, to a company the facility has no relationship
 * with — and voice is biometric data under several of the regimes in
 * docs/COMPLIANCE.md §5.
 *
 * The app shipped claiming it made no third-party runtime call at all. That
 * was false, and false in the worst direction: understating where patient data
 * goes. This module is the correction.
 *
 * ## How it behaves
 *
 * - Where the browser can recognise **on-device** (Chrome 138+ with the
 *   language pack installed), nothing leaves and no acknowledgement is asked
 *   for. There is nothing to disclose.
 * - Otherwise dictation is **off** until an administrator acknowledges, once,
 *   that audio leaves the device. The acknowledgement is audited and can be
 *   withdrawn.
 *
 * Not a per-consultation prompt: a dialog that appears fifty times a day is
 * clicked through without reading by lunchtime, which produces a record of
 * consent and no actual understanding. Once, by the person accountable for the
 * facility's data, is worth more.
 *
 * ## Why refusing is survivable
 *
 * Dictation is an accelerator over a manual form that always works and never
 * leaves the device. A facility that declines loses typing speed, not
 * function — which is what makes it honest to ask rather than to assume.
 */
import { db } from '../db/db'
import { recordAudit } from './audit'
import { recogniser, type RecogniserLang, type RecognitionMode } from './speech'

const KEY = 'dictation.remoteAcknowledged'

export type DictationState =
  /** No recogniser in this browser at all. */
  | { status: 'unavailable' }
  /** Recognition happens on the device. Nothing to disclose. */
  | { status: 'on-device' }
  /** Audio would leave, and nobody has acknowledged that. Dictation is off. */
  | { status: 'needs-disclosure' }
  /** Audio leaves, and the facility has said so knowingly. */
  | { status: 'remote-acknowledged'; at: number }

export async function dictationState(lang: RecogniserLang): Promise<DictationState> {
  if (!recogniser.available) return { status: 'unavailable' }

  const mode: RecognitionMode = await recogniser.modeFor(lang)
  if (mode === 'on-device') return { status: 'on-device' }

  const row = await db.settings.get(KEY)
  const at = typeof row?.value === 'number' ? row.value : 0
  return at > 0 ? { status: 'remote-acknowledged', at } : { status: 'needs-disclosure' }
}

/** True when dictation may run at all. The one call a component needs. */
export function dictationAllowed(state: DictationState): boolean {
  return state.status === 'on-device' || state.status === 'remote-acknowledged'
}

export async function acknowledgeRemoteDictation(accepted: boolean): Promise<void> {
  await db.settings.put({ key: KEY, value: accepted ? Date.now() : 0 })
  await recordAudit({
    action: 'facility.configure',
    subjectType: 'device',
    // Named explicitly rather than as a boolean flag: a reviewer reading the
    // audit log should not have to know what `dictation=true` meant.
    detail: `remoteDictation=${accepted ? 'acknowledged' : 'withdrawn'}`,
  })
}

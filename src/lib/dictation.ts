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
 * Three outcomes, tried in this order:
 *
 * - Where a **Whisper pack is installed** on this origin (`npm run
 *   vendor:whisper`) and covers the clinical language, transcription runs in
 *   a worker on the device. Nothing leaves, and there is nothing to disclose.
 *   This is the path the app is meant to run on.
 * - Where the **browser** can recognise on-device (Chrome 138+ with the
 *   language pack installed), the same is true without any download.
 * - Otherwise dictation is **off** until an administrator acknowledges, once,
 *   that audio leaves the device. The acknowledgement is audited and can be
 *   withdrawn.
 *
 * The order is deliberate. The vendored pack is checked first because it is
 * the only option the facility controls: browser on-device recognition can
 * disappear with an update or a wiped language pack, and it does so silently,
 * whereas a file on the facility's own server is either there or it is not.
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
import { installedPack, packSupports, type Pack } from './asr'
import { recordAudit } from './audit'
import { recogniser, type RecogniserLang, type RecognitionMode } from './speech'

const KEY = 'dictation.remoteAcknowledged'

export type DictationState =
  /** No recogniser in this browser at all. */
  | { status: 'unavailable' }
  /** A vendored model transcribes here, in a worker. Nothing to disclose. */
  | { status: 'local-model'; pack: Pack }
  /** The browser recognises on the device. Nothing to disclose. */
  | { status: 'on-device' }
  /** Audio would leave, and nobody has acknowledged that. Dictation is off. */
  | { status: 'needs-disclosure' }
  /** Audio leaves, and the facility has said so knowingly. */
  | { status: 'remote-acknowledged'; at: number }

export interface DictationStateOptions {
  /** Injected for tests, and so a caller can probe without a live origin. */
  findPack?: typeof installedPack
}

export async function dictationState(
  lang: RecogniserLang,
  options: DictationStateOptions = {},
): Promise<DictationState> {
  const findPack = options.findPack ?? installedPack

  // Checked before `recogniser.available`: the local path needs a microphone
  // and a worker, not the browser's Web Speech API, so a browser without one
  // can still dictate. Restricted to languages the model actually handles —
  // see `packSupports`, and the note there about Malagasy.
  if (packSupports(lang)) {
    const pack = await findPack()
    if (pack) return { status: 'local-model', pack }
  }

  if (!recogniser.available) return { status: 'unavailable' }

  const mode: RecognitionMode = await recogniser.modeFor(lang)
  if (mode === 'on-device') return { status: 'on-device' }

  const row = await db.settings.get(KEY)
  const at = typeof row?.value === 'number' ? row.value : 0
  return at > 0 ? { status: 'remote-acknowledged', at } : { status: 'needs-disclosure' }
}

/** True when dictation may run at all. The one call a component needs. */
export function dictationAllowed(state: DictationState): boolean {
  return (
    state.status === 'local-model' ||
    state.status === 'on-device' ||
    state.status === 'remote-acknowledged'
  )
}

/**
 * True when audio would leave the device in this state.
 *
 * The one question the UI, the audit log and the compliance document all ask,
 * answered in one place. Written as an allowlist of the states that keep audio
 * local rather than a denylist of the ones that do not: a state added later
 * defaults to "this sends audio somewhere", which is the direction an
 * incomplete answer should fail in.
 */
export function dictationLeavesDevice(state: DictationState): boolean {
  return state.status !== 'local-model' && state.status !== 'on-device'
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

import React from 'react'
import { AbsoluteFill, Sequence } from 'remotion'
import { Title } from './Title'
import { Scene } from './Scene'
import { Offline } from './Offline'
import { Numbers } from './Numbers'
import { theme, FPS } from './theme'

/**
 * Two minutes, in beats.
 *
 * Ordered by what a reviewer needs in order to believe the next thing: the
 * problem, the capture, the review step that keeps a human in the loop, the
 * patient's own copy, then the two claims that carry evidence — it works with
 * the network off, and the de-identification numbers come from text we did not
 * write. The disclosure beat is in the middle rather than buried at the end,
 * because a demo that shows the microphone without showing what it costs is
 * the same omission the release fixed.
 */
const s = (seconds: number) => Math.round(seconds * FPS)

type Beat = { d: number; el: React.ReactNode }

const BEATS: Beat[] = [
  {
    d: s(7),
    el: (
      <Title
        title="AfyaCore"
        subtitle="Offline-first clinical documentation for health facilities with no reliable connectivity"
        footnote="Every screen in this video is the running application"
      />
    ),
  },
  {
    d: s(11),
    el: (
      <Scene
        src="screens/mobile-today.webp"
        kicker="The setting"
        claim="A shared phone, no signal, a queue in the room."
        note="IndexedDB is the source of truth, not a cache. No write ever waits on a network. 139 kB to install."
      />
    ),
  },
  {
    d: s(12),
    el: (
      <Scene
        src="screens/mobile-dictation-disclosure.webp"
        kicker="Before the microphone"
        claim="The browser's dictation sends audio to a third party. So we say so."
        note="On-device where the browser supports it. Otherwise dictation stays off until an administrator accepts it — audited, withdrawable. Typing always works and never leaves the device."
      />
    ),
  },
  {
    d: s(11),
    el: (
      <Scene
        src="screens/mobile-encounter.webp"
        kicker="Capture"
        claim="Dictate or type. Every vital range-checked as it lands."
        note="Extraction is deterministic rules running offline in microseconds — not a model that has to be downloaded, trusted, or explained to a regulator."
      />
    ),
  },
  {
    d: s(12),
    el: (
      <Scene
        src="screens/mobile-review.webp"
        kicker="Human in the loop"
        claim="Nothing is saved until a clinician confirms it."
        note="Per-field provenance: what was dictated, what was typed, what the extractor was unsure of. Low-confidence values are flagged Check this. Machine output never overwrites a human."
      />
    ),
  },
  {
    d: s(12),
    el: (
      <Scene
        src="screens/mobile-instructions.webp"
        kicker="What the patient leaves with"
        claim="Instructions in the patient's language, not the clinician's."
        note="Ten languages across nine countries. Dosing icons for anyone who cannot read. Unreviewed translations say so on the sheet."
      />
    ),
  },
  { d: s(15), el: <Offline /> },
  { d: s(17), el: <Numbers /> },
  {
    d: s(10),
    el: (
      <Title
        title="Honest about what it is not"
        subtitle="Not validated in a facility. Records are not encrypted at rest. Eight of ten patient translations still need a speaker."
        footnote="github.com/SyedMohammedSameer/AfyaCore · 384 tests · MIT"
      />
    ),
  },
]

export const TOTAL = BEATS.reduce((n, b) => n + b.d, 0)

export const Demo: React.FC = () => {
  let at = 0
  return (
    <AbsoluteFill style={{ background: theme.ground }}>
      {BEATS.map((beat, i) => {
        const from = at
        at += beat.d
        return (
          <Sequence key={i} from={from} durationInFrames={beat.d}>
            {beat.el}
          </Sequence>
        )
      })}
    </AbsoluteFill>
  )
}

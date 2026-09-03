import React from 'react'
import { AbsoluteFill, Sequence } from 'remotion'
import { Title } from './Title'
import { Scene } from './Scene'
import { Models } from './Models'
import { Offline } from './Offline'
import { Numbers } from './Numbers'
import { theme, FPS } from './theme'

/**
 * What the app does, in order of use.
 *
 * The first cut of this was written for a hostile reviewer: nine beats, three
 * of them about limitations, and every claim hedged in the same sentence that
 * made it. It read as a list of things the app does not do. Nobody watching a
 * two minute demo has asked what the software lacks; they have asked what it
 * is for and whether it works.
 *
 * So this follows a consultation from start to finish, each beat naming a
 * capability and showing the screen that delivers it. The honest limitations
 * live in the README and the compliance document, which is where a reviewer
 * who wants them will look, and there is one short status line at the end
 * rather than three beats of apology.
 *
 * House style, learned the hard way: no em dashes anywhere in this file.
 */
const s = (seconds: number) => Math.round(seconds * FPS)

type Beat = { d: number; el: React.ReactNode }

const BEATS: Beat[] = [
  {
    d: s(6),
    el: (
      <Title
        title="AfyaCore"
        subtitle="Clinical records that work where the network does not"
        footnote="Every screen in this video is the running application"
      />
    ),
  },
  {
    d: s(9),
    el: (
      <Scene
        src="screens/mobile-today.webp"
        kicker="Open it and start"
        claim="A full clinical record, in a 139 kB install."
        note="Opens from the home screen on any Android or iPhone. No app store, no account, no server to reach first. Drafts and today's consultations are the first thing you see."
      />
    ),
  },
  {
    d: s(9),
    el: (
      <Scene
        src="screens/mobile-roster.webp"
        kicker="Find anyone in seconds"
        claim="Search that understands how names are actually written."
        note="Accent insensitive across names, register numbers and phone numbers, so RAKOTOARISOA finds Rakotoarisoa. Runs on the device against thousands of records."
      />
    ),
  },
  {
    d: s(10),
    el: (
      <Scene
        src="screens/mobile-encounter.webp"
        kicker="Speak the consultation"
        claim="Dictate it. Nothing leaves the phone."
        note="Speech recognition runs on the device, so the patient's voice never reaches a third party. Temperature, pulse, blood pressure, diagnosis and prescriptions are parsed straight out of natural speech, in French or English."
      />
    ),
  },
  // Placed straight after the dictation beat, where the first model has just
  // done its work, and before the review beat that says not to trust it
  // blindly. It also keeps the two card slides apart: this one and the numbers
  // are the only beats without a photograph of the app, and back to back they
  // would read as a deck rather than a demo.
  { d: s(11), el: <Models /> },
  {
    d: s(11),
    el: (
      <Scene
        src="screens/mobile-review.webp"
        kicker="You stay in charge"
        claim="Every field shows where it came from."
        note="Dictated, typed, or read from a photo. Anything the extractor was unsure of is flagged Check this before it can be saved, and machine output never overwrites something a clinician typed."
      />
    ),
  },
  {
    d: s(10),
    el: (
      <Scene
        src="screens/mobile-instructions.webp"
        kicker="The patient takes it home"
        claim="Instructions in the patient's own language."
        note="Ten languages across nine countries, including Kiswahili, Wolof, Hausa and Malagasy. Dosing icons for sunrise, midday and night mean the sheet still works for someone who cannot read it."
      />
    ),
  },
  { d: s(13), el: <Offline /> },
  {
    d: s(10),
    el: (
      <Scene
        src="screens/desktop-reports.webp"
        kicker="Reports the ministry expects"
        claim="One tap to the monthly DHIS2 return."
        note="FHIR R4 for clinical exchange, DHIS2 for national reporting, CSV for anyone else. Nine country profiles carry the right formulary, phone formats and reporting system."
        wide
      />
    ),
  },
  { d: s(14), el: <Numbers /> },
  {
    d: s(7),
    el: (
      <Title
        title="Open source, MIT"
        subtitle="Built for health facilities across sub-Saharan Africa. Pilot candidate, v0.0.2."
        footnote="github.com/SyedMohammedSameer/AfyaCore"
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

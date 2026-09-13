# Demo video voice-over

ML4H 2026 requires a demonstration video of at most two minutes **with a voice-over**. The
composition in `video/` runs 110 seconds at `SPEED = 1` (set in `video/src/theme.ts`; the README
cut is rendered at 2x and is 55 seconds, which is too fast to narrate). Record this script over the
1x render, or synthesise a scratch track with `node video/narrate.mjs` and replace it with your own
voice before submitting.

Timings are the beat boundaries in `video/src/Demo.tsx`. Each line is written to be read at a
comfortable pace, about 2.4 words a second, and to finish a beat or two of silence before the cut.

| From | Beat | Say |
|---|---|---|
| 0:00 | Title | AfyaCore is a clinical record for facilities where the network cannot be relied on. |
| 0:06 | Today | It installs from a web address in a hundred and fifty kilobytes, on any phone. No app store, no account, no server to reach first. |
| 0:15 | Roster | The roster searches the way names are actually written, ignoring accents and case, across names, register numbers and phone numbers. |
| 0:24 | Dictation | The clinician dictates. Speech recognition runs on the phone, so the patient's voice never leaves it. Vitals, diagnosis and prescriptions are parsed out of natural speech. |
| 0:34 | Models | Three models, all on the device: Whisper for speech, Tesseract for photographs of paper registers, and a French clinical PII model for de-identification. |
| 0:45 | Review | Nothing the machine produced is saved on its own. Each dictated value is listed with the phrase it came from and confirmed one by one. Change a value, and the tick comes off. |
| 0:56 | Instructions | The patient takes home instructions in their own language, ten languages across nine countries, with dosing icons for anyone who cannot read them. |
| 1:06 | Offline | Now the network goes off. The phone reloads from nothing, the clinician signs in and records a consultation. Nothing waits on connectivity; sync catches up later. |
| 1:19 | Reports | The monthly return is one tap: DHIS2 for the ministry, FHIR for exchange, CSV for everyone else, de-identified before it leaves the device. |
| 1:29 | Numbers | Everything here is measured, and measuring it found the app wrong about itself. Its uncertainty flag could never fire on a diagnosis. Corrected, it catches nearly every wrong value instead of one in five. |
| 1:43 | Close | Open source under MIT. A pilot candidate, not yet validated with a facility. That is the next step. |

Word count: 249, about 2.4 words a second across 110 seconds, with each line finishing inside its
beat when read by the macOS Daniel voice. Read it a touch slower than that and let a sentence cross
a cut rather than rushing.

## Recording notes

- Record in a quiet room on the phone's voice memo app if nothing better is available; hold it a
  hand's width from the mouth and slightly off axis.
- Leave two seconds of silence at the start so the title card is not spoken over instantly.
- Export as 48 kHz WAV or M4A. `node video/narrate.mjs --voice path/to/recording.m4a` muxes it
  under the 1x render.

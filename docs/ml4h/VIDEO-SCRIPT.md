# ML4H 2026 Demo Track — video script

**Format:** screen recording of the running app, with voice-over.
**Length:** target 1:50, hard limit 2:00.
**Assume:** the reviewer has read the spec sheet. Do not re-explain the problem.

## Why this is a new recording and not `docs/demo.mp4`

The existing video is a sequence of still screenshots with captions. The call
for demonstrations requires the video to show "the system accepting an input,
performing or invoking its ML-enabled functionality, and producing an output",
and lists "a presentation consisting primarily of slides, figures" among the
submissions that are *not* sufficient. Stills cannot show the thing run.

What is being assessed is: can the reviewer see the tool work, and can they
follow the relationship between the user's task, the ML step, and the output.
The CFD says outright that editing quality does not affect the score. One
continuous take beats a polished montage here.

## Setup before you hit record

1. `npm run vendor:whisper` — **essential.** Without the model, dictation falls
   back to the browser's cloud speech API. On-device inference is the ML claim
   the video has to show, and the panel says which mode it is in on screen.
2. `npm run build && npx vite preview --port 4173`.
3. Phone or a 390x844 browser window. Phone is better: this is a phone app, and
   a reviewer who sees it on a phone believes the deployment story.
4. Load the demo workspace from Settings. Synthetic data only — the CFD permits
   this explicitly, and the app has no real patients in it.
5. Rehearse once without recording. The dictation beat is the only one that can
   surprise you.

## The take

Times are cumulative. Speak at a normal pace; the words below are roughly 250,
which is about 110 seconds.

---

**0:00-0:10 — Cold open on the lock screen.**

> "This is AfyaCore running on a phone, on the actual production build. Every
> record on this device is encrypted; I'm unlocking it with a PIN."

*Type the PIN. Let the roster load on its own — do not cut the wait.*

---

**0:10-0:22 — Roster, then open a patient.**

> "A health post's register. Search runs on the device against the encrypted
> store, so it works with no network at all."

*Type three letters of a name. Tap the patient.*

---

**0:22-0:50 — The ML beat. This is the one the submission lives on.**

> "New consultation. I'll dictate it the way a clinician would speak it."

*Tap New consultation, then the dictation button. Say clearly, in French:*

> **"Température trente-huit virgule neuf, pouls quatre-vingt-seize, tension
> onze sur sept. Diagnostic paludisme simple."**

*Stop. Let the fields populate on camera. Do not cut.*

> "Whisper base is transcribing in a worker on the phone — the patient's voice
> never reaches a network. The transcript is then parsed into structured
> fields: temperature, pulse, blood pressure, diagnosis."

---

**0:50-1:08 — Provenance and the human in the loop.**

*Scroll so the provenance markers are visible.*

> "Every field records where it came from. These were dictated; anything the
> extractor was unsure of is flagged and has to be confirmed before it saves.
> Machine output never overwrites something a clinician typed."

*Correct one field by hand, then confirm the consultation.*

---

**1:08-1:22 — A second ML-adjacent output, and the offline claim.**

*Turn on airplane mode, or DevTools offline. Reload the page.*

> "Turning the network off and reloading. The app is a service worker install,
> so it opens, and the record I just saved is still here."

*Show the saved consultation.*

---

**1:22-1:40 — Output that can be acted upon.**

*Open the paediatric patient (RASOANAIVO Tiana). Show the growth chart.*

> "For an under-five, recorded weights are scored against the WHO growth
> standards. This child is minus two point two weight-for-age — and the curve
> shows why that matters more than the number: she's been flat for eight
> months."

*Then open the patient instruction sheet.*

> "And the patient goes home with dosing instructions in their own language."

---

**1:40-1:50 — Close on the export.**

> "Exports are FHIR R4 for clinical exchange and DHIS2 for the national monthly
> return. De-identification runs before anything leaves the device."

*Tap the monthly report. End on the file appearing.*

---

## Rules for the take

- **Never cut during an ML step.** The dictation beat must be one continuous
  shot from speech to populated fields. A cut there reads as a fake.
- **Do not narrate the UI** ("now I tap here"). Narrate what the system is
  doing and why it matters.
- **Do not claim deployment.** No "clinicians use this". The spec sheet states
  the maturity honestly and the video must not contradict it.
- If dictation mis-hears a word, **keep it in**. A visible correction is
  evidence of the human-in-the-loop design, and a reviewer who has read the
  spec sheet will trust the demo more, not less.

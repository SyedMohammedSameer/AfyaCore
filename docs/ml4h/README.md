# ML4H 2026 demonstration submission

> **Two drafts of the spec sheet exist in this folder. Submit the LaTeX one.**
>
> `spec-sheet.tex` is written for the ML4H template and is the one to submit. It
> now carries the speech-to-fields results, the flag recalibration and the
> withholding fix. **It has not been compiled**, because this machine has no
> LaTeX toolchain: paste it into the template, build it, and check it fits two
> pages before submitting.
>
> `spec-sheet.html` and the PDF beside it were written earlier, before the
> LaTeX draft existed, and are superseded. Keep them only as a content source;
> do not submit them.
>
> Likewise there are two video scripts. `VIDEO-SCRIPT.md` goes with
> `scripts/record-demo.mjs` and the recorded walk-through; `voiceover.md` goes
> with the Remotion cut in `video/` and `video/narrate.mjs`. Pick one before
> recording.

Call: https://ml4h.ahli.cc/submit/call-for-demonstrations/
Deadline: **14 September 2026, 23:59 anywhere on Earth.** Decisions 19 October. Event 6 and 7
December 2026, Sydney; one presenting author must register and attend.

## What goes in

| Item | Requirement | Where it is | State |
|---|---|---|---|
| Spec sheet | 2 pages max excluding references, not anonymised: problem, method, deployment results, lessons learned | `docs/ml4h/spec-sheet.html`, rendered to `AfyaCore-ML4H-2026-spec-sheet.pdf` by `node scripts/spec-pdf.mjs` | 2 pages. Insert the video link; check the affiliation line. |
| Video | 2 minutes max, **with a voice-over**, hosted on Drive, Dropbox, Vimeo or similar; no link means desk rejection | `video/out/afyacore-ml4h.mp4`, 110 seconds, rendered from the real app at 1x | Scratch narration is synthetic. Record `docs/ml4h/voiceover.md`, then `node video/narrate.mjs --voice recording.m4a` and re-render. |
| Working system | Demonstrable in person on synthetic or de-identified data | Production build, `npm run build && npm run preview`, with `npm run vendor:whisper` and `npm run vendor:openmed` run first | Demo workspace is synthetic; the bundled sample dictation is a synthetic voice. |

## Rendering the submission cut

```bash
npm run build && npm run preview          # terminal 1, keep it running
npm run screenshots                       # README stills, reused by the video
npm --prefix video run capture            # photographs the app, offline walk included
node video/narrate.mjs                    # or: node video/narrate.mjs --voice you.m4a
SPEED=1 NARRATION=1 node video/render.mjs out/afyacore-ml4h.mp4
```

`SPEED=1` is the readable 110-second cut; the README trailer stays at 2x and silent.

## What reviewers are asked to score, and where the evidence is

- **Relevance.** Problem and setting: spec sheet §1, README opening.
- **Functionality.** End to end: the offline smoke walk (`npm run smoke`, 12 steps in a real
  browser; `npm run smoke:ml` makes it 14 and runs the speech model twice with the network off,
  asserting the offline transcript matches the online one), the demo workspace, the evidence
  workspace at `/studio`, and the sample dictation in the capture panel.
- **Technical credibility.** Models and pipeline: spec sheet §2 and §3, README "How dictation
  works", `src/lib/asr.ts`, `src/lib/clinicalExtract.ts`, `src/lib/fieldReview.ts`. The two
  defects this preparation found, and their regression tests, are the strongest evidence that
  the claims are checked rather than asserted: `src/lib/withholding.test.ts` and
  `src/lib/uncertaintyFlag.test.ts`.
- **Evidence of impact.** Measured, not claimed: `npm run eval` and `npm run eval:asr`, spec sheet
  §4. There is no field pilot; the sheet says so in the first line of §5 rather than the last.
- **Submission quality.** The video is frames of the running build and nothing else
  (`video/capture.mjs`); the narration is timed to its beats.

## Before pressing submit

- [ ] Record the voice-over. The synthetic track is a placeholder.
- [ ] Upload the video, paste the link into the spec sheet byline, re-render the PDF.
- [ ] Confirm the affiliation and contact in the byline.
- [ ] Re-run `npm test`, `npm run eval`, `npm run eval:asr` and paste any changed number into
  the spec sheet table; the numbers there are from 12 September 2026.
- [ ] Rehearse the Studio walk once on the machine you will bring: pick the English audio case,
  run it, and check the two wrong fields come back flagged. That single screen is the clearest
  three minutes of the demonstration.
- [ ] Bring the phone with the models already placed on a local origin: a conference network
  will not carry 150 MB of model files in the five minutes before a slot.
- [ ] Open the deployed URL once from a device that has never seen it and press **Run local
  speech model**. Netlify now builds with `npm run build:deploy`, so the deployment ships the
  speech pack and a reviewer following the link runs the model rather than reading that they
  could have. If the hub was unreachable during that build the Studio will say the pack is
  missing, which is the one failure worth catching before a reviewer does.

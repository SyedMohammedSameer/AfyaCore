# AfyaCore: making the demonstration worth studying

The product thesis is an offline documentation workflow for health workers: speech becomes a draft, the human checks the source and corrects the structured record, and the confirmed record produces patient instructions and reporting outputs. The neural component is speech recognition (and optional PII detection); extraction, threshold colouring and the facility's count comparison are rules. Do not describe those rules as learned clinical intelligence.

## What this pass adds

- A redesigned shared navigation and home workspace, with consultation actions, active drafts, patients and facility activity arranged for desktop and mobile.
- **Evidence Studio** at `/studio`: two synthetic audio cases through the real browser Whisper worker, plus the existing French and English text cases. The interface distinguishes audio inference from rule-only tests.
- A visible comparison of the original machine result, the result after transcript correction, and extraction from the reference text. Original metrics cannot improve merely because someone edits the transcript.
- Expected, matching, missing, different and unexpected atomic fields, with expandable source phrases. A missing prescription counts all missing annotated attributes. These agreement scores are a different metric from the existing evaluation harness's F1.
- A downloadable per-session JSON report containing the case, sample hash, original transcript, edits, environment, model pack, processing time and measurement definitions. No roster or encounter database is read by this screen. Reports are downloaded explicitly; sessions are not persisted between page reloads.
- An optional real-model offline regression: `npm run smoke:ml`. It warms both language samples, disconnects the browser, reloads the application and recreates the worker before checking that both transcripts match their online counterparts. The ordinary smoke test remains available without model weights.
- Full notes and source phrases on the clinical review checklist; a truncated note should not be presented as the entire value being approved.

## What the new measurements mean

Initial checks on this development machine, production build, Whisper base q8/WASM:

| Synthetic baseline case | Exact fields before edits | Word errors/reference words | End-to-end processing |
|---|---:|---:|---:|
| English | 8/10 | 11/29 | 4.2 s |
| French | 2/10 | 14/31 | 3.5 s |

These are **single-case observations**, not dataset averages, clinical validation or phone benchmarks. Rerun and download the report on the actual demonstration device. The English diagnosis was transcribed as “and complicated malaria” instead of “uncomplicated malaria”. Correcting the reference discrepancies brought reviewed field agreement to 10/10 while the original score stayed 8/10. That demonstrates correction mechanics, not measured clinician performance.

Agreement is intentionally strict. For example, “three days” and “3 days” differ in a free-text field. It does not judge clinical semantic equivalence or completeness of the residual narrative. Prescriptions are aligned by order. No confidence interval or population-level generalization is justified by these two examples.

Synthetic TTS is a controlled development condition. It is **not an established upper bound** on real clinical speech performance; voices, accents, microphones and model domain effects can change the ranking. *Resolved:* the “upper bound” wording has been removed from the spec sheet, the README and `eval/asr.mjs`, each of which now states the condition and its two-sided uncertainty instead.

## Also resolved in this pass

- **The uncertainty flag was measured and found miscalibrated.** `Check this` fired on `confidence < 0.8` while every chief complaint and diagnosis is given exactly `0.8`, so the flag could not reach the two fields a recogniser mangles most, and they were the majority of wrong values on the spoken corpus. The threshold is now the named constant `UNCERTAIN_BELOW` at the next boundary in the extractor's own scale, `npm run eval:asr` reports what it catches, and `src/lib/uncertaintyFlag.test.ts` pins the boundary. It is a correction on 64 rows from the corpus that found the problem, not a validation, and nothing depends on it being right: every machine value is reviewed regardless and the flag only sets reading order. The Studio shows the flag beside each verdict so an attendee can judge it on the run in front of them.

## The next improvements that would change the case for acceptance

1. **Representative speech evaluation.** Collect consented, non-patient role-play recordings from intended users. Independently annotate the spoken facts. Reserve speakers and cases that are never used for tuning. Compare available local model sizes on target hardware, measuring critical-field errors, omissions, processing time, memory and install cost. Do not add fuzzy rules solely to recover individual published test cases.
2. **Workflow evidence.** Run a small formative study with intended clinical users, comparing manual entry and assisted capture in counterbalanced order. Record completion time, uncorrected errors at sign-off, correction burden, abandoned attempts and qualitative feedback. Report participant count and setting; do not claim patient benefit from usability tasks.
3. **Amendment integrity, fixed, and the criticism was right.** The correction path edits already-final rows in place, so a new machine value existed in a final row before its review. Reproduced against the real paths rather than argued about: an unconfirmed weight reached a pseudonymous research export and an unconfirmed diagnosis of “paludisme simple” was counted as a malaria case in the monthly DHIS2 return. The earlier repository test asserted that final status was preserved during that interval, which was true and, exactly as noted here, not evidence about the output boundary.

   The record is no longer staged or demoted, because the consultation happened and may already have been counted in a submitted figure; the unconfirmed **field** is withheld at the two boundaries that matter, `deidentify()` and `aggregateMonth()`, with the count carried in the export manifest and shown on the export screen. `src/lib/withholding.test.ts` tests the boundary itself: the export, the FHIR bundle, the aggregate and the CSV. Sync is deliberately untouched, because `fieldReviews` travels inside the encounter, so the pending state reaches the facility's other device with the record.
4. **Deployment readiness.** Validate the translations with relevant speakers, verify FHIR with the official validator, resolve placeholder DHIS2 mappings with a target installation, and address at-rest protection before working with real patient records. Keep these as concrete deployment limitations rather than implied completed features.

## Demonstration sequence

Rehearse now. Final recording should use the final build and clearly show an input, actual model execution, a visible error, the human correction and the reviewed output. Keep the central clinical capture → review → patient-instructions workflow in the video; the Studio explains and measures that system but does not replace it. The existing narrated video predates the new interface and should be recaptured if this version is submitted.

Do not claim a new ASR architecture, clinical decision support, deployment at a real facility, measured time savings, or guaranteed acceptance. The distinctive contribution to develop is the integration and evaluation of constrained, inspectable, offline ML in the intended workflow.

## Running and recording

```sh
npm run build
npm run preview
# Separate terminal, once the preview is serving:
npm run smoke:ml
npm run screenshots
```

Use the **production preview** for the ML demonstration, because it is what a facility deploys and what the offline walk exercises. *Resolved:* the dev server no longer blocks the models. It used to route ONNX Runtime's runtime `import()` of its WebAssembly core through the module pipeline, refuse it for living in `public/`, and put a full-screen error over the Studio's only button; `vite.config.ts` now serves `/ort/` directly in dev. Open `/studio`, run both languages while connected, then test the disconnected reload. A network indicator alone does not establish that no traffic occurred.

`npm run samples:studio` regenerates the two new WAV inputs on macOS with Thomas and Daniel, at 170 words/minute. The sample manifest records reference text, case IDs and SHA-256 hashes. Existing sample recordings used in clinical capture are preserved.

# Changelog

Notable changes to AfyaCore. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versioning is [SemVer](https://semver.org/), and while the major is `0` anything
may change.

## [Unreleased]

### Evidence Studio and workspace refresh

- Redesigned shared navigation and home layout; responsive consultation work and facility activity columns.
- Added a local Evidence Studio with real speech inference, annotated reference comparisons, immutable original scores, transcript corrections, source phrases and JSON session reports.
- Added reproducible synthetic audio fixtures with hashes and an optional `smoke:ml` test covering fresh workers after an offline reload in both languages.
- Removed clipping of notes and source phrases in the machine-field review checklist.
- Documented evaluation limits and the inherited amendment/output-boundary issue in `docs/ml4h/PRODUCT-READINESS.md`.

### Fixed

- **On-device inference could not start in the browser.** transformers.js 4.x
  asks ONNX Runtime for its `asyncify` WebAssembly core and the vendor scripts
  shipped only the plain one, so the speech worker and the de-identification
  model both reported "no available backend found" at first use. The
  availability probes check for a model's `config.json`, not for a working
  runtime, so every screen said the model was installed. Found by pressing the
  button in a browser, which no test did; both cores are now vendored. The
  same button then found that this runtime rewrites the quantised decoder
  into MatMulNBits at session creation and cannot read the vendored graph's
  layout; the session now keeps the graph's own DequantizeLinear nodes.
- **No on-device model would run on the dev server.** ONNX Runtime locates its
  WebAssembly core with a runtime `import()`, and Vite's dev server routed that
  into `public/`, refused it on principle, and put a full-screen error over the
  Evidence Studio's only button. It was written down as a known limitation of
  the development server; it is a five-line middleware, and `npm run dev` now
  runs the models.
- **The speech worker was precached on every install.** A worker is bundled as
  its own graph, so it carried a second 545 KiB copy of transformers.js that
  the precache exclusion for the first copy did not match. It is fetched on
  first use now, like the models.
- **A dictated value could be confirmed without anyone reading it.** Review
  was one button over a page of numbers. Every machine-entered value now has
  to be ticked individually, and the tick is bound to the exact value shown,
  so a value that changes after the tick is pending again. `finaliseEncounter`
  refuses a record with an unticked machine value whatever screen asks.

- **An unconfirmed machine value could reach an export and the ministry.**
  `finaliseEncounter` guards the moment a draft becomes final, and that was
  the only guard. An amendment writes into a record that is *already* final,
  so a photo read during a correction put an unconfirmed weight into a
  research export and an unconfirmed diagnosis of "paludisme simple" into the
  district's malaria figure. The README claimed the opposite in its first
  paragraph. The record still stands and is still counted, because the
  consultation happened and was confirmed by a human once; the unconfirmed
  *field* is withheld where the record leaves the device and where it becomes
  a statistic, and the count travels in the export manifest.
- **The uncertainty flag could never fire on the fields that get things
  wrong.** The flag was `confidence < 0.8` and the extractor gives every chief
  complaint and diagnosis a confidence of exactly 0.8, so the two fields a
  speech recogniser mangles most were unflaggable by construction. On the
  spoken corpus a clinician reading only the flagged rows would have reached
  1 wrong value in 5. The threshold is now a named constant at the next
  boundary in the extractor's own scale, and `npm run eval:asr` reports what
  it catches: 100% of wrong values in English and 91% in French, up from 20%
  and 18%, for a review-first burden of 46% and 62% of rows. Measured on the
  corpus that found the problem, so it is a correction and not an independent
  validation.

### Added

- **Encryption at rest on the device.** Patient, encounter, attachment and audit
  stores hold AES-GCM ciphertext under a 256-bit data key, wrapped per staff
  account by PBKDF2-SHA256 over that clinician's PIN. The unwrapped key lives in
  memory for the length of a session. Ids and timestamps stay in the clear so
  the sync badge, the retention purge and the roster's first page can work
  without decrypting the register, which leaks shape and nothing else. The sync
  server is still plaintext.
- **WHO growth charts for under-fives**, with weight-for-age z-scores computed
  from WHO's own tables, and an age worth reading on a paediatric record.
- **A duplicate warning at registration**, so the same person entered twice is
  caught at the point of entry rather than merged later.
- **A recorded demonstration walk-through**, driven through the running app
  rather than composited from stills.
- **An evidence workspace** (`/studio`). A reviewer picks a synthetic case,
  runs the vendored speech model on the device, and sees the transcript, the
  fields it produced, which of them match the reference, and what the app had
  flagged, with a downloadable session record. Correcting the transcript
  re-scores the extraction while preserving the model's original result, so a
  polished number after human editing cannot be mistaken for the model's.
- **Flag calibration in the evaluation.** `npm run eval:asr` now reports, per
  language, the error rate inside and outside the flag, the share of wrong
  values a flag-first reviewer would reach, the review burden that costs, and
  the error rate at every confidence the extractor emits.
- **Speech-to-fields evaluation** (`npm run eval:asr`). The extraction corpus
  is spoken by a text-to-speech voice, transcribed by the vendored Whisper
  pack through the same transformers.js build the phone runs, and pushed
  through the same extractor and scorer as the text harness. The first run
  scored 36% field F1 in French and 60% in English against 100% on clean
  text; after the hardening below, 67% and 91%. Synthetic speech in a quiet
  room is an upper bound on field conditions and the report says so.
- **Recogniser-aware extraction.** A comma where a full stop was spoken no
  longer lets a diagnosis swallow the prescription after it; "500mg" with no
  space is a dose; "5 stroke 7" is five days; "presenting complained" is a
  complaint; a weight or height with its unit but no trigger word is taken,
  flagged. Drug names the recogniser spelt phonetically ("par assez tamol",
  "a mux ici une", "artémété lume et fantrine") are recovered by edit
  distance against the formulary, only when a dose, frequency or duration
  follows, always at a confidence that forces review, with the raw phrase
  kept beside the canonical name.
- **Sample dictation.** With the speech pack installed, the dictation panel
  can play a bundled synthetic recording through the same segmenter and
  worker as the microphone, for demonstrations in rooms where a microphone
  cannot be relied on. Labelled as a synthetic voice reading a made-up
  consultation.
- **Extraction preview.** The transcript shows which words are about to
  become which fields, colour-coded by field type, before "Apply" is pressed.
- **Facility overview** on the home screen: confirmed consultations per day
  over the last fortnight, and each reporting indicator's week against the
  four before it, marked when it exceeds the baseline mean by more than two
  standard deviations. Worded as a prompt to look, not an alert.
- **Trends** on the patient profile: a line per vital across confirmed
  visits, with the latest reading coloured by the same threshold table as
  everywhere else.
- A richer demo workspace: twelve patients, twenty-six visits over three
  months, a malaria week, and a draft with dictated values nobody has ticked.

### Changed

- The monthly report preview on the Reports screen shows a bar per indicator
  rather than a list of cells.

## [0.0.2] - 2026-09-03

Hardening, honesty and coverage. Everything here exists because something in
the app behaved differently from how it was described, and in every case the
description was the flattering one.

### Fixed, found by external review

- **Dictation sent patient audio to a third party** while SECURITY.md claimed
  the app made no third-party runtime call. On-device recognition is now
  requested and used where the browser supports it; otherwise dictation is off
  until an administrator acknowledges the disclosure, audited and withdrawable.
- **A sync record the server rejected was marked as synced.** The pull could
  never correct it, because the canonical row's sequence sits below the
  device's cursor, so the copies diverged permanently, and once retention
  landed, a diverged row was eligible for destruction. Conflicts now carry the
  server's canonical record and converge.
- **"Anonymous" exports were joinable.** Stable encounter and prescription ids,
  millisecond row timestamps sitting beside a date generalised to the month,
  and prescription notes that were never scrubbed at all.
- **Role permissions were declared but not enforced.** A clinician could
  produce an identified export, delete a patient, repoint sync at another
  server and erase the database. `requirePermission` now guards the services.
- **FHIR ids were invalid**, 73 characters against R4's 64-char limit on
  identified exports, and `urn:uuid:` applied to things that were not UUIDs.

### Fixed, found by running the model for the first time

- **The neural de-identification pass had never redacted anything.**
  transformers.js returns no character offsets and the code filtered on them,
  so every token was discarded while the model loaded, ran and reported itself
  active. Offsets are now reconstructed; spans snap to whole words, which also
  stopped partial redactions leaving `[…]antsoa` and scoring as successes.
- **It deleted diagnoses named after people**, such as `lymphome hodgkinien`,
  `hernie de Spiegel` and `Castleman's disease`, and it deleted drug names too.
  Guarded.

### Added

- **Patient instructions in ten languages, covering all nine countries.**
  Kiswahili, Wolof, Hausa, Twi, Lingala, Luganda and Dioula, alongside
  Malagasy, French and English. Previously the sheet printed in the
  *clinician's* language for eight of the nine.
- **Research consent per patient**, enforced inside `deidentify()` so no export
  path can bypass it. Absence is refusal.
- **Retention periods and purge**, on device and server, with the eligible
  count shown before anything is destroyed.
- **Evaluation against real clinical text** (E3C, 2,272 gold-annotated
  entities) alongside the synthetic corpus.
- **Compliance documentation**: controller analysis, data flow, DPIA with a
  risk register, nine-country regime matrix, threat model.
- **English OCR**, selected by country rather than reading English registers
  with the French model.

### Changed

- Warm paper visual language, IBM Plex Sans actually shipped rather than named.
- FHIR export claim downgraded from "standards-compliant" to "structurally
  valid; not validator-checked".

## [0.0.1]

First public prototype. Not validated with a facility, and not safe for real
patient data. See [SECURITY.md](SECURITY.md).

### Added

- **Offline-first capture.** Patient roster with accent-insensitive search, and
  consultation capture covering vitals, complaint, diagnosis, notes,
  prescriptions and photos. IndexedDB is the source of truth; no write ever waits
  on the network.
- **Dictation → structured fields.** Deterministic rule extractor driven by
  per-language packs, in French and English. Handles spoken numerals, French
  cmHg blood pressure, Commonwealth prescribing shorthand (`tds`, `5/7`),
  fixed-dose combinations, and prescription scoping.
- **Photo OCR** via Tesseract, downloaded on demand and run on-device, feeding
  the same extractor and the same merge rules as dictation.
- **Per-field provenance.** Every value carries its source, confidence and the
  exact phrase it came from; low-confidence fields are flagged before saving.
- **Triage colouring** from a fixed, non-diagnostic threshold table, with
  implausible values rejected at input.
- **Patient instruction sheet** in the patient's own language, with dosing icons
  for limited literacy, printable and readable aloud.
- **Trilingual interface** in French, Malagasy and English, switchable from the
  header, the desktop sidebar or Settings, following the device on first run.
- **Correcting the record.** Edit, delete and merge patients; amend or delete a
  confirmed consultation. Deletions are tombstones so they reach the facility's
  other devices.
- **Sync** between devices via a zero-dependency Node server, with cursor-based
  push-then-pull, last-write-wins conflicts, and a rule that a local draft is
  never overwritten.
- **Exports** covering a FHIR R4 bundle, a DHIS2 monthly `dataValueSet`,
  aggregate CSV and raw JSON, with every record-level export passing through one
  de-identification step at identified, pseudonymous or anonymous level.
- **PWA install**, service-worker precache and requested storage persistence.

### Known limits

- The sync server has no authentication or audit trail.
- Malagasy strings are an unreviewed draft and need a native speaker.
- The DHIS2 export ships placeholder UIDs and is flagged `_placeholderMapping`.
- OCR uses the French model regardless of interface language.
- Deleting a confirmed consultation changes monthly figures that may already have
  been submitted.

[Unreleased]: https://github.com/SyedMohammedSameer/AfyaCore/compare/v0.0.1...HEAD
[0.0.1]: https://github.com/SyedMohammedSameer/AfyaCore/releases/tag/v0.0.1

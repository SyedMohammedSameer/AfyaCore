# Changelog

Notable changes to AfyaCore. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versioning is [SemVer](https://semver.org/), and while the major is `0` anything
may change.

## [Unreleased]

## [0.0.2] — 2026-09-03

Hardening, honesty and coverage. Everything here exists because something in
the app behaved differently from how it was described, and in every case the
description was the flattering one.

### Fixed — found by external review

- **Dictation sent patient audio to a third party** while SECURITY.md claimed
  the app made no third-party runtime call. On-device recognition is now
  requested and used where the browser supports it; otherwise dictation is off
  until an administrator acknowledges the disclosure, audited and withdrawable.
- **A sync record the server rejected was marked as synced.** The pull could
  never correct it, because the canonical row's sequence sits below the
  device's cursor, so the copies diverged permanently — and once retention
  landed, a diverged row was eligible for destruction. Conflicts now carry the
  server's canonical record and converge.
- **"Anonymous" exports were joinable.** Stable encounter and prescription ids,
  millisecond row timestamps sitting beside a date generalised to the month,
  and prescription notes that were never scrubbed at all.
- **Role permissions were declared but not enforced.** A clinician could
  produce an identified export, delete a patient, repoint sync at another
  server and erase the database. `requirePermission` now guards the services.
- **FHIR ids were invalid** — 73 characters against R4's 64-char limit on
  identified exports, and `urn:uuid:` applied to things that were not UUIDs.

### Fixed — found by running the model for the first time

- **The neural de-identification pass had never redacted anything.**
  transformers.js returns no character offsets and the code filtered on them,
  so every token was discarded while the model loaded, ran and reported itself
  active. Offsets are now reconstructed; spans snap to whole words, which also
  stopped partial redactions leaving `[…]antsoa` and scoring as successes.
- **It deleted diagnoses named after people** — `lymphome hodgkinien`,
  `hernie de Spiegel`, `Castleman's disease` — and drug names. Guarded.

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
- **Compliance documentation** — controller analysis, data flow, DPIA with a
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

# Changelog

Notable changes to AfyaCore. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versioning is [SemVer](https://semver.org/), and while the major is `0` anything
may change.

## [Unreleased]

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

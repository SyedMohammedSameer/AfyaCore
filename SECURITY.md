# Security

AfyaCore handles clinical records. This file is deliberately blunt about what it
does and does not protect, because a health tool that overstates its security is
worse than one that has none.

## Status: prototype. Do not use with real patient data.

v0.0.1 is not ready for a live facility. The gaps below are known, deliberate and
tracked, not oversights waiting to be discovered.

## Known gaps

| Gap | Impact | Status |
|---|---|---|
| **The sync server has no authentication** | Anyone who can reach the server and guess a facility ID can read and write that facility's entire record set | Not implemented. Use only on a trusted network, or not at all. |
| **No audit trail** | Nothing records who created, amended or deleted a record | Not implemented |
| **No encryption at rest** | Records sit in IndexedDB and in the server's SQLite file in plain text. Anyone with the unlocked device or the server's filesystem can read them | Relies on device and disk encryption |
| **No transport security by default** | The sync server speaks plain HTTP. Put it behind a TLS-terminating reverse proxy | Deployer's responsibility |
| **Deleting a confirmed consultation changes figures already reported** | A monthly aggregate re-exported after a deletion will not match what was submitted | Warned in the UI, not enforced |

## What the app does protect

These are implemented and tested, and are the parts you can rely on:

- **Records never leave the device without an explicit action.** There is no
  telemetry, no analytics, no crash reporting and no third-party network call at
  runtime. The only outbound request the app makes is to a sync server you
  configure yourself, plus a one-time OCR model download you have to ask for.
- **Every record-level export passes through one de-identification step**, so no
  export path can bypass the level you chose. Pseudonyms are SHA-256 under a salt
  generated on the device that never leaves it.
- **Free-text scrubbing covers identifiers the roster knows about**, including
  names of *other* patients mentioned in notes, and villages, which are
  identifying at fokontany scale.
- **Draft consultations are excluded from every export**, so an unconfirmed
  record cannot reach a national statistic.
- **Attachments are never synced and never exported** in a de-identified export,
  because a photograph of a paper register cannot be redacted.

See the [export privacy](README.md#export-privacy) section of the README for detail.

## Reporting a vulnerability

Please **do not open a public issue** for a security problem.

Use GitHub's [private vulnerability reporting](https://github.com/SyedMohammedSameer/AfyaCore/security/advisories/new)
on this repository. If that is unavailable, open a normal issue containing only
the words "security report, please make contact" and nothing else, and a
maintainer will arrange a private channel.

Please include what you were able to access, the steps to reproduce it, and the
commit you tested. As a prototype with no production deployments, there is no
bug bounty and no formal SLA; expect a first response within a week.

If you find a gap already listed in the table above, it is known, but a
*proof of concept* showing it is worse than described is still worth reporting.

## Scope

In scope: the web app, the sync server and protocol, the de-identification
pipeline, and the export formats.

Out of scope: findings that reduce to "the prototype has no authentication",
issues in the browser or OS itself, and anything requiring physical access to an
unlocked device.

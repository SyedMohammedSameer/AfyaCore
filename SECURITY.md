# Security

AfyaCore handles clinical records. This file is deliberately blunt about what it
does and does not protect, because a health tool that overstates its security is
worse than one that has none.

## Status: pilot candidate. Not yet validated in a live facility.

The gaps below are known, deliberate and tracked, not oversights waiting to be
discovered. Where a row says "implemented", there is a test that fails if it
stops being true.

## Implemented controls

| Control | What it does |
|---|---|
| **Device enrolment and bearer tokens** | A device joins a facility once, with a single-use code that expires in 24 hours. Facility scope is a property of the token; the server ignores any facility id in the request body, so a caller can only ever reach the facility their token was issued for. Tokens are stored as hashes, and `cli.mjs device:revoke` cuts off a lost phone immediately. |
| **Tamper-evident audit trail** | Every enrolment, sync, and administrative action is appended to a hash-chained log. Editing or deleting an entry breaks every hash after it, and `cli.mjs audit:verify` reports the first break. |
| **Rate limiting** | 10 enrolment attempts per minute per address, which turns a ~38-bit code from guessable into not. |
| **Origin allow-listing** | CORS is restricted to origins the deployer names. It previously allowed `*`, meaning any page on the internet could drive a facility's server. |

| **Role enforcement at service boundaries** | The clinician/admin matrix is checked by `requirePermission` inside the services themselves, not only in components. Identified exports, patient deletion, sync configuration, retention purge and database erase all refuse a clinician and refuse a signed-out caller. |
| **Sync conflicts converge** | A record the server rejects as stale comes back with the server's canonical row, and is never marked as synced. Previously a rejected push was acknowledged anyway and the two copies diverged permanently. |

## Known gaps

| Gap | Impact | Status |
|---|---|---|
| **The audit chain is single-server** | A hash chain makes tampering detectable, not impossible. An administrator with filesystem access can rewrite the whole chain. | Mitigate by recording the head hash off-box; anchoring is not automated. |
| **No encryption at rest** | Records sit in IndexedDB and in the server's SQLite file in plain text. Anyone with the unlocked device or the server's filesystem can read them | Relies on device and disk encryption |
| **No transport security by default** | The sync server speaks plain HTTP unless `AFYACORE_TLS_CERT`/`AFYACORE_TLS_KEY` are set. Put it behind a TLS-terminating reverse proxy, or set those. | Deployer's responsibility, and the server says so on boot |
| **Deleting a confirmed consultation changes figures already reported** | A monthly aggregate re-exported after a deletion will not match what was submitted | Warned in the UI, not enforced |

## What the app does protect

These are implemented and tested, and are the parts you can rely on:

- **Records never leave the device without an explicit action.** There is no
  telemetry, no analytics and no crash reporting. Outbound requests are: the
  sync server you configure yourself, a one-time OCR, speech or PII model
  download you ask for, and — if you fall back to it — dictation.
- **Dictation runs on the device when the speech model is installed.** Run
  `npm run vendor:whisper` and Whisper transcribes in a worker on the phone.
  Nothing is sent anywhere, there is no disclosure to make, and it works with
  the network off. This is the configuration to deploy.
- ⚠️ **Without that model, dictation is the one exception, and it is
  disclosed.** The browser's Web Speech API streams captured audio to the
  browser vendor's recognition service, so a dictated consultation sends the
  patient's voice, name and diagnosis to a third party. This file previously
  claimed the app made no third-party runtime call at all, which was false.
  Where no model is installed the app asks the browser for on-device
  recognition, and where that is unavailable too, dictation stays **off**
  until an administrator acknowledges the disclosure — audited, withdrawable,
  and reminded on screen while it is in force. Typing always works, offline,
  and never leaves the device.
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

## Compliance

[`docs/COMPLIANCE.md`](docs/COMPLIANCE.md) is the companion to this file: who the
controller is, what data lives where, the data-protection regime per country,
the DPIA and its risk register, and the threat model this table of controls is
answering. Where the two overlap, this file describes the controls and that one
describes the obligations they are meant to meet — and the ones they do not.

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

Out of scope: issues in the browser or OS itself, and anything requiring
physical access to an unlocked device.

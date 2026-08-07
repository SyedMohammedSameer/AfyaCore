# AfyaCore

Offline-first clinical data capture for health facilities in Madagascar.

A health post records consultations on paper. AfyaCore replaces the register with a phone that
works with no connectivity, no server, and no account, and gives the patient something they can
actually read on the way out.

**Status: v0.5 prototype.** Not yet validated with a facility or an NGO. See [Known limits](#known-limits).

---

## What it does

- **Patient roster**, accent-insensitive search over names, register numbers and phone numbers
- **Consultation capture**, vitals, complaint, diagnosis, notes, prescriptions, photos
- **French dictation → structured fields**, speak the consultation, get a filled form
- **Triage colouring**, out-of-range and clinically urgent vitals are flagged at input
- **Patient instruction sheet**, dosage instructions rendered in the *patient's* language, large,
  printable, and readable aloud
- **Photo OCR**, photograph a paper register, and the French text is read on-device and flows
  through the same extractor as dictation
- **Works offline**, every write lands locally and succeeds immediately; connectivity is never
  on the critical path
- **Exports**, FHIR R4 bundle, DHIS2 monthly `dataValueSet`, aggregate CSV, and a raw JSON dump
- **Sync** between the devices at a facility, with a zero-dependency server you can self-host
- **De-identified export**, identifiers stripped before anything leaves the device, with a stable
  pseudonym so a patient stays trackable across exports without being identifiable

## Languages

Two things are translated independently, because they are used by different people:

| | Follows | Currently |
|---|---|---|
| Interface | staff preference | French, Malagasy, English |
| Patient instruction sheet | the patient's recorded language | French, Malagasy, English |
| **Dictation and extraction** | the interface language | **French, English** |

Dictation was French-only, which quietly locked the app to francophone countries. The extractor is
now driven by language packs, so a locale is a data exercise rather than a rewrite.

A pack is not a translation. Clinical dictation differs by *convention*:

- French clinicians say blood pressure in cmHg, so "tension douze sur huit" is 120/80. English
  clinicians do not, so "12 over 8" in English is rejected as implausible rather than silently
  multiplied by ten.
- Commonwealth-trained clinicians write frequency as **od / bd / tds / qds** and duration as
  **5/7**. An English pack that cannot read `tds` is close to useless in the places it would be
  deployed, so both are supported.
- Each pack carries its own formulary, so an English deployment autocompletes `amoxicillin` and a
  French one `amoxicilline`.

Malagasy deliberately falls back to the French pack: clinical documentation in Madagascar is written
in French, and there is no Malagasy dictation model worth wiring in (`docs/MODEL-RESEARCH.md` §2.2).
Falling back is honest. Pretending to parse Malagasy would not be.

## Sync

Records live on the device. Sync is a background reconciliation between two independent stores, never
something the interface waits on: a facility offline for a week notices nothing but a rising pending
count.

```bash
node server/sync-server.mjs     # PORT=8787, AFYACORE_DB=./server/data/afyacore.db
```

Zero dependencies. `node:sqlite` and `node:http` are both standard library from Node 22, because
whoever runs this is likely an NGO IT volunteer on a small VPS and "nothing to install" is worth more
than framework convenience.

**Protocol.** One POST does push then pull. Push first, so a record that loses a conflict comes back
in the same round trip. The cursor is a server-assigned sequence rather than a timestamp, so a phone
with a wrong clock cannot skip records on pull.

**Conflicts** are last write wins on `updatedAt`, decided by the server. Defensible here because
records are replaced whole and never merged field by field. Two rules protect work:

- A pulled record is applied only when it is **strictly newer**, so a device never churns its own
  records back and forth.
- A local **draft is never overwritten**. A draft may be half-typed on the phone in someone's hand,
  and replacing it would delete work in front of the person doing it. Those are reported as refused.

**Deletes** are tombstones. A hard delete cannot propagate, since the other device has no way to
learn that a row it still holds is gone.

Attachments do not sync: they are large, and the value per byte over a metered connection is low.

⚠️ **The server has no authentication yet.** Do not put real patient data on a public instance.

## The design bet

Madagascar's clinical documentation is written **in French**; most patients **do not speak French**;
facility staff are bilingual. That splits one hard problem into a tractable one and an optional one:

| | Language | Status |
|---|---|---|
| Clinician dictates → record | French | Works today |
| Record → patient instructions | Malagasy | Works today |
| Patient speaks → record | Malagasy | Deferred (~30–50% WER) |
| Paper photo → record | French print | Works today (Tesseract, on-device) |

**Nothing heavy ships in the install.** French dictation uses the browser's built-in recogniser
(0 MB), and the field extraction is deterministic rules that run offline in microseconds. OCR is the
one large dependency (~7 MB) and it is downloaded only when someone asks for it. Every model in
[`docs/MODEL-RESEARCH.md`](docs/MODEL-RESEARCH.md) is an upgrade path behind an interface, not a
launch blocker, which is what keeps the install small enough for a 2G connection.

Initial download: **~113 kB gzipped**, precache 447 kB. Routes beyond the roster load on demand and
are then cached permanently by the service worker.

## One app, every device

This is a **Progressive Web App**, not an Android build. One codebase installs to the home screen on
Android and iOS, runs in any browser, and updates without an app store. That matters here for
reasons beyond convenience:

- **No store account, no APK sideloading.** A facility opens a URL and taps "Install".
- **Updates reach every device immediately**, no review queue, no per-device upgrade.
- **iOS gets the same app**, which matters if the NGO's staff carry mixed devices.

The trade-offs, stated honestly: iOS Safari is stricter about background work and evicts storage
from *unused* installed PWAs after about 7 days of no use (daily clinical use never hits this, and
requesting persistent storage, which the app does on launch, is the mitigation). Android/Chrome
has no such limit. Neither platform gives a PWA the camera or filesystem depth a native app has, but
nothing in this app needs it: photo capture goes through the standard file input with
`capture="environment"`, which opens the native camera on both.

If a native shell is ever genuinely required, the same web build can be wrapped with Capacitor
without rewriting the app.

## Stack

React 19 · TypeScript · Vite 8 · Tailwind CSS v4 · Dexie (IndexedDB) · vite-plugin-pwa

Local-first: IndexedDB is the source of truth, not a cache. `syncedAt` records whether a server has
acknowledged a record; nothing is lost when the network is not there. Storage persistence is
requested on launch so a phone low on space cannot silently evict a week of consultations.

## Running it

```bash
npm install
npm run dev        # dev server
npm run sync       # sync server on :8787
npm test           # extraction, FHIR and reporting test suites
npm run build      # vendor OCR assets + typecheck + production build
npm run preview    # serve the production build
```

`npm run build` runs `scripts/vendor-ocr.mjs` first, which copies the Tesseract runtime out of
`node_modules` and fetches the French model into `public/ocr/`. Those files are ~7 MB and are **not
committed**, they are regenerated at build time, and the fetched model is cached in `.cache/`.

Load `Paramètres → Charger des données de démonstration` for synthetic patients to click through.

## How dictation works

Say, in French:

> « Motif : fièvre depuis trois jours. Température trente-huit virgule cinq, pouls quatre-vingt-douze,
> tension douze sur huit. Diagnostic : paludisme simple. Paracétamol 500 mg trois fois par jour
> pendant cinq jours et artéméther luméfantrine matin et soir pendant trois jours. »

You get: `38.5 °C`, `92 /min`, `120/80 mmHg`, complaint, diagnosis, and two correctly separated
prescriptions with dose, frequency and duration.

Details that took real work:

- **Spoken French numerals**, `trente-huit virgule cinq` → `38.5`, including the irregular
  `soixante-dix` / `quatre-vingt-dix` compounds
- **cmHg → mmHg**, French clinicians say `douze sur huit`, meaning 120/80; the conversion is
  applied and scored lower because it is an inference
- **Prescription scoping**, each drug's modifiers stop at the next drug, so one drug never steals
  the next one's frequency
- **Fixed-dose combinations**, `artéméther luméfantrine` is one prescription, not two
- **Implausible values are rejected**, a recogniser dropping a decimal turns 38.5 into 385, which
  is discarded rather than recorded

### Safety properties

These are structural, not conventions:

1. **Nothing AI-derived is ever saved without human confirmation.** Encounters start as `draft`;
   only the review screen promotes one to `final`.
2. **Extraction never overwrites typed input.** If the clinician entered a value, dictation cannot
   replace it.
3. **Provenance is per-field.** Every value carries its source (typed / dictated / photo) and the
   exact phrase it came from. Low-confidence fields are labelled *À vérifier* and listed at the top
   of the review screen.
4. **Nothing is diagnostic.** Vital-sign colouring is a fixed threshold table. The app does not
   suggest, infer, or decide anything clinical.

## Known limits

- ⚠️ **Malagasy strings are an unreviewed draft.** They need a native speaker before any real
  deployment, wrong dosage wording is a safety issue, not a polish issue.
- **Dictation needs network** (browser recogniser). Manual entry always works offline. Offline
  ASR is the first planned upgrade.
- ⚠️ **Sync has no authentication.** Anyone who can reach the server and guess a facility ID can read
  and write that facility's records. Use only on a trusted network until auth exists.
- **Malagasy dictation is not supported** and falls back to French. See `docs/MODEL-RESEARCH.md` §2.2.
- ⚠️ **The DHIS2 export contains placeholder UIDs.** DHIS2 identifies data elements by
  instance-specific IDs we do not have. The JSON is structurally valid and will import once
  `DHIS2_MAPPING` in `src/lib/dhis2.ts` is filled in; until then every export is flagged
  `_placeholderMapping: true`.
- **OCR reads print well, handwriting poorly.** Expect heavy correction on handwritten registers, this is a property of the problem, not of the implementation.
- **Diagnoses are not coded.** They are free French text; the app does not guess at ICD-10.
  Reporting classifies them by keyword, and anything unmatched falls to `Autre` rather than being
  forced into a bucket.
- **No auth.** Deliberate for a prototype; needed before real patient data.
- **Malagasy TTS is unavailable on Android**, so *Lire à voix haute* falls back to showing the text.
  The fix is a pre-rendered Opus phrase bank (§3), not a model.
- **Not validated against a real workflow.** The clinical scope is a reasonable general-outpatient
  guess and should be expected to change on contact with an actual facility.

## Interoperability

| Export | Format | Status |
|---|---|---|
| FHIR R4 | `Bundle` of `Patient`, `Encounter`, `Observation` (LOINC + UCUM), `MedicationRequest` | Standards-compliant |
| DHIS2 | monthly `dataValueSet`, disaggregated by WHO/IMCI age band and sex | Needs real UIDs |
| CSV | same aggregate, for facilities still submitting on paper | Ready |
| JSON | raw local dump | Ready |

Draft encounters are excluded from every export, an unconfirmed record must never leave the device
or reach a national statistic.

### Export privacy

Every record-level export passes through one de-identification step, so no export path can bypass
the chosen level.

| Level | Identifiers | Linkage across exports |
|---|---|---|
| Identified | included | full |
| **Pseudonymous** (default) | removed, replaced by a stable code | same patient recognisable |
| Anonymous | removed, dates reduced to the month | none, fresh salt each export |

What de-identification removes, beyond the obvious fields:

- **Names, villages and register numbers inside free text.** Because the roster is on the device,
  every identifier it holds can be matched exactly and removed, including names of *other*
  patients, since notes routinely reference relatives.
- **Villages specifically.** Dropping the `address` field while leaving "village Ambohimanga" in a
  note removes nothing: a fokontany of a few hundred people plus an age and a sex identifies
  someone. (This was a real leak, caught by a round-trip export test rather than a unit test.)
- **The raw dictation and OCR text kept in provenance**, verbatim speech is the richest source of
  stray identifiers in the record.
- **Ages above 89**, capped, and **photographs**, dropped entirely: an image of a paper register
  cannot be redacted by any means available here.

The pseudonym is a SHA-256 of the patient id under a salt generated once and never leaving the
device, so a code cannot be walked back to a patient by anyone holding only the export. A manifest
of what was applied travels inside the file. Aggregate DHIS2 and CSV reports are exempt by
construction, they contain counts, never records, and de-identification is verified not to change
a single reported number.

## Next

1. Native-speaker review of all Malagasy strings
2. Authentication and an audit trail for the sync server, before any real patient data
3. Real DHIS2 UIDs from the NGO's instance
4. Offline ASR (`whisper-base` ONNX int8, ~80 MB, on demand)
5. Optional neural PII pass over free text (OpenMed 44M ONNX) for names *not* on the roster, the deterministic scrub already covers names that are; see `docs/MODEL-RESEARCH.md` §4b
6. Malagasy instruction phrase bank as pre-rendered audio
7. Auth and an audit trail

## Licence

ISC. Model licences vary and are tracked per-model in `docs/MODEL-RESEARCH.md` §5, some candidates
are CC-BY-NC and would foreclose a commercial version.

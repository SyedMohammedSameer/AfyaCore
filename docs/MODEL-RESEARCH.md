# Model research, Madagascar (Malagasy + French)

Status: **v2, August 2026.** This is the "search first, build second" deliverable. It is a
scored inventory of models we can *use*, not train. Revisit whenever the NGO confirms their
actual languages, devices, and workflow.

---

## 1. The finding that shapes the whole product

Madagascar has an unusually clean language split in clinical settings:

> Clinical notes and documentation are conducted **in French**. Most patients **do not speak
> French**. Facility staff are bilingual French/Malagasy.

This is the single most important design input we have, because it splits one hard problem into
one easy problem and one optional one:

| Direction | Language | Difficulty | Priority |
|---|---|---|---|
| Clinician dictates → record | French (Malagasy-accented) | **Tractable today** | P0 |
| Record → patient instructions | Malagasy (spoken + written) | **Tractable today** (TTS is easier than ASR) | P1 |
| Patient speaks → record | Malagasy | Hard, ~30–50% WER | P2 (assistive only) |
| Paper register photo → record | French print / mixed handwriting | Hard for handwriting | P2 |

**We do not need Malagasy ASR to ship a useful product.** The record is written by the clinician,
in French, and French ASR is a solved-enough problem. Malagasy earns its place on the *output*
side, reading dosage instructions back to a patient who cannot read French. That inverts the
usual assumption and makes v1 dramatically more achievable.

Language codes: `fr` (French), `mg` / `plt` (Plateau Malagasy, the Merina standard, ~28M speakers).

---

## 2. Speech-to-text

### 2.1 French (clinician dictation), P0

| Option | Size | License | Offline | Verdict |
|---|---|---|---|---|
| **Web Speech API (`fr-FR`)** | **0 MB** | n/a (OS/browser) | ❌ needs network | **Ship this first.** Free, zero bundle cost, good French accuracy, already on every Android Chrome. |
| `whisper-small` fr (ONNX int8) | ~250 MB | MIT | ✅ | Phase 2 offline fallback. |
| `whisper-base` fr (ONNX int8) | ~80 MB | MIT | ✅ | If 250 MB proves too heavy for target devices. |

Design consequence: the app treats voice as an *optional accelerator over a manual form*, never a
dependency. Network drops → the form still works, the mic button just greys out.

### 2.2 Malagasy, P2 (assistive)

Real models exist. Quality is unbenchmarked for clinical use, treat all WER claims as unverified.

| Model | Base / size | License | ONNX | Notes |
|---|---|---|---|---|
| [`badrex/w2v-bert-2.0-malagasy-asr`](https://hf.co/badrex/w2v-bert-2.0-malagasy-asr) | w2v-BERT 2.0, 580M | **CC-BY-4.0** ✅ | ✗ | **Best license + likely best accuracy.** w2v-BERT is the strongest architecture in very-low-resource regimes. Needs ONNX export + quantization. |
| [`HobyTahiry/whisper-base-malagasy-hoby`](https://hf.co/HobyTahiry/whisper-base-malagasy-hoby) | whisper-base, 74M | **Apache-2.0** ✅ | ✗ (LoRA) | **Smallest permissive option** (~40 MB int8). Needs adapter merge. Best fit for "immensely small". |
| [`OpenVoiceOS/misterkissi-whisper-small-malagasy-onnx`](https://hf.co/OpenVoiceOS/misterkissi-whisper-small-malagasy-onnx) | whisper-small, 244M | CC-BY-NC-SA-4.0 ⚠️ | **✅ ready** | Only pre-exported ONNX. Fastest to integrate; NC blocks commercialization. |
| [`HobyTahiry/whisper_malagasy_int8`](https://hf.co/HobyTahiry/whisper_malagasy_int8) | whisper, int8 | unspecified ⚠️ |, | Already quantized; license must be clarified before use. |
| [`Flo976/whisper-malagasy-medium`](https://hf.co/Flo976/whisper-malagasy-medium) | whisper-medium, 769M | **AGPL-3.0** ❌ | ✗ | **Avoid.** AGPL is viral over network use and would infect the whole application. |
| [`joeykurek/malagasy-asr`](https://hf.co/joeykurek/malagasy-asr) | MMS-300m | CC-BY-NC-4.0 ⚠️ | ✗ | MMS baseline. |

**Recommended path:** `HobyTahiry/whisper-base-malagasy-hoby` (merge LoRA → ONNX → int8) for size,
with `badrex/w2v-bert-2.0-malagasy-asr` as the accuracy ceiling to benchmark against.

---

## 3. Text-to-speech, Malagasy, P1

This is the highest value-per-megabyte feature in the product. VITS models are small and fast.

| Model | Size | License | Notes |
|---|---|---|---|
| `facebook/mms-tts-mlg` | ~145 MB fp32, ~40 MB int8 | CC-BY-NC-4.0 ⚠️ | Meta MMS baseline, covers `mlg`. Reliable starting point. |
| [`Nelchael/tts-malagasy`](https://hf.co/Nelchael/tts-malagasy) | VITS | unspecified ⚠️ | Community fine-tune. |
| [`hasiniaina/mms_malagasy_finetuning`](https://hf.co/hasiniaina/mms_malagasy_finetuning) | VITS | CC-BY-NC-4.0 ⚠️ | Fine-tuned on [`hasiniaina/malagasy-female-speech-dataset`](https://hf.co/datasets/hasiniaina/malagasy-female-speech-dataset). |
| `speechSynthesis` (browser) | 0 MB | n/a | **No Malagasy voice on Android.** Usable for French only. |

Because our TTS surface is a **closed set of ~200 instruction phrases** (dosages, frequencies,
follow-up, red flags), we do not need general TTS at runtime. We can **pre-render the phrase bank
to compressed audio**, a few MB of Opus covers the entire clinical vocabulary, works fully
offline, and needs no model on the device at all. Reserve live TTS for free-text.

---

## 4. Photo capture / OCR, P2

Important correction to the original plan: photographing a paper register is **document
digitization**, not medical image interpretation. MedGemma is the wrong tool, it reads X-rays and
skin lesions, and at ~3 GB quantized it is incompatible with an on-device app regardless.

| Need | Tool | Notes |
|---|---|---|
| Printed French forms | **Tesseract `fra` LSTM (shipped)** | ~7 MB runtime, on demand. Works well. |
| Printed English forms | **Tesseract `eng` LSTM (shipped)** | ~9 MB runtime, on demand. Selected by country, not interface language. |
| Malagasy handwriting | [`EzraFanantenana/trocr-malagasy-v3`](https://hf.co/EzraFanantenana/trocr-malagasy-v3) | TrOCR fine-tune. Handwriting remains the hardest case; expect heavy correction. |
| Clinical images (wounds, X-ray) | MedGemma 1.5 4B / MedSigLIP 400M | **Server-side only.** Out of scope for v1. |

**Implemented (v0.2, `eng` added v0.3):** Tesseract `fra`/`eng`, LSTM-only WASM core, running
fully on-device, the image
never leaves the phone. OCR text is fed through the *same* rule extractor as dictation, so a
photographed form produces the same structured fields, tagged `source: 'photo'` and scaled down by
the engine's own confidence so it lands in the review screen flagged for checking.

The runtime is ~7 MB and is therefore **self-hosted and fetched on demand**, never bundled. It is
deliberately not loaded from a public CDN: a facility on a weak or filtered connection may not reach
one, and a service worker cannot reliably cache an opaque cross-origin response, OCR would pass
testing and fail in a village. `scripts/vendor-ocr.mjs` copies it from `node_modules` at build time,
and Settings offers an explicit "download now" so staff can pre-load it while they have signal.

Measured on a synthetic printed French consultation form: temperature, pulse, blood pressure
(including the cmHg convention), weight, diagnosis and a full prescription all extracted correctly at
95% engine confidence. Handwriting remains the hard case.

---

## 4b. OpenMed (Maziyar Panahi), adopted for de-identification

Status: **revised September 2026.** The August assessment below was correct when written and is now
out of date in our favour. It is kept rather than rewritten, because the thing that changed is
instructive: the blocker was language coverage, and language coverage moved.

[OpenMed](https://huggingface.co/OpenMed) is a large Apache-2.0 collection of medical NER models
([paper](https://arxiv.org/abs/2508.01630)). The licence is ideal and the engineering is serious.

### What was true in August, and still is

**Most of the collection is the wrong domain.** The bulk of the models detect genes, proteins, DNA,
cell lines, oncology and species entities. A rural outpatient clinic records fever, malaria,
pneumonia and paracetamol.

**Replacing the French rule extractor would still be a regression.** Rules score ~100% on a bounded
formulary at 0 MB. A 110M-parameter encoder would cost ~110 MB to do worse on French consultation
text. That recommendation stands unchanged.

### What changed

Two things, neither of which existed when §4b was first written:

1. **Per-language PII models shipped in February 2026**, French among them, ~15 variants. The
   original blocker was that every model was tagged `en` and cross-lingual transfer from an English
   encoder to French clinical text was unvalidated. There is now a French model trained for it.
2. **ONNX builds tagged `webassembly` / `webgpu` shipped in July 2026**, which is what makes
   on-device inference in a PWA possible rather than theoretical.

Also new, and worth tracking rather than adopting: `OpenMed-ClinicalNER-SuperClinical-434M` carries
44 genuinely clinical labels (`Drug_Name`, `Dosage`, `Frequency`, `Duration`, `Symptom`,
`Disease_Syndrome_Disorder`, `Vital_Signs`), which is our extraction domain rather than the
biocuration domain the rest of the collection covers. It is English-only and 434M parameters, so it
is not a candidate to replace the extractor. It is a useful **baseline to measure the rule extractor
against**, which is what `npm run eval` does.

### What we adopted, and why that one

`OpenMed/OpenMed-PII-French-ClinicalE5-Small-33M-v1-onnx-android`, wired in behind `scrubFreeText`
as an optional extra pass (`src/lib/openmed.ts`).

Chosen as the **smallest French PII model that exists**, because every megabyte is a megabyte a
health post downloads over 2G:

| Candidate | fp16 | Tokenizer | Verdict |
|---|---|---|---|
| **`PII-French-ClinicalE5-Small-33M`** | **66.8 MB** | 0.7 MB | **Adopted.** Smallest French option. |
| `PII-French-LiteClinical-Small-66M` | 130.7 MB | 0.7 MB | Twice the size for one more layer of depth. |
| `PII-French-SuperClinical-Small-44M` | 283.4 MB | 8.3 MB | DeBERTa-v2. 566 MB fp32; not a field download. |
| `PII-French-BiomedBERT-Large-340M` | ~680 MB | — | Out of the question on a phone. |

Note that the `int8` export in this family is *larger* than `fp16` (69.6 MB against 66.8 MB),
because the embedding table stays at higher precision. **We take int8 anyway.** The model card is
explicit that `model_int8.onnx` is the "CPU, WebAssembly, and Android default" and `model_fp16.onnx`
is for "WebGPU and compatible accelerated runtimes"; we ship the plain SIMD-threaded ONNX Runtime
core and not the 25 MB `jsep` build, so there is no WebGPU path here at all. Optimising 2.8 MB of
bandwidth onto an unsupported runtime is not a saving.

### What it actually does, measured

First run over the synthetic de-identification corpus and over 1,258 gold-annotated clinical
entities in real French clinical text (E3C), `npm run eval`:

| | deterministic | + OpenMed |
|---|---|---|
| Identifiers **on** the roster | 100% | 100% |
| Identifiers **off** the roster | 0% | **40%** (2/5) |
| Clinical retention, synthetic corpus | 100% | 94.4% |
| Clinical retention, **real** French (E3C, n=1258) | 100% | **97.6%** |
| Clinical retention, **real** English (E3C, n=1014) | 100% | **99.1%** |
| Median latency per field | 0.055 ms | 2.4 ms |

Three findings worth reporting, none of which the synthetic corpus could have produced:

**1. The model destroys diagnoses named after people.** The worst losses on real French were
`lymphome malin non hodgkinien`, `hernie de Spiegel`, `Castleman's disease` and `Henoch-Schönlein
purpura`. Hodgkin, Spiegel, Castleman, Henoch and Schönlein are surnames; the model is correct and
the result is a record missing its diagnosis. Mitigated by `isProtectedSpan` in
`src/lib/openmed.ts`, which vetoes redaction of formulary drugs, a list of eponym stems, and
anything in an eponymous construction (`maladie de X`, `X's disease`) so that eponyms not on the
list are still caught.

**2. It destroys drug names.** `paracétamol` went on the first run. To a NER model a drug name is a
capitalised token of no obvious semantic class, which is what a surname is. The formulary is now a
protected list.

**3. Recall on Malagasy proper nouns is poor.** The two off-roster identifiers it caught were
`Hanta` and `Ambodivona`; it missed `Ramanantsoa`, `Manjakandriana` and `Solofo`. This is a French
clinical model with a 30,522-token **English** WordPiece vocabulary and accent stripping, so
Malagasy names fragment heavily. 40% off-roster recall is a real improvement on 0% and is nowhere
near enough to present as a solved problem.

The honest summary: the pass earns its 70 MB where identifiers are European-shaped, costs measurable
clinical content without the guard, and is weakest exactly where this app is deployed. It stays
optional and off by default.

### Why it is a filter over output, not a step in capture

It runs at **export time only**, over text the deterministic scrub has already processed, and it can
only ever *add* redactions. That ordering is the safety argument:

- If the model is absent, fails to load, or throws, the export is exactly as de-identified as it was
  before. No export path becomes less safe because a download failed.
- A false positive costs one redacted word in a research file. A false negative leaks a name. The
  confidence threshold (0.35) is set low deliberately, in the same direction as the rest of the
  de-identification code: when unsure, remove.
- Nothing model-derived ever reaches a clinician or a dose. A mistake here costs a redaction, not a
  wrong treatment.

`AGE` and `DATE` are excluded from the redactable label set even though the model emits them. Age
drives the WHO/IMCI bands the entire DHIS2 report is disaggregated by, and is already capped at 89
structurally; dates are generalised to the month at the `anonymous` level. Blanking them mid-sentence
would damage the clinical record to remove something the export already handles correctly.

### ⚠️ What is not yet validated

**The model's French recall on our own data has not been measured.** huggingface.co is unreachable
from the environment this was built in, so the weights could not be downloaded, and no inference has
been run against them here.

What *has* been verified, with tests that fail if it stops being true: BIO decoding (including the
orphan `I-` tag that a strict decoder would silently drop, losing a surname), span merging so one
name yields one marker rather than leaking how many name parts there were, label filtering,
thresholding, the interaction with the deterministic pass, and the failure behaviour when the backend
throws.

Before any deployment relies on this, run `npm run vendor:openmed` followed by `npm run eval` on a
held-out set of real notes and record the recall. Until somebody does that, the honest claim is
"wired, tested, and unmeasured", and the deterministic scrub remains what the safety case rests on.

## 5. Licensing summary

| License | Models | NGO deployment | Commercial |
|---|---|---|---|
| Apache-2.0 / MIT / CC-BY-4.0 | `whisper-*`, `badrex/w2v-bert-2.0-malagasy-asr`, `HobyTahiry/whisper-base-malagasy-hoby` | ✅ | ✅ |
| CC-BY-NC-* | MMS family, `misterkissi-*-onnx`, `joeykurek/*` | ✅ (non-commercial) | ❌ |
| AGPL-3.0 | `Flo976/whisper-malagasy-medium` | ❌ avoid | ❌ avoid |
| Apache-2.0 | **OpenMed** (all ~475 NER + PII models) | ✅ | ✅ |

A non-profit NGO deployment plausibly satisfies "non-commercial", so CC-BY-NC models are usable
**for this deployment**, but they permanently foreclose a commercial version. Prefer the
permissive column wherever accuracy allows.

Also note: **AfriSpeech-200 is CC-BY-NC-SA**, and that license propagates to anything fine-tuned on
it. Intron Health's own released checkpoints are Apache-2.0.

---

## 6. Datasets (for later fine-tuning, not v1)

- [`badrex/malagasy-speech-full`](https://hf.co/datasets/badrex/malagasy-speech-full), the main Malagasy ASR corpus; most models above train on it
- [`XedriX/malagasy-nwt-bible`](https://hf.co/datasets/XedriX/malagasy-nwt-bible), 16 kHz aligned read speech
- [`AfriSpeech/open-bible-speech-african`](https://hf.co/datasets/AfriSpeech/open-bible-speech-african), 1,741 h across 19 African languages
- [`michsethowusu/french-malagasy_sentence-pairs`](https://hf.co/datasets/michsethowusu/french-malagasy_sentence-pairs), NLLB-derived, for FR→MG instruction translation
- [`Vatosoa/pos-tagging-malagasy-sokajy`](https://hf.co/datasets/Vatosoa/pos-tagging-malagasy-sokajy), Malagasy morphosyntax

Caveat worth stating plainly: most Malagasy speech data is **read religious text**. It is
acoustically clean, formal, and nothing like a noisy consultation room. Expect real-world
degradation well beyond reported WER.

## 7. Benchmarks to track

- **PazaBench** (Microsoft, Feb 2026), 39 African languages, 51 models. The best single starting point.
- **AfriVox-v2**, in-the-wild conversational African speech, 20+ languages
- **AfriSpeech-MultiBench**, verticalized, includes a medical domain split

Malagasy coverage in all three is thin. If we want a defensible accuracy number for Malagasy
clinical speech, we will likely have to measure it ourselves on a small held-out set.

---

## 8. Decision for v1

```
Manual entry          → always available, zero dependencies      [the substrate]
French voice          → Web Speech API, 0 MB, online             [the accelerator]
Structured extraction → deterministic rules, offline, 0 MB       [the actual magic]
Malagasy output       → pre-rendered Opus phrase bank            [the patient win]
Photo OCR             → Tesseract fra/eng, ~7-9 MB, on demand    [the paper bridge]
```

Nothing in this column requires shipping a neural model in v1. Every model above is an upgrade
path behind an interface, not a launch blocker, which is what keeps the app small enough to
install over a 2G connection.

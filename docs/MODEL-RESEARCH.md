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
| Malagasy handwriting | [`EzraFanantenana/trocr-malagasy-v3`](https://hf.co/EzraFanantenana/trocr-malagasy-v3) | TrOCR fine-tune. Handwriting remains the hardest case; expect heavy correction. |
| Clinical images (wounds, X-ray) | MedGemma 1.5 4B / MedSigLIP 400M | **Server-side only.** Out of scope for v1. |

**Implemented (v0.2):** Tesseract `fra`, LSTM-only WASM core, running fully on-device, the image
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

## 4b. OpenMed (Maziyar Panahi), assessed, partially adopted

[OpenMed](https://huggingface.co/OpenMed) is a large Apache-2.0 collection of medical NER models
(~475 on the Hub, ~29M downloads; [paper](https://huggingface.co/papers/2508.01630)). The licence is
ideal and the engineering is serious. The fit for AfyaCore is narrower than the size of the
collection suggests.

**Most of it is the wrong domain.** The bulk of the models detect genes, proteins, DNA, cell lines,
oncology and species entities, biocuration and research targets. A rural outpatient clinic records
fever, malaria, pneumonia and paracetamol. Only two families map to our domain:

| Model family | Relevance | Blocker |
|---|---|---|
| [`OpenMed-NER-DiseaseDetect-*`](https://hf.co/OpenMed/OpenMed-NER-DiseaseDetect-BioMed-335M) | Diagnoses | Trained on NCBI-Disease, **English PubMed**, not French consultation notes |
| [`OpenMed-NER-PharmaDetect-*`](https://hf.co/OpenMed/OpenMed-NER-PharmaDetect-SuperClinical-434M) | Drug names | Same: English chemical/drug corpora |

**Language is the blocker.** Essentially every model is tagged `en`. Some use XLM-RoBERTa backbones,
so cross-lingual transfer to French is plausible, but it is unvalidated, and an unvalidated model
does not belong between a clinician and a drug name. Replacing our deterministic French extractor
with one would also be a *regression*: rules score ~100% on a bounded formulary at 0 MB, where a
110M-parameter English encoder would cost ~110 MB to do worse on French text.

**What is genuinely worth adopting: PII de-identification.**

[`OpenMed/OpenMed-PII-SuperClinical-Small-44M-v1-onnx-android`](https://hf.co/OpenMed/OpenMed-PII-SuperClinical-Small-44M-v1-onnx-android), 44M DeBERTa-v2, **already quantised to ONNX**, tagged `webassembly` / `webgpu` / `android`,
Apache-2.0. The project reports 55+ PHI types across 34 PII languages.

This addresses a real gap: our FHIR and DHIS2 exports currently carry names, phone numbers and
villages off the device. A de-identified export mode would let a facility share clinical content for
reporting or research without shipping identifiers. At ~45 MB it fits the same download-on-demand
pattern as the OCR pack, and it is a *filter over output* rather than something between the
clinician and the record, so a mistake costs a redaction, not a wrong dose.

**Status:** the de-identified export shipped in v0.4 **without** a model. Because the roster is on
the device, every identifier it holds is matched exactly and removed, 100% recall on the common
case at 0 MB. The OpenMed PII model remains the right upgrade for identifiers we do *not* hold (a
relative named in passing), and slots in behind `scrubFreeText` as an extra pass. It could not be
fetched or validated in this environment, so it is not yet wired in.

**Recommendation**
1. **Do not** replace the French rule extractor with OpenMed NER. English models on French clinical
   text, at 100 MB+, for worse accuracy.
2. **Do** add an opt-in de-identified export backed by the 44M ONNX PII model. Well-scoped,
   permissively licensed, and it closes a genuine privacy gap. Verify its French recall on our own
   data first, the model card says `en`.
3. **Track** the project for French clinical NER. If OpenMed's 21-language claim reaches French
   disease/drug models, revisit, the licence and the on-device packaging are exactly right.

---

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
Photo OCR             → Tesseract fra, ~7 MB, on demand          [the paper bridge]
```

Nothing in this column requires shipping a neural model in v1. Every model above is an upgrade
path behind an interface, not a launch blocker, which is what keeps the app small enough to
install over a 2G connection.

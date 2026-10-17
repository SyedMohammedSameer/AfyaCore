# Speech model on a low-end phone

Reviewer sMLC: *"the tool targets low-end shared phones, but the paper reports no speed or
memory results on such a phone."* `bench.html` produces those numbers on the phone itself,
with the model files, runtime and settings the app uses.

## What it measures

| Number | How | What it means for a clinician |
|---|---|---|
| **Model load, cached** | A fresh worker per load, timed from creation until the model is ready. Model files already on the device. Median of the loads. | The wait each time the app is reopened before the first dictation can be transcribed. |
| **Model load, first download** | The same, on a load where the model files were not yet cached. | Network-bound. Reported, but not a property of the phone. |
| **First inference** | First transcription after loading, reported separately. | The extra cost of the first dictation. |
| **Real-time factor (RTF)** | Inference time ÷ audio duration, over all timed passes. | Below 1, transcription keeps up with speech. Above 1, segments queue and text falls behind. |
| **Time per segment** | Inference time for each segment the app's own `Segmenter` cuts from the audio. Median, p90 and max. | How long text takes to appear after the clinician pauses. |
| **Peak model memory** | Size of ONNX Runtime's WebAssembly heap, read from the runtime's own `WebAssembly.Memory`. | The model's working memory. See the caveats. |

Same code path as the app. The page loads Whisper through `src/lib/whisperPipeline.ts`, which
the dictation worker also uses: Whisper base, int8 (`q8`), the WebAssembly device, greedy
decoding. Audio goes through the app's own `resample` and `Segmenter`. The page is not
cross-origin isolated, and neither is the app, so ONNX Runtime runs on **one thread** in both.

Audio: the four bundled samples (two synthetic-voice consultations of 14–16 s, two dictation
samples of 21–22 s, French and English). Speed depends on audio length and decoded tokens, not
on who is speaking, so synthetic voices are fine for timing. They say nothing about accuracy.

## Running it

### 1. Pick the phones

At least one phone of the kind the paper targets: entry-level Android with 2–3 GB of RAM, for
example an entry-level Tecno, Itel, Infinix or Samsung Galaxy A0x. Write down from the
spec sheet (not from the page): model, RAM, chipset, Android version, and approximate price.
A mid-range phone as a second point helps the reader place the number.

The page reports the handset model and Chrome version from client hints. The memory figure it
shows is the browser's rounded hint, not the real RAM.

### 2. Open the page

Use Chrome on the phone. Either:

- **Deployed:** `https://afya-core.netlify.app/bench.html`, once this change is deployed.
- **From a laptop over USB**, without deploying:

  ```bash
  npm run build && npx vite preview --port 4173
  ```

  ```bash
  adb reverse tcp:4173 tcp:4173
  ```

  Then open `http://localhost:4173/bench.html` on the phone. Use `adb reverse`, not the laptop's
  LAN address: `http://192.168.…` is not a secure context, so the browser turns off the Cache
  API and the wake lock, and every load would re-download the model.

### 3. Prepare the phone

Charge it above 50% and leave it plugged in. Close other apps. Let it cool if it is warm. The
page holds a screen wake lock during the run. If it says it could not, set the screen timeout to
its maximum.

### 4. Run

1. **Warm-up run:** set loads 1 and passes 1, then press Run. This downloads the ~80 MB model into
   the phone's cache (it is the "first download" figure) and shows whether the model loads
   at all.
2. **Measurement run:** reload the page and run with the defaults (3 loads, 3 passes, all four
   clips). A low-end phone may need around ten minutes. Keep the tab in front. The results say
   if the tab was hidden or the phone was on battery.
3. Run the measurement a second time to check the numbers are stable. If the second run is
   clearly slower, the phone is throttling from heat; say so when reporting.

Press **Download JSON** (or Copy JSON) and keep the file. It contains every load, every pass,
every segment timing, the transcripts, and the device details.

**If the tab crashes** during loading (Chrome's "Aw, Snap!" page, or the page reloads by itself),
the phone ran out of memory for the model. That is a result: record the phone and that it
could not load the model.

### 5. Optional: whole-process memory

The page only sees the model's WebAssembly heap. To see everything Chrome's renderer is using,
connect over USB and, while a pass is running:

```bash
adb shell dumpsys meminfo | grep -i sandboxed
```

Take the largest `sandboxed_process` PSS figure. That covers the whole renderer, including
the page, the worker and the runtime.

## Caveats to state when reporting

- **The heap figure is an upper bound.** WebAssembly memory only grows, so its size is its peak.
  But ONNX Runtime grows the heap by up to 20% more than each allocation needs, and pages it
  never touches use no physical RAM. Actual peak use is between about 0.83× and 1× the figure.
- **The load-time copy of the model files is not in it.** While loading, the ~77 MB of model files
  also sit briefly in the worker's JavaScript heap, which no browser API reports from a worker.
  Use `dumpsys` (step 5) for the total.
- **Single-threaded.** This is what the app does today. Making the app cross-origin isolated
  would let ONNX Runtime use several cores. That is a possible speed-up, not what is measured
  here.
- **Synthetic audio.** It is fine for timing and says nothing about accuracy on real speech.

## Reference point

A 14-core Apple Silicon Mac in Chromium 152, measured while building the page (preview build,
2 loads, 1 pass): cached load 0.6–0.8 s, RTF 0.13 (per clip 0.11–0.17), about 2.4 s per segment
for 14–22 s segments, peak heap 632 MB, one thread. A low-end phone will be many times slower.
How many times slower is the result this page is for.

The 632 MB heap is large next to 77 MB of int8 weights. A likely cause is the
`disable_quant_qdq` workaround in `whisperPipeline.ts`: it keeps the graph's `DequantizeLinear`
nodes, so the runtime may store dequantized float32 copies of the weights. This has not been
checked yet. If a 2 GB phone cannot load the model, check this first.

## Reporting it

One sentence for the paper or the rebuttal, filled from `summary` in the JSON:

> On a *‹model›* (*‹RAM›* GB RAM, *‹chipset›*, Android *‹n›*, Chrome *‹v›*), the speech model
> loads from cache in *‹warmLoadMs.median›* s and transcribes at a real-time factor of
> *‹rtf›* (single-threaded WebAssembly), with text appearing a median *‹segmentMs.median›* s
> after each pause; the runtime's heap peaks at *‹peakWasmHeapMb›* MB.

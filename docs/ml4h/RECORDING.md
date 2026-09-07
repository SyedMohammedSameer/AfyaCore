# Recording the ML4H demo video

    npm run vendor:whisper       # required for the dictation beat
    npm run vendor:ocr
    npm run build
    npx vite preview --port 4173     # leave running
    npm run record:demo -- --audio path/to/dictation.wav

Produces `docs/ml4h/demo-recording.webm`: the production build, driven in a
real browser and captured continuously. No compositing, no speed-up, and the
pauses where the app is working are left in, because those pauses are the
evidence the call for demonstrations is asking for.

## The one thing that cannot be automated

Speech. `--audio` hands Chrome a WAV file in place of a microphone, so
`getUserMedia` returns your recording and Whisper transcribes it on the device
exactly as it would a live clinician. Record roughly ten seconds of:

> Température trente-huit virgule neuf, pouls quatre-vingt-seize, tension onze
> sur sept. Diagnostic paludisme simple.

Any phone voice memo works; convert to WAV (16 kHz mono is ideal). Without
`--audio` the script **skips** the dictation beat rather than faking it: a
simulated transcript in a video submitted as evidence that the system works
would be a lie, and it is the beat the whole submission rests on.

## Why this cannot be produced in a cloud session

`huggingface.co` returns 403 through the sandbox's egress proxy, so neither
Whisper nor OpenMed can be vendored there. Run this on your own machine, where
both models download normally.

## Output format

WebM/VP8. The only ffmpeg available here is Playwright's, built
`--disable-everything` with one video encoder (`libvpx`) and one image input
path (`image2pipe` + `mjpeg`) — there is no h264 encoder to make an MP4 with.
Every editor and every upload target transcodes anyway, and adding the
voice-over will re-export it regardless.

If your editor refuses WebM, re-encode with any local ffmpeg:

    ffmpeg -i docs/ml4h/demo-recording.webm -c:v libx264 -crf 20 demo.mp4

## After recording

1. Add the voice-over from `VIDEO-SCRIPT.md`.
2. Keep it under 2:00. The script is timed to 1:50.
3. Upload unlisted, paste the link into the OpenReview form.

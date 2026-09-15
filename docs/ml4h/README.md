# ML4H 2026 Demo Track submission

Two artefacts are required: a spec sheet (max 2 pages, excluding references)
and a demo video (max 2 minutes, with a voice-over).

## Spec sheet: two ways to build it

**Preferred.** Open the official ML4H 2026 template, set `\mlhtrack{demo}`,
and paste the body of `spec-sheet.tex` into it. Do not anonymise: the track is
single blind. Fill in your affiliation in the template's author block; the name
and email are already written in a comment there.

**If the template will not compile.** Use `standalone-main.tex` as the whole
document. The body is already in it, it depends only on packages every TeX
installation carries, and it compiles to two pages in total. It loses the ML4H
class styling, which reviewers do not score.

## Verified length

Compiled here, not estimated. Against `jmlr.cls`, which the ML4H template
derives from:

| Build | Pages | Page 3 |
|---|---|---|
| ML4H class (jmlr) | body ends on page 2 | three reference entries only |
| `standalone-main.tex` (article) | 2 total | none |

The call allows two pages **excluding references**, so references sitting on a
third page is within the rule. If you want no third page at all, use
`standalone-main.tex`, which fits everything in two.

Adding roughly 160 words to the body pushes the jmlr build's text onto page 3.
Recompile if you edit.

## Why the references are written out inline

`\bibliography{refs}` needs `refs.bib` to be present. When TeX cannot find a
file it aborts with "Emergency stop ... file error in nonstop mode" and writes
no PDF, which is what happened on the first attempt. The three references are
now inside the document, so it opens no external file and needs no BibTeX pass.

## The rest

- `openreview-fields.md`: title, keywords, TL;DR and abstract for the form.
  The abstract there is word for word the one in the sheet.
- `VIDEO-SCRIPT.md`: the shot list and narration, timed to 1:50.
- `RECORDING.md`: how to record it, including the fake-microphone flag that
  lets Whisper transcribe a supplied WAV on the device.

## Still open

The submission form has no field for the video link, and a submission without a
working link is desk-rejected. Confirm with info@ml4h.cc where it goes.

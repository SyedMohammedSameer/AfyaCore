# Contributing

Thanks for looking. AfyaCore is a prototype for a real problem, and the most
useful contributions are usually the ones that make it *less* clever rather than
more.

## Getting set up

Node 22 or newer is required, because the sync server uses `node:sqlite`, which
does not exist before it.

```bash
npm install
npm run dev          # app on :5173
npm run sync         # sync server on :8787, optional
```

Then load `Settings → Load demo workspace` for synthetic patients to click
through. There is no account and no backend to configure.

```bash
npm test             # vitest, watch with npm run test:watch
npm run typecheck    # tsc --noEmit
npm run build        # vendor OCR + typecheck + production build
npm run screenshots  # regenerate README images (needs a running preview)
```

CI runs typecheck, tests and a production build. All three must pass.

## Never commit real patient data

Not in tests, not in fixtures, not in screenshots, not in an issue, not in a bug
report. `src/db/seed.ts` contains synthetic names and plausible clinical content
for the Malagasy highlands; use it, extend it, and keep everything else out.

If you attach a screenshot to an issue, take it against the demo workspace.

## What makes a good change here

This project has a few opinions that are load-bearing. A change that violates one
of them needs to argue the case in the PR, not just pass CI.

- **The device is the source of truth.** Nothing may put the network on the
  critical path of recording a consultation.
- **Nothing machine-derived is saved without a human confirming it.** Encounters
  start as `draft`; only the review screen promotes one to `final`.
- **Extraction never overwrites typed input.** If a clinician entered a value,
  dictation or OCR must not replace it.
- **Nothing is diagnostic.** Vital colouring is a fixed threshold table. The app
  does not suggest, infer or decide anything clinical, and it should not start.
- **Weight is a feature.** The initial load is ~135 kB gzipped because a facility
  may be installing over 2G. A dependency that adds more than it earns will be
  questioned, and "we could just write it" is usually the answer.

## Code style

There is no linter, deliberately. Match the surrounding code instead.

- Comments explain **why**, not what. If a line needs a comment to say what it
  does, rename something instead. The existing comments are the house style:
  they mostly document a decision and the alternative that was rejected.
- Everything user-visible goes through `src/i18n/strings.ts`, in all three
  languages. A hardcoded English string is a bug.
- Tests run in Node with no DOM. If logic needs IndexedDB, factor the judgement
  into a pure function and test that, as `mergeFields` does.
- Prefer a deterministic rule over a model, and a small explicit table over a
  clever abstraction. The extractor is rules for exactly this reason.

## Malagasy

⚠️ The Malagasy strings are an unreviewed draft. If you are a native speaker,
reviewing `src/i18n/strings.ts` and the dosage wording in `src/lib/format.ts` is
the single highest-value contribution available, and more useful than any
feature. Wrong dosage wording is a safety issue, not a polish issue.

## Pull requests

- Branch from `main`, keep the change focused, and say what you decided *not* to
  do and why.
- Update the README if you changed behaviour it describes. The dictation examples
  in it are asserted by tests, so if you change the extractor, those fail first.
- Do not bump the version. Releases are cut deliberately.

## Reporting bugs

Include what you did, what you expected, what happened, and the browser and
device. If it involves a record, describe it rather than pasting it.

Security problems go to [SECURITY.md](SECURITY.md), not the issue tracker.

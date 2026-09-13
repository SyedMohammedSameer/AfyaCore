/**
 * Extraction scoring, shared by the text harness and the speech harness.
 *
 * One scorer, imported by both, so the number reported for "extraction from
 * a clean transcript" and the number reported for "extraction from what the
 * speech model actually heard" are computed by the same code. Two similar
 * loops are how a comparison ends up measuring two different things.
 */

export const normalise = (s) =>
  String(s)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()

/**
 * Score one extraction case field by field.
 *
 * Counted as a micro-average over atomic facts (each vital, each prescription
 * attribute, complaint, diagnosis) rather than per case. A case-level
 * "correct/incorrect" would let one missed duration mark an otherwise perfect
 * consultation as a failure, which tells a reader nothing about where the
 * extractor is weak.
 */
export function scoreExtraction(expected, actual) {
  let tp = 0
  let fp = 0
  let fn = 0
  const misses = []

  const compare = (key, want, got) => {
    if (want === undefined && got === undefined) return
    if (want === undefined) {
      fp++
      misses.push(`+${key}=${got}`)
      return
    }
    if (got === undefined) {
      fn++
      misses.push(`-${key}`)
      return
    }
    if (typeof want === 'number' ? Math.abs(want - got) < 1e-6 : normalise(want) === normalise(got)) {
      tp++
    } else {
      // A wrong value is both a miss and a spurious answer. Counting it only as
      // a miss would let a confidently wrong extractor look merely incomplete.
      fp++
      fn++
      misses.push(`~${key}: want ${want}, got ${got}`)
    }
  }

  const wantVitals = expected.vitals ?? {}
  const gotVitals = actual.vitals ?? {}
  for (const key of new Set([...Object.keys(wantVitals), ...Object.keys(gotVitals)])) {
    compare(`vitals.${key}`, wantVitals[key], gotVitals[key]?.value)
  }

  compare('chiefComplaint', expected.chiefComplaint, actual.chiefComplaint?.value)
  compare('diagnosis', expected.diagnosis, actual.diagnosis?.value)

  const wantRx = expected.prescriptions ?? []
  const gotRx = actual.prescriptions ?? []
  for (let i = 0; i < Math.max(wantRx.length, gotRx.length); i++) {
    const want = wantRx[i]
    const got = gotRx[i]
    if (!want) {
      fp++
      misses.push(`+rx[${i}]=${got?.drug}`)
      continue
    }
    if (!got) {
      fn++
      misses.push(`-rx[${i}]=${want.drug}`)
      continue
    }
    for (const attr of ['drug', 'dose', 'frequencyPerDay', 'durationDays']) {
      compare(`rx[${i}].${attr}`, want[attr], got[attr])
    }
  }

  return { tp, fp, fn, misses }
}

export function prf(tp, fp, fn) {
  const precision = tp + fp === 0 ? 1 : tp / (tp + fp)
  const recall = tp + fn === 0 ? 1 : tp / (tp + fn)
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall)
  return {
    tp,
    fp,
    fn,
    precision: Number(precision.toFixed(4)),
    recall: Number(recall.toFixed(4)),
    f1: Number(f1.toFixed(4)),
  }
}

/**
 * Word error rate, the standard Levenshtein distance over tokens divided by
 * the reference length. Tokens are accent-folded and lowercased and
 * punctuation is dropped, because a comma is not a clinical fact.
 *
 * Deliberately NOT numeral-aware. Whisper writes "38,5" where the reference
 * says "trente-huit virgule cinq", and the two are scored as three errors
 * even though they mean the same thing. The raw rate is reported as the
 * conservative number; the field-level score alongside it is the one that
 * says whether the meaning survived.
 */
export function wordErrorRate(reference, hypothesis) {
  const tokens = (s) =>
    normalise(s)
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .split(/\s+/)
      .filter(Boolean)
  const ref = tokens(reference)
  const hyp = tokens(hypothesis)
  if (ref.length === 0) return { errors: hyp.length, words: 0, wer: hyp.length === 0 ? 0 : 1 }

  let previous = Array.from({ length: hyp.length + 1 }, (_, j) => j)
  for (let i = 1; i <= ref.length; i++) {
    const current = [i]
    for (let j = 1; j <= hyp.length; j++) {
      const substitution = previous[j - 1] + (ref[i - 1] === hyp[j - 1] ? 0 : 1)
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, substitution)
    }
    previous = current
  }
  const errors = previous[hyp.length]
  return { errors, words: ref.length, wer: Number((errors / ref.length).toFixed(4)) }
}

/**
 * The extractor's output cut the way a clinician reviews it.
 *
 * The review screen shows one row, with one tick, per provenance key: each
 * vital, the complaint, the diagnosis, and each prescription as a whole. This
 * returns exactly those units, each with the confidence the extractor gave it
 * and whether it actually matches the reference, so the question "does the
 * *Check this* flag predict a wrong value" can be answered with a number
 * rather than asserted.
 *
 * Only fields the extractor *produced* are here. A field it missed entirely
 * has no row on the review screen and no flag to be right or wrong about;
 * missing values are a recall problem, measured separately by `scoreExtraction`.
 *
 * A prescription counts as correct only when every attribute the reference
 * names for it matches, because one tick approves the whole line: a clinician
 * who confirms "artemether lumefantrine, twice a day, three days" has approved
 * the duration as much as the drug.
 */
export function reviewUnits(expected, actual) {
  const units = []

  for (const [key, field] of Object.entries(actual.vitals ?? {})) {
    const want = expected.vitals?.[key]
    units.push({
      key: `vitals.${key}`,
      confidence: field.confidence,
      correct: want !== undefined && Math.abs(want - field.value) < 1e-6,
      got: field.value,
      want,
    })
  }

  for (const key of ['chiefComplaint', 'diagnosis']) {
    const field = actual[key]
    if (!field) continue
    const want = expected[key]
    units.push({
      key,
      confidence: field.confidence,
      correct: want !== undefined && normalise(want) === normalise(field.value),
      got: field.value,
      want,
    })
  }

  // Aligned by order, the same way `scoreExtraction` aligns them.
  const wantRx = expected.prescriptions ?? []
  for (const [i, got] of (actual.prescriptions ?? []).entries()) {
    const want = wantRx[i]
    const attributes = ['drug', 'dose', 'frequencyPerDay', 'durationDays']
    const correct =
      want !== undefined &&
      attributes.every((attribute) => {
        const a = want[attribute]
        const b = got[attribute]
        if (a === undefined) return true
        if (b === undefined) return false
        return typeof a === 'number' ? Math.abs(a - b) < 1e-6 : normalise(a) === normalise(b)
      })
    units.push({
      key: `prescription.${i}`,
      confidence: got.confidence,
      correct,
      got: got.drug,
      want: want?.drug,
    })
  }

  return units
}

/**
 * Whether the app's uncertainty flag separates its wrong answers from its
 * right ones, at the threshold the app actually uses.
 *
 * `src/components/VitalsGrid.tsx` labels a field *Check this* when its
 * confidence is below 0.8, and the review screen sorts those to the top. That
 * threshold has never been checked against outcomes. The numbers below are the
 * check, and they are reported whichever way they come out: a flag that does
 * not discriminate is an argument for reviewing every machine value, which is
 * what the app requires, and it is worth more as a measured finding than as an
 * assumption in either direction.
 *
 * `catchRate` is the share of wrong values a clinician would find if they read
 * only the flagged rows; `burden` is the share of rows that asks them to read.
 * The pair is the trade-off, and neither number means anything alone.
 */
export function flagAnalysis(units, threshold) {
  if (typeof threshold !== 'number') throw new Error('flagAnalysis needs the app\'s threshold')
  const flagged = units.filter((u) => (u.confidence ?? 1) < threshold)
  const unflagged = units.filter((u) => (u.confidence ?? 1) >= threshold)
  const wrong = units.filter((u) => !u.correct)
  const rate = (subset) => (subset.length === 0 ? null : subset.filter((u) => !u.correct).length / subset.length)

  return {
    threshold,
    units: units.length,
    wrong: wrong.length,
    flagged: flagged.length,
    unflagged: unflagged.length,
    /** Error rate inside each bucket. The flag works if the first exceeds the second. */
    errorRateFlagged: round(rate(flagged)),
    errorRateUnflagged: round(rate(unflagged)),
    /** Wrong values a reviewer reading only flagged rows would reach. */
    catchRate: wrong.length === 0 ? null : round(flagged.filter((u) => !u.correct).length / wrong.length),
    /** Rows that reviewer would have to read. */
    burden: units.length === 0 ? null : round(flagged.length / units.length),
    /** Wrong values carrying no flag at all: what "check the flagged ones" misses. */
    unflaggedErrors: unflagged.filter((u) => !u.correct).map((u) => u.key),
  }
}

const round = (value) => (value === null ? null : Number(value.toFixed(4)))

/** Error rate per confidence value, so a reader can judge another threshold. */
export function confidenceBuckets(units) {
  const buckets = new Map()
  for (const unit of units) {
    const key = (unit.confidence ?? 1).toFixed(2)
    const bucket = buckets.get(key) ?? { confidence: Number(key), total: 0, wrong: 0 }
    bucket.total++
    if (!unit.correct) bucket.wrong++
    buckets.set(key, bucket)
  }
  return [...buckets.values()]
    .sort((a, b) => a.confidence - b.confidence)
    .map((b) => ({ ...b, errorRate: round(b.wrong / b.total) }))
}

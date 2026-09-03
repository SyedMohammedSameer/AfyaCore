/**
 * Scoring against E3C, real clinical narrative we did not write.
 *
 * See `scripts/vendor-e3c.mjs` for what this corpus is, what it can measure,
 * and why it is fetched rather than committed.
 *
 * The one measurement here is **clinical entity retention**: of the spans E3C
 * annotators marked as clinical entities, how many survive a scrub. It is the
 * honest counterpart to recall. Our own corpus checks retention against a
 * `mustKeep` list we wrote, which cannot catch the terms we failed to think
 * of; these are gold annotations by people who had never heard of this app.
 */

/**
 * Recover character offsets for each token.
 *
 * E3C ships tokens and per-token tags but no offsets, so they have to be
 * aligned back onto the text. Greedy forward search rather than cumulative
 * length arithmetic: the tokeniser splits French elision as `d` + `'effort`
 * and separates punctuation, so token lengths do not sum to the text and any
 * offset computed by addition drifts and then silently mislabels every
 * subsequent span.
 *
 * A token that cannot be found is skipped and the cursor left where it was,
 * which loses that span rather than corrupting the ones after it.
 */
export function alignTokens(text, tokens) {
  const spans = []
  let cursor = 0
  for (const token of tokens) {
    const at = text.indexOf(token, cursor)
    if (at === -1) {
      spans.push(null)
      continue
    }
    spans.push([at, at + token.length])
    cursor = at + token.length
  }
  return spans
}

/**
 * Merge BIO-tagged tokens into entity spans.
 *
 * `1` is B-CLINENTITY and `2` is I-CLINENTITY in this config; anything else is
 * outside. An `I` with no preceding `B` opens a span rather than being
 * dropped, matching `decodeBio` in src/lib/openmed.ts and for the same reason:
 * silently discarding a malformed span understates the corpus.
 */
export function goldEntities(text, tokens, nerTags) {
  const offsets = alignTokens(text, tokens)
  const entities = []
  let current = null

  const flush = () => {
    if (current) entities.push(current)
    current = null
  }

  for (let i = 0; i < tokens.length; i++) {
    const tag = nerTags[i]
    const span = offsets[i]
    if (tag !== 1 && tag !== 2) {
      flush()
      continue
    }
    if (!span) continue
    if (tag === 1 || !current) {
      flush()
      current = [span[0], span[1]]
    } else {
      current[1] = span[1]
    }
  }
  flush()

  return entities.map(([start, end]) => text.slice(start, end)).filter((s) => s.trim().length > 0)
}

/**
 * Score one scrubbing strategy over an E3C split.
 *
 * `scrub` takes the sentence and returns the scrubbed sentence. Retention is
 * measured by surface form rather than by offset, because a scrub changes the
 * string's length and re-aligning against a shifted string would measure the
 * alignment code rather than the scrubber.
 */
export async function scoreE3C(rows, scrub) {
  let kept = 0
  let total = 0
  const destroyed = new Map()
  const timings = []

  for (const row of rows) {
    const gold = goldEntities(row.text, row.tokens, row.nerTags)
    if (gold.length === 0) continue

    const started = performance.now()
    const out = await scrub(row.text)
    timings.push(performance.now() - started)

    for (const entity of gold) {
      total++
      if (out.includes(entity)) kept++
      else destroyed.set(entity, (destroyed.get(entity) ?? 0) + 1)
    }
  }

  timings.sort((a, b) => a - b)

  return {
    retention: total === 0 ? null : Number((kept / total).toFixed(4)),
    kept,
    total,
    sentences: timings.length,
    medianMs: timings.length ? Number(timings[Math.floor(timings.length / 2)].toFixed(3)) : null,
    // The most-destroyed terms, which is the actionable output: a scrubber
    // eating "paludisme" is a different problem from one eating a place name.
    worst: [...destroyed.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([term, count]) => ({ term, count })),
  }
}

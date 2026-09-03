/**
 * Token alignment and BIO decoding for the E3C scorer.
 *
 * The fixtures here are synthetic, written to have the same *shape* as E3C
 * rows rather than being copied from the corpus: the licence could not be
 * established from a primary source (see scripts/vendor-e3c.mjs), so no
 * corpus text is committed, not even a handful of sentences.
 *
 * The shapes that matter are all reproduced, because they are what breaks
 * naive alignment:
 *
 *   - French elision split across two tokens (`d` + `'effort`)
 *   - punctuation as its own token
 *   - a single-letter token that also occurs earlier inside another word
 *   - an `I-` tag opening a span with no preceding `B-`
 *
 * Verified against real E3C rows during development: 71 tokens across two
 * sentences aligned with zero failures, and the recovered spans matched the
 * annotations exactly, including `dyspnée d'effort`.
 */
import { describe, expect, it } from 'vitest'
import { alignTokens, goldEntities, scoreE3C } from './e3c.mjs'

const O = 0
const B = 1
const I = 2

describe('alignTokens', () => {
  it('aligns every token of a sentence with elision and punctuation', () => {
    const text = "une dyspnée d'effort et des douleurs thoraciques."
    const tokens = ['une', 'dyspnée', 'd', "'effort", 'et', 'des', 'douleurs', 'thoraciques', '.']
    const spans = alignTokens(text, tokens)

    expect(spans.filter((s) => s === null)).toHaveLength(0)
    for (let i = 0; i < tokens.length; i++) {
      expect(text.slice(spans[i][0], spans[i][1])).toBe(tokens[i])
    }
  })

  it('does not match a single-letter token inside an earlier word', () => {
    // The trap that makes cumulative-length arithmetic and naive indexOf
    // both wrong: `a` appears inside `patient` long before the standalone
    // verb. Alignment must move forward with the cursor, never restart.
    const text = 'le patient a présenté une toux'
    const tokens = ['le', 'patient', 'a', 'présenté', 'une', 'toux']
    const spans = alignTokens(text, tokens)

    expect(spans[2][0]).toBe(text.indexOf(' a ') + 1)
    expect(text.slice(spans[3][0], spans[3][1])).toBe('présenté')
  })

  it('skips a token that is not present rather than corrupting the rest', () => {
    const text = 'toux sèche productive'
    const tokens = ['toux', 'ABSENT', 'sèche', 'productive']
    const spans = alignTokens(text, tokens)

    expect(spans[1]).toBeNull()
    expect(text.slice(spans[2][0], spans[2][1])).toBe('sèche')
    expect(text.slice(spans[3][0], spans[3][1])).toBe('productive')
  })
})

describe('goldEntities', () => {
  it('joins a multi-token entity across an elision', () => {
    const text = "une dyspnée d'effort évoluant"
    const tokens = ['une', 'dyspnée', 'd', "'effort", 'évoluant']
    expect(goldEntities(text, tokens, [O, B, I, I, O])).toEqual(["dyspnée d'effort"])
  })

  it('recovers several entities from one sentence', () => {
    const text = 'toux sèche sans hémoptysies avec douleurs thoraciques'
    const tokens = ['toux', 'sèche', 'sans', 'hémoptysies', 'avec', 'douleurs', 'thoraciques']
    expect(goldEntities(text, tokens, [B, I, O, B, O, B, I])).toEqual([
      'toux sèche',
      'hémoptysies',
      'douleurs thoraciques',
    ])
  })

  it('opens a span on an orphan I- tag rather than dropping it', () => {
    // Matches decodeBio in src/lib/openmed.ts, and for the same reason:
    // silently discarding a malformed span understates the corpus, which
    // flatters the retention score.
    const text = 'une fièvre persistante'
    expect(goldEntities(text, ['une', 'fièvre', 'persistante'], [O, I, I])).toEqual([
      'fièvre persistante',
    ])
  })

  it('returns nothing when the sentence carries no clinical entity', () => {
    const text = 'le patient a été admis.'
    expect(goldEntities(text, ['le', 'patient', 'a', 'été', 'admis', '.'], [O, O, O, O, O, O])).toEqual(
      [],
    )
  })
})

describe('scoreE3C', () => {
  const rows = [
    {
      id: '1',
      text: 'toux sèche sans hémoptysies',
      tokens: ['toux', 'sèche', 'sans', 'hémoptysies'],
      nerTags: [B, I, O, B],
    },
    {
      id: '2',
      // No entities: must not count toward the denominator, or a corpus of
      // mostly-unannotated sentences would inflate retention toward 100%.
      text: 'le patient a été admis',
      tokens: ['le', 'patient', 'a', 'été', 'admis'],
      nerTags: [O, O, O, O, O],
    },
  ]

  it('scores full retention when nothing is redacted', async () => {
    const result = await scoreE3C(rows, (t) => t)
    expect(result).toMatchObject({ retention: 1, kept: 2, total: 2, sentences: 1 })
    expect(result.worst).toEqual([])
  })

  it('counts and names destroyed entities', async () => {
    const result = await scoreE3C(rows, (t) => t.replace('hémoptysies', '[…]'))
    expect(result).toMatchObject({ retention: 0.5, kept: 1, total: 2 })
    expect(result.worst).toEqual([{ term: 'hémoptysies', count: 1 }])
  })

  it('scores zero when everything is redacted', async () => {
    // The scrubber that redacts every word: perfect recall, useless output.
    // This is the number that catches it.
    const result = await scoreE3C(rows, () => '[…]')
    expect(result.retention).toBe(0)
  })
})

/**
 * Tests for the neural de-identification pass.
 *
 * The backend is injected, so everything here runs with no model weights: BIO
 * decoding, span merging, label filtering, thresholding and the interaction
 * with the deterministic scrub. That is deliberate, and it is where the bugs
 * actually are. The model itself is somebody else's tested artefact; the
 * failure modes we own are "two adjacent name tokens became two markers" and
 * "an I- tag with no B- before it was silently dropped and a surname survived".
 */
import { describe, expect, it } from 'vitest'
import { REDACTABLE_LABELS, alignTokenOffsets, applyEntities, decodeBio, isModelAvailable, isProtectedSpan, mergeSpans, normaliseForAlignment, type NerEntity } from './openmed'
import { deidentify, REDACTED } from './deidentify'
import type { Encounter, Patient } from '../db/schema'

const at = (label: string, start: number, end: number, score = 0.9): NerEntity => ({
  label,
  start,
  end,
  score,
})

describe('BIO decoding', () => {
  it('joins a B- tag and the I- tags that follow it', () => {
    const entities = decodeBio([
      { label: 'B-FIRSTNAME', start: 0, end: 4, score: 0.9 },
      { label: 'I-FIRSTNAME', start: 5, end: 12, score: 0.8 },
      { label: 'O', start: 13, end: 16, score: 0.99 },
    ])
    expect(entities).toHaveLength(1)
    expect(entities[0]).toMatchObject({ label: 'FIRSTNAME', start: 0, end: 12 })
  })

  it('scores a span by its weakest token', () => {
    // A span is only as trustworthy as its least certain part; taking the max
    // would let one confident token drag an uncertain one over the threshold.
    const [entity] = decodeBio([
      { label: 'B-LASTNAME', start: 0, end: 4, score: 0.95 },
      { label: 'I-LASTNAME', start: 5, end: 9, score: 0.4 },
    ])
    expect(entity!.score).toBeCloseTo(0.4)
  })

  it('treats an orphan I- tag as the start of an entity', () => {
    // A strict decoder drops this. Dropping it means silently not redacting a
    // surname, which is the one failure this module exists to prevent.
    const entities = decodeBio([{ label: 'I-LASTNAME', start: 0, end: 6, score: 0.8 }])
    expect(entities).toHaveLength(1)
    expect(entities[0]!.label).toBe('LASTNAME')
  })

  it('splits when the label changes without an O between', () => {
    const entities = decodeBio([
      { label: 'B-FIRSTNAME', start: 0, end: 4, score: 0.9 },
      { label: 'I-LASTNAME', start: 5, end: 11, score: 0.9 },
    ])
    expect(entities.map((e) => e.label)).toEqual(['FIRSTNAME', 'LASTNAME'])
  })

  it('handles the single-token U-/S- prefixes some taggers emit', () => {
    const entities = decodeBio([
      { label: 'U-CITY', start: 0, end: 5, score: 0.9 },
      { label: 'S-CITY', start: 6, end: 11, score: 0.9 },
    ])
    expect(entities).toHaveLength(2)
  })
})

describe('span merging', () => {
  it('joins name parts separated only by a space', () => {
    const text = 'Jean Baptiste Rakoto est venu'
    const spans = mergeSpans([at('FIRSTNAME', 0, 4), at('FIRSTNAME', 5, 13), at('LASTNAME', 14, 20)], text)
    expect(spans).toEqual([[0, 20]])
  })

  it('joins across a hyphen or apostrophe', () => {
    const text = "Marie-Claire d'Ambohimanga"
    const spans = mergeSpans([at('FIRSTNAME', 0, 5), at('FIRSTNAME', 6, 12)], text)
    expect(spans).toEqual([[0, 12]])
  })

  it('keeps entities separated by real words apart', () => {
    const text = 'Rakoto a vu Hanta'
    const spans = mergeSpans([at('LASTNAME', 0, 6), at('FIRSTNAME', 12, 17)], text)
    expect(spans).toEqual([
      [0, 6],
      [12, 17],
    ])
  })

  it('collapses overlapping spans', () => {
    const text = 'Rakotoarisoa'
    expect(mergeSpans([at('LASTNAME', 0, 6), at('LASTNAME', 3, 12)], text)).toEqual([[0, 12]])
  })
})

describe('applying entities', () => {
  it('redacts a name the roster never held', () => {
    // The whole reason the model earns its 67 MB: "sa fille Hanta" is a real
    // identifier and no roster lookup will ever find it.
    const text = 'Vue avec sa fille Hanta ce matin'
    const { text: out, redactions } = applyEntities(text, [at('FIRSTNAME', 18, 23)])
    expect(out).toBe('Vue avec sa fille […] ce matin')
    expect(redactions).toBe(1)
  })

  it('produces one marker per name, not one per token', () => {
    const text = 'Adressé par Dr Jean Rakoto'
    const { text: out } = applyEntities(text, [
      at('PREFIX', 12, 14),
      at('FIRSTNAME', 15, 19),
      at('LASTNAME', 20, 26),
    ])
    // Three markers would leak how many name parts there were.
    expect(out).toBe('Adressé par […]')
    expect(out.match(/\[…\]/g)).toHaveLength(1)
  })

  it('ignores entity types that are not identifying here', () => {
    // A rural outpatient note has no Bitcoin address, and redacting on those
    // labels only adds ways to destroy clinical content.
    const text = 'paludisme simple confirmé'
    const { text: out, redactions } = applyEntities(text, [at('BITCOINADDRESS', 0, 9)])
    expect(out).toBe(text)
    expect(redactions).toBe(0)
  })

  it('leaves age alone, because age is clinical content', () => {
    // Age drives the WHO/IMCI bands the DHIS2 report is disaggregated by, and
    // the structured field is already capped at 89 elsewhere.
    expect(REDACTABLE_LABELS.has('AGE')).toBe(false)
    const text = 'enfant de 6 ans, fièvre'
    expect(applyEntities(text, [at('AGE', 10, 15)]).text).toBe(text)
  })

  it('drops spans below the confidence threshold', () => {
    const text = 'toux sèche depuis deux jours'
    const { redactions } = applyEntities(text, [at('LASTNAME', 0, 4, 0.1)])
    expect(redactions).toBe(0)
  })

  it('does not redact an existing redaction marker again', () => {
    // The deterministic pass ran first. Re-redacting its output would
    // double-count and produce "[…][…]".
    const text = 'Patiente […] revue'
    const { text: out, redactions } = applyEntities(text, [at('LASTNAME', 9, 12)])
    expect(out).toBe(text)
    expect(redactions).toBe(0)
  })

  it('ignores spans that fall outside the text', () => {
    const text = 'court'
    expect(applyEntities(text, [at('LASTNAME', 0, 999)]).redactions).toBe(0)
    expect(applyEntities(text, [at('LASTNAME', -3, 2)]).redactions).toBe(0)
  })
})

/* ------------------------------------------------------------------ *
 * Interaction with the deterministic pipeline
 * ------------------------------------------------------------------ */

const patient = (over: Partial<Patient> = {}): Patient => ({
  id: 'p1',
  familyName: 'RAKOTOARISOA',
  givenName: 'Voahirana',
  sex: 'female',
  approximateAge: 34,
  address: 'Ambohimanga',
  preferredLang: 'mg',
  searchKey: 'rakotoarisoa voahirana',
  createdAt: 0,
  updatedAt: 0,
  ...over,
})

const encounter = (notes: string): Encounter => ({
  id: 'e1',
  patientId: 'p1',
  occurredAt: Date.UTC(2026, 4, 12),
  vitals: {},
  prescriptions: [],
  provenance: {},
  attachmentIds: [],
  status: 'final',
  notes,
  createdAt: 0,
  updatedAt: 0,
})

describe('the neural pass inside deidentify', () => {
  it('adds redactions the roster-based scrub cannot make', async () => {
    const note = 'Accompagnée par sa fille Hanta, fièvre depuis trois jours'

    const withoutModel = await deidentify([patient()], [encounter(note)], {
      level: 'pseudonymous',
      salt: 's',
    })
    // The deterministic scrub has no way to know "Hanta" is a person.
    expect(withoutModel.encounters[0]!.notes).toContain('Hanta')
    expect(withoutModel.manifest.neuralRedactions).toBeUndefined()

    const withModel = await deidentify([patient()], [encounter(note)], {
      level: 'pseudonymous',
      salt: 's',
      nerBackend: async (text) => {
        const index = text.indexOf('Hanta')
        return index === -1 ? [] : [at('FIRSTNAME', index, index + 5)]
      },
    })
    expect(withModel.encounters[0]!.notes).not.toContain('Hanta')
    expect(withModel.encounters[0]!.notes).toContain(REDACTED)
    expect(withModel.manifest.neuralRedactions).toBe(1)
    expect(withModel.manifest.neuralModel).toContain('OpenMed')
  })

  it('keeps the deterministic redactions the model knows nothing about', async () => {
    // Ordering is the safety argument: the neural pass may only ever add.
    const result = await deidentify(
      [patient()],
      [encounter('RAKOTOARISOA vue avec sa fille Hanta')],
      { level: 'pseudonymous', salt: 's', nerBackend: async () => [] },
    )
    expect(result.encounters[0]!.notes).not.toContain('RAKOTOARISOA')
    expect(result.manifest.freeTextRedactions).toBeGreaterThan(0)
  })

  it('falls back to the deterministic output when the backend throws', async () => {
    // An export must never fail because an optional accuracy upgrade broke.
    const result = await deidentify([patient()], [encounter('RAKOTOARISOA et sa fille')], {
      level: 'pseudonymous',
      salt: 's',
      nerBackend: async () => {
        throw new Error('model exploded')
      },
    })
    expect(result.encounters[0]!.notes).not.toContain('RAKOTOARISOA')
    expect(result.manifest.neuralRedactions).toBe(0)
  })

  it('scrubs the raw dictation text kept in provenance', async () => {
    // Verbatim speech is the richest source of stray identifiers in the record.
    const e = encounter('fièvre')
    e.provenance = {
      'vitals.temperature': { source: 'voice', confidence: 0.9, rawText: 'Hanta a de la fièvre' },
    }
    const result = await deidentify([patient()], [e], {
      level: 'pseudonymous',
      salt: 's',
      nerBackend: async (text) => {
        const index = text.indexOf('Hanta')
        return index === -1 ? [] : [at('FIRSTNAME', index, index + 5)]
      },
    })
    expect(result.encounters[0]!.provenance['vitals.temperature']!.rawText).not.toContain('Hanta')
  })

  it('never runs at the identified level', async () => {
    let called = false
    const result = await deidentify([patient()], [encounter('Hanta')], {
      level: 'identified',
      nerBackend: async () => {
        called = true
        return []
      },
    })
    expect(called).toBe(false)
    expect(result.encounters[0]!.notes).toBe('Hanta')
  })
})

/**
 * Whether the model is present.
 *
 * The test that exists because the app got this wrong: a single-page app serves
 * index.html with HTTP 200 for any unknown path, so a status-code check
 * reported a model that had never been downloaded as installed, and Settings
 * told the facility that neural de-identification was active when nothing was
 * running. A false claim that a privacy control is on is the worst bug this
 * codebase can have.
 */
describe('detecting whether the model is installed', () => {
  const respond = (init: { ok: boolean; body?: unknown; throws?: boolean }) =>
    (async () => ({
      ok: init.ok,
      json: async () => {
        if (init.throws) throw new SyntaxError('Unexpected token < in JSON')
        return init.body
      },
    })) as unknown as typeof fetch

  it('accepts a real token-classification config', async () => {
    const impl = respond({ ok: true, body: { model_type: 'bert', id2label: { 0: 'O' } } })
    expect(await isModelAvailable(impl)).toBe(true)
  })

  it('rejects the SPA fallback, which answers 200 with HTML', async () => {
    const impl = respond({ ok: true, throws: true })
    expect(await isModelAvailable(impl)).toBe(false)
  })

  it('rejects a 200 carrying JSON that is not a model config', async () => {
    const impl = respond({ ok: true, body: { hello: 'world' } })
    expect(await isModelAvailable(impl)).toBe(false)
  })

  it('rejects a 404', async () => {
    expect(await isModelAvailable(respond({ ok: false }))).toBe(false)
  })

  it('rejects when the request itself fails', async () => {
    const impl = (async () => {
      throw new Error('offline')
    }) as unknown as typeof fetch
    expect(await isModelAvailable(impl)).toBe(false)
  })
})

/* ------------------------------------------------------------------ *
 * Offset reconstruction
 * ------------------------------------------------------------------ */

describe('normaliseForAlignment', () => {
  it('strips accents and lower-cases, as the tokeniser does', () => {
    const { normalised } = normaliseForAlignment('Fièvre à 38°C')
    expect(normalised).toBe('fievre a 38°c')
  })

  it('maps every normalised character back to its source character', () => {
    const text = 'fébriles'
    const { normalised, map } = normaliseForAlignment(text)
    expect(normalised).toBe('febriles')
    // `é` is one source character even though its NFD form is two.
    expect(map).toHaveLength(normalised.length)
    expect(text[map[normalised.indexOf('b')]!]).toBe('b')
    expect(text.slice(map[0]!, map[map.length - 1]! + 1)).toBe('fébriles')
  })
})

describe('alignTokenOffsets', () => {
  const tok = (word: string, entity = 'O', score = 0.99) => ({ word, entity, score })

  it('finds a plain word', () => {
    const text = 'Patient Rakoto admis'
    const [span] = alignTokenOffsets(text, [tok('rakoto', 'B-LASTNAME')])
    expect(text.slice(span!.start, span!.end)).toBe('Rakoto')
    expect(span!.label).toBe('B-LASTNAME')
  })

  it('recovers the accented source span from an unaccented token', () => {
    // The whole reason the index map exists: the model sees `febriles`, the
    // record says `fébriles`, and the redaction has to land on the record.
    const text = 'sensations fébriles ce matin'
    const [span] = alignTokenOffsets(text, [tok('febriles', 'B-LASTNAME')])
    expect(text.slice(span!.start, span!.end)).toBe('fébriles')
  })

  it('keeps offsets correct after several accented characters', () => {
    const text = 'À Ambohidratrimo, Éric Ramanantsoa'
    const spans = alignTokenOffsets(text, [tok('eric', 'B-FIRSTNAME'), tok('ramanantsoa', 'I-FIRSTNAME')])
    expect(text.slice(spans[0]!.start, spans[0]!.end)).toBe('Éric')
    expect(text.slice(spans[1]!.start, spans[1]!.end)).toBe('Ramanantsoa')
  })

  it('handles WordPiece continuations with and without the ## marker', () => {
    const text = 'hémoptysies signalées'
    const withMarker = alignTokenOffsets(text, [tok('hemo', 'B-LASTNAME'), tok('##ptysies', 'I-LASTNAME')])
    const without = alignTokenOffsets(text, [tok('hemo', 'B-LASTNAME'), tok('ptysies', 'I-LASTNAME')])
    for (const spans of [withMarker, without]) {
      expect(text.slice(spans[0]!.start, spans[1]!.end)).toBe('hémoptysies')
    }
  })

  it('moves forward rather than rematching an earlier occurrence', () => {
    // `a` occurs inside `Rakoto` long before the standalone token. A matcher
    // that restarts from zero redacts the wrong character.
    const text = 'Rakoto a vu Rakoto'
    const spans = alignTokenOffsets(text, [tok('rakoto', 'B-LASTNAME'), tok('a'), tok('vu'), tok('rakoto', 'B-LASTNAME')])
    expect(spans[3]!.start).toBeGreaterThan(spans[0]!.start)
    expect(text.slice(spans[3]!.start, spans[3]!.end)).toBe('Rakoto')
  })

  it('drops a token it cannot locate instead of guessing a span', () => {
    const text = 'toux sèche'
    const spans = alignTokenOffsets(text, [tok('toux'), tok('[UNK]'), tok('seche')])
    expect(spans).toHaveLength(2)
    expect(text.slice(spans[1]!.start, spans[1]!.end)).toBe('sèche')
  })

  it('produces spans that decodeBio and applyEntities can actually redact', () => {
    // The end-to-end shape of the bug: every stage individually looked fine
    // and the composition redacted nothing. This asserts the composition.
    const text = 'Adressé par le Dr Ramanantsoa de Manjakandriana'
    const aligned = alignTokenOffsets(text, [
      tok('adresse'),
      tok('par'),
      tok('le'),
      tok('dr', 'B-PREFIX'),
      tok('ramanantsoa', 'B-LASTNAME'),
      tok('de'),
      tok('manjakandriana', 'B-CITY'),
    ])
    const entities = decodeBio(aligned)
    const { text: out, redactions } = applyEntities(text, entities)

    expect(redactions).toBeGreaterThan(0)
    expect(out).not.toContain('Ramanantsoa')
    expect(out).not.toContain('Manjakandriana')
    expect(out).toContain('Adressé par le')
  })
})

/* ------------------------------------------------------------------ *
 * Protecting clinical content
 * ------------------------------------------------------------------ */

describe('isProtectedSpan', () => {
  const span = (text: string, needle: string) => {
    const start = text.indexOf(needle)
    return isProtectedSpan(text, start, start + needle.length)
  }

  it('protects a drug name the model reads as a surname', () => {
    // Destroyed on the first real run: to a NER model `Paracétamol` is a
    // capitalised token of no obvious class, which is what a surname is.
    expect(span('prescrire Paracétamol 500 mg', 'Paracétamol')).toBe(true)
    expect(span('take Artéméther luméfantrine', 'Artéméther')).toBe(true)
  })

  it('protects eponyms observed destroying real clinical entities', () => {
    expect(span('lymphome malin non hodgkinien', 'hodgkinien')).toBe(true)
    expect(span('hernie de Spiegel opérée', 'Spiegel')).toBe(true)
    expect(span("Castleman's disease confirmed", 'Castleman')).toBe(true)
    expect(span('Henoch-Schönlein purpura', 'Schönlein')).toBe(true)
  })

  it('matches an eponym stem through its French adjectival form', () => {
    expect(span('forme hodgkinienne', 'hodgkinienne')).toBe(true)
  })

  it('protects an eponym it has never seen, from the construction alone', () => {
    // The half that generalises: no list covers every eponym in medicine, but
    // `maladie de X` and `X's disease` are few and recognisable.
    expect(span('maladie de Kawasaki typique', 'Kawasaki')).toBe(true)
    expect(span("Ormond's disease suspected", 'Ormond')).toBe(true)
    expect(span('syndrome de Lemierre', 'Lemierre')).toBe(true)
  })

  it('does not protect an ordinary name', () => {
    expect(span('adressé par le Dr Ramanantsoa', 'Ramanantsoa')).toBe(false)
    expect(span('sa fille Hanta est venue', 'Hanta')).toBe(false)
    expect(span('vu à Manjakandriana', 'Manjakandriana')).toBe(false)
  })

  it('does not protect a name merely because a disease word is nearby', () => {
    // The construction has to be adjacent. "Rakoto" three words before
    // "syndrome" is a patient, not an eponym.
    expect(span('Rakoto présente depuis peu un syndrome grippal', 'Rakoto')).toBe(false)
  })
})

describe('applyEntities with the guard', () => {
  const at = (text: string, needle: string, label: string): NerEntity => {
    const start = text.indexOf(needle)
    return { label, start, end: start + needle.length, score: 0.99 }
  }

  it('keeps the diagnosis and removes the clinician', () => {
    const text = 'Lymphome hodgkinien, adressé par le Dr Ramanantsoa'
    const { text: out, redactions, protectedSpans } = applyEntities(text, [
      at(text, 'hodgkinien', 'LASTNAME'),
      at(text, 'Ramanantsoa', 'LASTNAME'),
    ])

    expect(out).toContain('hodgkinien')
    expect(out).not.toContain('Ramanantsoa')
    expect(redactions).toBe(1)
    expect(protectedSpans).toBe(1)
  })

  it('keeps a prescription intact', () => {
    const text = 'Paracétamol 500 mg trois fois par jour'
    const { text: out, redactions } = applyEntities(text, [at(text, 'Paracétamol', 'LASTNAME')])
    expect(out).toBe(text)
    expect(redactions).toBe(0)
  })

  it('can be measured unguarded, so the guard\'s effect is attributable', () => {
    const text = 'Lymphome hodgkinien'
    const unguarded = applyEntities(text, [at(text, 'hodgkinien', 'LASTNAME')], {
      protect: () => false,
    })
    expect(unguarded.redactions).toBe(1)
    expect(unguarded.text).not.toContain('hodgkinien')
  })
})

describe('the guard survives span merging', () => {
  const at = (text: string, needle: string, label: string): NerEntity => {
    const start = text.indexOf(needle)
    return { label, start, end: start + needle.length, score: 0.99 }
  }

  it('protects a drug adjacent to another tagged token', () => {
    // The bug this reproduces: mergeSpans joins anything separated only by
    // whitespace, so guarding after the merge saw `paracétamol si fièvre`,
    // which matches no formulary entry, and the drug was destroyed while the
    // guard reported itself as working. Guarding before the merge is the fix.
    const text = 'Artéméther luméfantrine matin et soir, paracétamol si fièvre'
    const { text: out, protectedSpans } = applyEntities(text, [
      at(text, 'paracétamol', 'LASTNAME'),
      at(text, 'si', 'LASTNAME'),
      at(text, 'fièvre', 'LASTNAME'),
    ])

    expect(out).toContain('paracétamol')
    expect(protectedSpans).toBeGreaterThan(0)
  })

  it('protects an eponym carrying a preposition into the span', () => {
    const text = 'hernie de Spiegel opérée en 2019'
    const { text: out } = applyEntities(text, [
      at(text, 'de', 'LASTNAME'),
      at(text, 'Spiegel', 'LASTNAME'),
    ])
    expect(out).toContain('Spiegel')
  })

  it("protects an eponym carrying a possessive", () => {
    const text = "Castleman's disease confirmed on biopsy"
    const { text: out } = applyEntities(text, [at(text, "Castleman's", 'LASTNAME')])
    expect(out).toContain('Castleman')
  })

  it('still merges and redacts a genuine multi-part name', () => {
    // The guard must not become a general veto: two adjacent tagged tokens
    // that are neither drug nor eponym still merge into one redaction.
    const text = 'adressé par Jean Baptiste Ramanantsoa'
    const { text: out, redactions } = applyEntities(text, [
      at(text, 'Jean', 'FIRSTNAME'),
      at(text, 'Baptiste', 'MIDDLENAME'),
      at(text, 'Ramanantsoa', 'LASTNAME'),
    ])
    expect(out).toBe('adressé par […]')
    expect(redactions).toBe(1)
  })

  it('redacts the name and keeps the drug when both are in one run', () => {
    const text = 'Dr Rakoto a prescrit paracétamol'
    const { text: out } = applyEntities(text, [
      at(text, 'Rakoto', 'LASTNAME'),
      at(text, 'paracétamol', 'LASTNAME'),
    ])
    expect(out).not.toContain('Rakoto')
    expect(out).toContain('paracétamol')
  })
})

describe('the guard must not rescue a real name', () => {
  const at = (text: string, needle: string, label: string): NerEntity => {
    const start = text.indexOf(needle)
    return { label, start, end: start + needle.length, score: 0.99 }
  }

  it('redacts a surname that happens to sit beside an eponym', () => {
    // `Gilbert` is a syndrome and a surname. Guarding after the merge, this
    // span is one unit, the guard sees `gilbert`, and Ramanantsoa survives —
    // a privacy failure created by a guard meant to protect clinical content.
    const text = 'adressé par le Dr Gilbert Ramanantsoa'
    const { text: out } = applyEntities(text, [
      at(text, 'Gilbert', 'FIRSTNAME'),
      at(text, 'Ramanantsoa', 'LASTNAME'),
    ])
    expect(out).not.toContain('Ramanantsoa')
  })

  it('does not protect an ambiguous eponym used as a plain name', () => {
    const text = 'vu par Gilbert Rakoto ce matin'
    const start = text.indexOf('Gilbert')
    expect(isProtectedSpan(text, start, start + 'Gilbert'.length)).toBe(false)
  })

  it('does protect the same word inside its construction', () => {
    const text = 'maladie de Gilbert connue'
    const start = text.indexOf('Gilbert')
    expect(isProtectedSpan(text, start, start + 'Gilbert'.length)).toBe(true)
  })

  it('redacts a name that dictation ran together with a drug', () => {
    // The case that makes the guard's *position* matter rather than its
    // contents. A speech recogniser drops the comma, so "paracétamol, Hanta
    // revient demain" arrives with the drug and the relative's name adjacent.
    // Guarding after the merge, they are one span; the span contains a
    // formulary drug; the whole thing is protected; the name survives. The
    // guard would be leaking a name in order to save a drug.
    const text = 'paracétamol Hanta revient demain'
    const { text: out } = applyEntities(text, [
      at(text, 'paracétamol', 'LASTNAME'),
      at(text, 'Hanta', 'FIRSTNAME'),
    ])
    expect(out).toContain('paracétamol')
    expect(out).not.toContain('Hanta')
  })
})

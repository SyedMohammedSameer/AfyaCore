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
import {
  applyEntities,
  decodeBio,
  isModelAvailable,
  mergeSpans,
  REDACTABLE_LABELS,
  type NerEntity,
} from './openmed'
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

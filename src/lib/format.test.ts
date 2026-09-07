import { describe, expect, it } from 'vitest'
import { formatAge, formatDateCompact, formatYears } from './format'
import { STRINGS } from '../i18n/strings'

describe('formatDateCompact', () => {
  const AUG_2026 = new Date('2026-08-31T10:00:00Z').getTime()
  const NOW_2026 = new Date('2026-09-04T10:00:00Z').getTime()
  const NOW_2027 = new Date('2027-01-04T10:00:00Z').getTime()

  it('drops the year for a visit in the current year', () => {
    // The roster line is age, sex and last visit joined together, and the full
    // date pushed it past the edge: a row read "Last seen 31 Aug 20…", cutting
    // the year in half rather than omitting it.
    expect(formatDateCompact(AUG_2026, 'en', NOW_2026)).toBe('31 Aug')
  })

  it('keeps the year once it carries information', () => {
    expect(formatDateCompact(AUG_2026, 'en', NOW_2027)).toBe('31 Aug 2026')
  })

  it('follows the interface language, with Malagasy on French dates', () => {
    expect(formatDateCompact(AUG_2026, 'fr', NOW_2026)).toBe(
      formatDateCompact(AUG_2026, 'mg', NOW_2026),
    )
  })
})

describe('formatAge', () => {
  const en = STRINGS.en
  const fr = STRINGS.fr
  const NOW = new Date('2026-09-07T12:00:00Z').getTime()

  it('counts an under-two in months', () => {
    // The reason this exists. "1 yr" spans a child who cannot sit up and one
    // who is running, and every growth threshold in between.
    expect(formatAge({ birthDate: '2025-03-07' }, en, NOW)).toBe('18 months')
    expect(formatAge({ birthDate: '2026-08-07' }, en, NOW)).toBe('1 month')
    expect(formatAge({ birthDate: '2026-09-07' }, en, NOW)).toBe('0 months')
  })

  it('switches to years at two, where months stop being the useful unit', () => {
    expect(formatAge({ birthDate: '2024-09-07' }, en, NOW)).toBe('2 yrs')
    expect(formatAge({ birthDate: '2024-10-07' }, en, NOW)).toBe('23 months')
  })

  it('agrees in number, which is why it is not a template string', () => {
    expect(formatAge({ approximateAge: 1 }, en, NOW)).toBe('1 yr')
    expect(formatAge({ approximateAge: 34 }, en, NOW)).toBe('34 yrs')
    expect(formatAge({ approximateAge: 1 }, fr, NOW)).toBe('1 an')
    expect(formatAge({ approximateAge: 34 }, fr, NOW)).toBe('34 ans')
  })

  it('will not invent months out of an estimate in years', () => {
    // `approximateAge` is what someone said when asked. Rendering it as "12
    // months" would report a precision nobody gave.
    expect(formatAge({ approximateAge: 1 }, en, NOW)).toBe('1 yr')
  })

  it('has nothing to say when nothing is known', () => {
    expect(formatAge({}, en, NOW)).toBeUndefined()
    expect(formatAge({ birthDate: 'not a date' }, en, NOW)).toBeUndefined()
  })

  it('falls back rather than reporting a negative age', () => {
    // A mistyped year is a real data-entry outcome, and "-3 yrs" in a roster
    // is worse than no age at all.
    expect(formatAge({ birthDate: '2030-01-01' }, en, NOW)).toBeUndefined()
    expect(formatAge({ birthDate: '2030-01-01', approximateAge: 40 }, en, NOW)).toBe('40 yrs')
  })
})

describe('formatYears', () => {
  it('agrees in number too', () => {
    expect(formatYears(1, STRINGS.en)).toBe('1 yr')
    expect(formatYears(10, STRINGS.en)).toBe('10 yrs')
    expect(formatYears(1, STRINGS.fr)).toBe('1 an')
  })
})

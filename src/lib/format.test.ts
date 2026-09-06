import { describe, expect, it } from 'vitest'
import { formatDateCompact } from './format'

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

import { describe, expect, it } from 'vitest'
import { dailyCounts, DAY, indicatorSignals, WEEK } from './surveillance'
import type { Encounter } from '../db/schema'

const NOW = new Date(2026, 8, 12, 15, 0, 0).getTime()

const visit = (daysAgo: number, diagnosis: string, over: Partial<Encounter> = {}): Encounter => ({
  id: `e-${daysAgo}-${diagnosis}-${Math.random()}`,
  patientId: 'p',
  occurredAt: NOW - daysAgo * DAY,
  diagnosis,
  vitals: {},
  prescriptions: [],
  provenance: {},
  attachmentIds: [],
  status: 'final',
  createdAt: 0,
  updatedAt: 0,
  ...over,
})

describe('dailyCounts', () => {
  it('returns one bucket per day, oldest first, zeros included', () => {
    const rows = dailyCounts([visit(0, 'x'), visit(0, 'y'), visit(3, 'z')], 7, NOW)
    expect(rows).toHaveLength(7)
    expect(rows.map((r) => r.count)).toEqual([0, 0, 0, 1, 0, 0, 2])
    expect(rows[6]!.day).toBe(new Date(2026, 8, 12).getTime())
  })

  it('counts neither drafts nor tombstones', () => {
    const rows = dailyCounts(
      [visit(0, 'x', { status: 'draft' }), visit(0, 'y', { deletedAt: 1 }), visit(0, 'z')],
      3,
      NOW,
    )
    expect(rows.map((r) => r.count)).toEqual([0, 0, 1])
  })

  it('ignores anything older than the window', () => {
    expect(dailyCounts([visit(20, 'x')], 14, NOW).every((r) => r.count === 0)).toBe(true)
  })
})

describe('indicatorSignals', () => {
  const malaria = (daysAgo: number) => visit(daysAgo, 'paludisme simple')

  it('marks a week that clearly exceeds a steady baseline', () => {
    const rows = [
      // One a week for four weeks.
      malaria(9), malaria(16), malaria(23), malaria(30),
      // Five this week.
      malaria(1), malaria(2), malaria(3), malaria(4), malaria(5),
    ]
    const signal = indicatorSignals(rows, NOW).find((s) => s.indicator === 'malaria')!
    expect(signal.thisWeek).toBe(5)
    expect(signal.baseline).toEqual([1, 1, 1, 1])
    expect(signal.baselineMean).toBe(1)
    // Deviation is floored at 1, so the threshold is 1 + 2 * 1.
    expect(signal.threshold).toBe(3)
    expect(signal.excess).toBe(true)
  })

  it('never marks a week below the minimum count, whatever the baseline', () => {
    const signal = indicatorSignals([malaria(1), malaria(2)], NOW).find((s) => s.indicator === 'malaria')!
    expect(signal.thisWeek).toBe(2)
    expect(signal.excess).toBe(false)
  })

  it('does not mark a week that matches its baseline', () => {
    const rows = [1, 2, 3, 4, 5].flatMap((week) => [malaria(week * 7 - 1), malaria(week * 7 - 3), malaria(week * 7 - 5)])
    const signal = indicatorSignals(rows, NOW).find((s) => s.indicator === 'malaria')!
    expect(signal.thisWeek).toBe(3)
    expect(signal.excess).toBe(false)
  })

  it('uses a noisy baseline against itself', () => {
    // Weeks of 0, 6, 0, 6 have a mean of 3 and a deviation of 3, so a week of 8
    // is within two deviations and is not marked.
    const rows = [
      ...[8, 9, 10, 11, 12, 13].map(malaria),
      ...[22, 23, 24, 25, 26, 27].map(malaria),
      ...[1, 2, 3, 4, 5, 6, 6.5, 0.5].map(malaria),
    ]
    const signal = indicatorSignals(rows, NOW).find((s) => s.indicator === 'malaria')!
    expect(signal.baseline).toEqual([6, 0, 6, 0])
    expect(signal.thisWeek).toBe(8)
    expect(signal.excess).toBe(false)
  })

  it('leaves the unclassified bucket out and drafts uncounted', () => {
    const rows = [visit(1, 'lombalgie'), visit(1, 'paludisme', { status: 'draft' })]
    const signals = indicatorSignals(rows, NOW)
    expect(signals.find((s) => s.indicator === ('other' as never))).toBeUndefined()
    expect(signals.find((s) => s.indicator === 'malaria')!.thisWeek).toBe(0)
  })

  it('places a case exactly one week old in the previous week', () => {
    const signal = indicatorSignals([malaria(7)], NOW).find((s) => s.indicator === 'malaria')!
    expect(signal.thisWeek).toBe(0)
    expect(signal.baseline[0]).toBe(1)
    expect(WEEK).toBe(7 * DAY)
  })
})

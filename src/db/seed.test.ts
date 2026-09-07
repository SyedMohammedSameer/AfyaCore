/**
 * The demo workspace is the app for anyone who has not typed a patient in yet:
 * a reviewer opening the deployment, a clinician evaluating it, the screen
 * recording. So it is checked like a feature rather than like a fixture.
 *
 * The growth assertions in particular exist because the panel had already been
 * built and tested against synthetic measurements while the seed's youngest
 * patient was six years old, so the chart could not appear in a demo at all.
 * Nothing in the type system connects those two facts. This does.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import 'fake-indexeddb/auto'
import { db } from './db'
import { seedDemoData } from './seed'
import { setCurrentActor } from '../lib/audit'
import { ageDaysAt } from '../components/GrowthPanel'
import { assess, MAX_AGE_DAYS, type GrowthIndicator } from '../lib/growth'
import { WHO_GROWTH, type GrowthStandard } from '../data/whoGrowth'

setCurrentActor('test-admin', 'admin')

const STANDARDS = WHO_GROWTH as unknown as Record<GrowthIndicator, GrowthStandard>

beforeEach(async () => {
  await db.patients.clear()
  await db.encounters.clear()
  await seedDemoData()
})

describe('the demo workspace', () => {
  it('seeds once and is idempotent', async () => {
    const first = await db.patients.count()
    await seedDemoData()
    expect(await db.patients.count()).toBe(first)
  })

  it('includes a child WHO’s growth standards cover', async () => {
    const patients = await db.patients.toArray()
    const children = patients.filter((p) => {
      const age = ageDaysAt(p, Date.now())
      return age !== undefined && age >= 0 && age <= MAX_AGE_DAYS
    })
    expect(children, 'no under-five with a birth date: the growth chart cannot appear').toHaveLength(
      1,
    )
  })

  it('gives that child enough visits to show a trend, not a dot', async () => {
    const child = (await db.patients.toArray()).find((p) => p.birthDate !== undefined)
    const encounters = await db.encounters.where('patientId').equals(child!.id).toArray()
    const measured = encounters.filter(
      (e) => e.vitals.weight !== undefined && e.vitals.height !== undefined,
    )
    expect(measured.length).toBeGreaterThanOrEqual(3)
    expect(measured.every((e) => e.status === 'final')).toBe(true)
  })

  it('tells a story the chart is for: normal, then faltering', async () => {
    // A single moderate weight is a number a clinician reads off a table. The
    // same weight at the end of a year of flattening is a decision, and the
    // difference between the two is the entire argument for drawing a curve.
    const child = (await db.patients.toArray()).find((p) => p.birthDate !== undefined)
    const encounters = (await db.encounters.where('patientId').equals(child!.id).toArray()).sort(
      (a, b) => a.occurredAt - b.occurredAt,
    )

    const scores = encounters.map((e) => {
      const ageDays = ageDaysAt(child!, e.occurredAt)
      const results = assess(
        { sex: child!.sex, ageDays, weightKg: e.vitals.weight, heightCm: e.vitals.height },
        STANDARDS,
      )
      return results.find((r) => r.indicator === 'weightForAge')!
    })

    expect(scores.every(Boolean)).toBe(true)
    expect(scores[0]!.flag).toBe('normal')
    expect(scores[scores.length - 1]!.flag).toBe('moderate-low')
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i]!.z, `visit ${i} should be lower than visit ${i - 1}`).toBeLessThan(
        scores[i - 1]!.z,
      )
    }
  })
})

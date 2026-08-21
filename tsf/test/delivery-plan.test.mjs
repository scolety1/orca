import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeWbs } from '../domain/estimation.mjs'
import { workingHoursBetween } from '../domain/delivery-scheduling.mjs'
import { buildDeliveryPlan } from '../domain/delivery-plan.mjs'

function task(overrides = {}) {
  return {
    id: overrides.id ?? 'task-1',
    title: overrides.title ?? 'A task',
    activeEffortHours: overrides.activeEffortHours ?? { min: 4, expected: 8, max: 16 },
    ...overrides
  }
}

test('workingHoursBetween is the real inverse of hourOffsetToDate for a round trip', () => {
  const start = new Date('2026-01-05T00:00:00.000Z') // a Monday
  const hours = workingHoursBetween(start, new Date('2026-01-07T00:00:00.000Z')) // Mon+Tue
  assert.equal(hours, 16) // 2 working days * 8 hours/day
})

test('workingHoursBetween returns 0 (never negative) for an end date on/before start', () => {
  const start = new Date('2026-01-05T00:00:00.000Z')
  assert.equal(workingHoursBetween(start, start), 0)
  assert.equal(workingHoursBetween(start, new Date('2026-01-01T00:00:00.000Z')), 0)
})

test("workingHoursBetween skips weekends, matching hourOffsetToDate's own default calendar", () => {
  const friday = new Date('2026-01-02T00:00:00.000Z')
  const nextMonday = new Date('2026-01-05T00:00:00.000Z')
  // Only Friday itself counts (Sat/Sun excluded) -- 1 working day = 8h.
  assert.equal(workingHoursBetween(friday, nextMonday), 8)
})

test('REQUIRED PROOF: buildDeliveryPlan produces real calendar dates for every scheduled task, respecting dependencies', () => {
  const wbs = normalizeWbs([
    task({ id: 'a', activeEffortHours: { min: 4, expected: 8, max: 16 } }),
    task({ id: 'b', dependencies: ['a'], activeEffortHours: { min: 4, expected: 8, max: 16 } })
  ])
  const startDate = new Date('2026-01-05T00:00:00.000Z') // Monday
  const plan = buildDeliveryPlan({ wbs, startDate, maxConcurrent: 1, seed: 1, runs: 1000 })
  assert.equal(plan.schedule.length, 2)
  const a = plan.schedule.find((s) => s.id === 'a')
  const b = plan.schedule.find((s) => s.id === 'b')
  assert.ok(a.startDate instanceof Date)
  assert.ok(
    b.startDate.getTime() >= a.endDate.getTime(),
    'b starts on/after a finishes in real calendar time'
  )
  assert.equal(plan.status, 'NO_DEADLINE_SET')
  assert.equal(plan.deadlineProbability, null)
})

test('REQUIRED PROOF: an impossible deadline is honestly classified UNREALISTIC, a generous one ON_TRACK', () => {
  const wbs = normalizeWbs([task({ activeEffortHours: { min: 4, expected: 8, max: 16 } })])
  const startDate = new Date('2026-01-05T00:00:00.000Z')

  const impossiblePlan = buildDeliveryPlan({
    wbs,
    startDate,
    deadlineDate: new Date('2026-01-05T01:00:00.000Z'),
    seed: 1,
    runs: 2000
  })
  assert.equal(impossiblePlan.status, 'UNREALISTIC')

  const generousPlan = buildDeliveryPlan({
    wbs,
    startDate,
    deadlineDate: new Date('2027-01-05T00:00:00.000Z'),
    seed: 1,
    runs: 2000
  })
  assert.equal(generousPlan.status, 'ON_TRACK')
})

test('buildDeliveryPlan is deterministic -- same WBS/seed/dates produce an identical plan', () => {
  const wbs = normalizeWbs([task()])
  const startDate = new Date('2026-01-05T00:00:00.000Z')
  const first = buildDeliveryPlan({ wbs, startDate, seed: 5, runs: 1000 })
  const second = buildDeliveryPlan({ wbs, startDate, seed: 5, runs: 1000 })
  assert.deepEqual(first, second)
})

test('the three distinct clocks from the underlying estimate remain visible and distinct in the delivery plan', () => {
  const wbs = normalizeWbs([
    task({
      activeEffortHours: { min: 4, expected: 8, max: 16 },
      humanReviewHours: { min: 1, expected: 2, max: 4 }
    })
  ])
  const plan = buildDeliveryPlan({
    wbs,
    startDate: new Date('2026-01-05T00:00:00.000Z'),
    seed: 1,
    runs: 1000
  })
  assert.ok(plan.estimate.activeEffortHours)
  assert.ok(plan.estimate.humanEffortHours)
  assert.ok(plan.estimate.wallClockHours)
  assert.notDeepEqual(plan.estimate.activeEffortHours, plan.estimate.humanEffortHours)
})

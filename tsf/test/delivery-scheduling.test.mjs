import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeWbs } from '../domain/estimation.mjs'
import {
  topologicalOrder,
  computeCriticalPathSchedule,
  hourOffsetToDate
} from '../domain/delivery-scheduling.mjs'

function task(overrides = {}) {
  return {
    id: overrides.id ?? 'task-1',
    title: overrides.title ?? 'A task',
    activeEffortHours: overrides.activeEffortHours ?? { min: 4, expected: 8, max: 16 },
    ...overrides
  }
}

test('topologicalOrder places a task only after all its dependencies', () => {
  const wbs = normalizeWbs([
    task({ id: 'c', dependencies: ['b'] }),
    task({ id: 'a' }),
    task({ id: 'b', dependencies: ['a'] })
  ])
  const order = topologicalOrder(wbs).map((t) => t.id)
  assert.ok(order.indexOf('a') < order.indexOf('b'))
  assert.ok(order.indexOf('b') < order.indexOf('c'))
})

test('topologicalOrder throws honestly on a real dependency cycle rather than guessing an order', () => {
  // Construct a cycle directly (normalizeWbs's own dangling-dependency
  // check would reject this if built the normal way with 2 tasks only
  // referencing each other before either exists -- a 3-task mutual cycle
  // still passes normalizeWbs's per-task existence check since all ids
  // are real, just circular).
  const wbs = normalizeWbs([
    task({ id: 'a', dependencies: ['c'] }),
    task({ id: 'b', dependencies: ['a'] }),
    task({ id: 'c', dependencies: ['b'] })
  ])
  assert.throws(() => topologicalOrder(wbs), /dependency cycle/)
})

test("REQUIRED PROOF: a dependency genuinely delays a task's start -- this is real scheduling, not a flat sum", () => {
  const wbs = normalizeWbs([
    task({ id: 'a', activeEffortHours: { min: 4, expected: 10, max: 16 } }),
    task({ id: 'b', dependencies: ['a'], activeEffortHours: { min: 4, expected: 5, max: 16 } })
  ])
  const result = computeCriticalPathSchedule(wbs, { maxConcurrent: 5 })
  const a = result.schedule.find((s) => s.id === 'a')
  const b = result.schedule.find((s) => s.id === 'b')
  assert.equal(a.startHour, 0)
  assert.equal(a.endHour, 10)
  assert.equal(b.startHour, 10, 'b cannot start before a (its dependency) finishes')
  assert.equal(result.totalDurationHours, 15)
})

test('independent tasks with no dependencies run in parallel when concurrency allows', () => {
  const wbs = normalizeWbs([
    task({ id: 'a', activeEffortHours: { min: 4, expected: 10, max: 16 } }),
    task({ id: 'b', activeEffortHours: { min: 4, expected: 10, max: 16 } })
  ])
  const result = computeCriticalPathSchedule(wbs, { maxConcurrent: 2 })
  assert.equal(result.totalDurationHours, 10, 'both tasks run at once, total is NOT the sum')
})

test('a concurrency cap of 1 forces two independent tasks to run sequentially', () => {
  const wbs = normalizeWbs([
    task({ id: 'a', activeEffortHours: { min: 4, expected: 10, max: 16 } }),
    task({ id: 'b', activeEffortHours: { min: 4, expected: 10, max: 16 } })
  ])
  const result = computeCriticalPathSchedule(wbs, { maxConcurrent: 1 })
  assert.equal(result.totalDurationHours, 20)
})

test('REQUIRED PROOF: two tasks marked conflictsWith never run in an overlapping time window, even with ample concurrency', () => {
  const wbs = normalizeWbs([
    task({ id: 'a', activeEffortHours: { min: 4, expected: 10, max: 16 } }),
    task({ id: 'b', conflictsWith: ['a'], activeEffortHours: { min: 4, expected: 10, max: 16 } })
  ])
  const result = computeCriticalPathSchedule(wbs, { maxConcurrent: 10 })
  const a = result.schedule.find((s) => s.id === 'a')
  const b = result.schedule.find((s) => s.id === 'b')
  assert.ok(
    a.endHour <= b.startHour || b.endHour <= a.startHour,
    'conflicting tasks must not overlap'
  )
})

test('the schedule is deterministic -- the same WBS always produces the same schedule', () => {
  const wbs = normalizeWbs([
    task({ id: 'a' }),
    task({ id: 'b', dependencies: ['a'] }),
    task({ id: 'c', dependencies: ['a'] })
  ])
  const first = computeCriticalPathSchedule(wbs, { maxConcurrent: 2 })
  const second = computeCriticalPathSchedule(wbs, { maxConcurrent: 2 })
  assert.deepEqual(first, second)
})

test('computeCriticalPathSchedule rejects a non-positive-integer maxConcurrent', () => {
  const wbs = normalizeWbs([task()])
  assert.throws(() => computeCriticalPathSchedule(wbs, { maxConcurrent: 0 }), /positive integer/)
  assert.throws(() => computeCriticalPathSchedule(wbs, { maxConcurrent: 1.5 }), /positive integer/)
})

test('hourOffsetToDate skips weekends by default', () => {
  // Friday 2026-01-02 (a real UTC Friday), 8 hours/day: 8 hours lands
  // exactly at end of Friday: the function returns once consumed, so an
  // offset of 8 should resolve to Friday itself, and 16 should skip the
  // weekend to the following Monday.
  const friday = new Date('2026-01-02T00:00:00.000Z')
  const oneDayLater = hourOffsetToDate(8, { startDate: friday })
  assert.equal(oneDayLater.toISOString().slice(0, 10), '2026-01-02')
  const twoDaysLater = hourOffsetToDate(16, { startDate: friday })
  assert.equal(twoDaysLater.toISOString().slice(0, 10), '2026-01-05', 'skips Sat/Sun to Monday')
})

test('hourOffsetToDate skips explicit blackout dates', () => {
  const monday = new Date('2026-01-05T00:00:00.000Z')
  const result = hourOffsetToDate(16, { startDate: monday, blackoutDates: ['2026-01-06'] })
  assert.equal(result.toISOString().slice(0, 10), '2026-01-07', 'skips the blacked-out Tuesday')
})

test('hourOffsetToDate rejects an invalid startDate', () => {
  assert.throws(() => hourOffsetToDate(8, { startDate: 'not-a-date' }), /real Date/)
})

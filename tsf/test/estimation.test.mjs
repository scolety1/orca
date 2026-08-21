import assert from 'node:assert/strict'
import test from 'node:test'
import {
  normalizeWbsTask,
  normalizeWbs,
  sampleTriangular,
  runMonteCarloEstimate
} from '../domain/estimation.mjs'

function rawTask(overrides = {}) {
  return {
    id: 'task-1',
    title: 'Build the widget',
    activeEffortHours: { min: 4, expected: 8, max: 16 },
    ...overrides
  }
}

test('normalizeWbsTask requires a non-empty id and title', () => {
  assert.throws(() => normalizeWbsTask({ ...rawTask(), id: '' }), /non-empty id/)
  assert.throws(() => normalizeWbsTask({ ...rawTask(), title: '' }), /non-empty title/)
})

test('normalizeWbsTask rejects a three-point range that is not min <= expected <= max', () => {
  assert.throws(
    () => normalizeWbsTask(rawTask({ activeEffortHours: { min: 10, expected: 5, max: 20 } })),
    /min <= expected <= max/
  )
})

test('normalizeWbsTask rejects out-of-range clarity/confidence', () => {
  assert.throws(() => normalizeWbsTask(rawTask({ clarity: 1.5 })), /clarity/)
  assert.throws(() => normalizeWbsTask(rawTask({ confidence: -0.1 })), /confidence/)
})

test('normalizeWbsTask rejects an invalid providerRoleHint rather than silently accepting an invented role', () => {
  assert.throws(
    () => normalizeWbsTask(rawTask({ providerRoleHint: 'MADE_UP_ROLE' })),
    /providerRoleHint/
  )
})

test('normalizeWbsTask defaults optional fields explicitly rather than leaving them undefined', () => {
  const task = normalizeWbsTask(rawTask())
  assert.equal(task.clarity, 0.7)
  assert.equal(task.confidence, 0.7)
  assert.equal(task.risk, null)
  assert.equal(task.providerRoleHint, null)
  assert.deepEqual(task.humanReviewHours, { min: 0, expected: 0, max: 0 })
  assert.deepEqual(task.dependencies, [])
})

test('normalizeWbs rejects an empty WBS', () => {
  assert.throws(() => normalizeWbs([]), /non-empty array/)
})

test('normalizeWbs rejects duplicate task ids', () => {
  assert.throws(() => normalizeWbs([rawTask(), rawTask()]), /duplicate WBS task id/)
})

test('normalizeWbs rejects a dependency referencing an unknown task id', () => {
  assert.throws(
    () => normalizeWbs([rawTask({ dependencies: ['does-not-exist'] })]),
    /unknown task id/
  )
})

test('normalizeWbs accepts a real dependency between two known tasks', () => {
  const wbs = normalizeWbs([rawTask({ id: 'a' }), rawTask({ id: 'b', dependencies: ['a'] })])
  assert.equal(wbs.length, 2)
  assert.deepEqual(wbs[1].dependencies, ['a'])
})

test('sampleTriangular stays within [min, max] and hits the boundaries at u=0/u=1', () => {
  assert.equal(sampleTriangular(2, 5, 10, 0), 2)
  assert.equal(sampleTriangular(2, 5, 10, 1), 10)
  for (let u = 0; u <= 1; u += 0.05) {
    const x = sampleTriangular(2, 5, 10, u)
    assert.ok(x >= 2 && x <= 10, `${x} out of [2,10] at u=${u}`)
  }
})

test('sampleTriangular handles a degenerate min===max range without dividing by zero', () => {
  assert.equal(sampleTriangular(5, 5, 5, 0.5), 5)
})

test('REQUIRED PROOF: the same fixed WBS + seed produces byte-identical output (reproducibility)', () => {
  const wbs = normalizeWbs([
    rawTask({ id: 'a', activeEffortHours: { min: 4, expected: 8, max: 16 } }),
    rawTask({ id: 'b', activeEffortHours: { min: 10, expected: 20, max: 40 }, clarity: 0.4 })
  ])
  const first = runMonteCarloEstimate(wbs, { seed: 42, runs: 2000 })
  const second = runMonteCarloEstimate(wbs, { seed: 42, runs: 2000 })
  assert.deepEqual(first, second)
})

test('a different seed produces a different result (not a hardcoded constant)', () => {
  const wbs = normalizeWbs([rawTask()])
  const a = runMonteCarloEstimate(wbs, { seed: 1, runs: 2000 })
  const b = runMonteCarloEstimate(wbs, { seed: 2, runs: 2000 })
  assert.notDeepEqual(a.activeEffortHours, b.activeEffortHours)
})

test('percentiles are monotonic: p10 <= p50 <= p80 <= p95', () => {
  const wbs = normalizeWbs([
    rawTask({ id: 'a' }),
    rawTask({
      id: 'b',
      activeEffortHours: { min: 2, expected: 30, max: 100 },
      clarity: 0.3,
      confidence: 0.3
    })
  ])
  const result = runMonteCarloEstimate(wbs, { seed: 7, runs: 5000 })
  for (const clock of [result.activeEffortHours, result.humanEffortHours, result.wallClockHours]) {
    assert.ok(clock.p10 <= clock.p50, `p10 ${clock.p10} > p50 ${clock.p50}`)
    assert.ok(clock.p50 <= clock.p80, `p50 ${clock.p50} > p80 ${clock.p80}`)
    assert.ok(clock.p80 <= clock.p95, `p80 ${clock.p80} > p95 ${clock.p95}`)
  }
})

test('the three clocks are never conflated -- active effort, human effort, and wall-clock stay distinct distributions', () => {
  const wbs = normalizeWbs([
    rawTask({
      activeEffortHours: { min: 4, expected: 8, max: 16 },
      humanReviewHours: { min: 1, expected: 2, max: 4 },
      externalWaitHours: { min: 24, expected: 48, max: 96 }
    })
  ])
  const result = runMonteCarloEstimate(wbs, { seed: 1, runs: 5000 })
  // wall-clock (wave 2's honest no-parallelism sum) must be at least as
  // large as active effort alone -- it can never be smaller, since it
  // includes human review + external wait on top.
  assert.ok(result.wallClockHours.p50 >= result.activeEffortHours.p50)
  assert.ok(result.wallClockHours.p50 > result.humanEffortHours.p50)
})

test('REQUIRED PROOF: deadline probability sanity -- an impossible deadline is near 0%, a generous one is near 100%', () => {
  const wbs = normalizeWbs([rawTask({ activeEffortHours: { min: 4, expected: 8, max: 16 } })])
  const impossible = runMonteCarloEstimate(wbs, { seed: 1, runs: 5000, deadlineHours: 0.001 })
  const generous = runMonteCarloEstimate(wbs, { seed: 1, runs: 5000, deadlineHours: 100000 })
  assert.ok(
    impossible.deadlineProbability < 0.01,
    `expected near-0, got ${impossible.deadlineProbability}`
  )
  assert.ok(
    generous.deadlineProbability > 0.99,
    `expected near-1, got ${generous.deadlineProbability}`
  )
})

test('deadlineProbability is null when no deadline is supplied -- never a fabricated probability', () => {
  const wbs = normalizeWbs([rawTask()])
  const result = runMonteCarloEstimate(wbs, { seed: 1, runs: 1000 })
  assert.equal(result.deadlineProbability, null)
})

test('runMonteCarloEstimate rejects a non-integer seed (reproducibility would be meaningless otherwise)', () => {
  const wbs = normalizeWbs([rawTask()])
  assert.throws(() => runMonteCarloEstimate(wbs, { seed: 1.5 }), /seed must be an integer/)
})

test('low clarity/confidence genuinely widens the effective distribution vs. a well-understood task with identical three-point input', () => {
  const wellUnderstood = normalizeWbs([
    rawTask({
      id: 'a',
      activeEffortHours: { min: 4, expected: 8, max: 16 },
      clarity: 1,
      confidence: 1
    })
  ])
  const poorlyUnderstood = normalizeWbs([
    rawTask({
      id: 'a',
      activeEffortHours: { min: 4, expected: 8, max: 16 },
      clarity: 0.1,
      confidence: 0.1
    })
  ])
  const clearResult = runMonteCarloEstimate(wellUnderstood, { seed: 3, runs: 5000 })
  const unclearResult = runMonteCarloEstimate(poorlyUnderstood, { seed: 3, runs: 5000 })
  const clearSpread = clearResult.activeEffortHours.p95 - clearResult.activeEffortHours.p10
  const unclearSpread = unclearResult.activeEffortHours.p95 - unclearResult.activeEffortHours.p10
  assert.ok(
    unclearSpread > clearSpread,
    `low-clarity/confidence spread (${unclearSpread}) should exceed high-clarity/confidence spread (${clearSpread})`
  )
})

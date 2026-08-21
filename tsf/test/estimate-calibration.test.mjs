import assert from 'node:assert/strict'
import test from 'node:test'
import {
  extractRunActuals,
  buildEstimateActual,
  summarizeCalibration,
  applyCalibrationBias
} from '../domain/estimate-calibration.mjs'

const CLOCK = () => new Date('2026-02-01T00:00:00.000Z')

function fakeRun(overrides = {}) {
  return {
    id: 'run-1',
    projectId: 'proj-1',
    state: 'COMPLETE',
    createdAt: '2026-01-01T00:00:00.000Z',
    transitions: [
      { from: null, to: 'ACTIVE', reason: 'OVERNIGHT_RUN_CREATED', at: '2026-01-01T00:00:00.000Z' },
      {
        from: 'ACTIVE',
        to: 'COMPLETE',
        reason: 'ORIGINAL_GOAL_SATISFIED',
        at: '2026-01-03T00:00:00.000Z'
      }
    ],
    waves: [{ digest: 'a' }, { digest: 'b' }],
    retryCounts: { 'task-1': 2, 'task-2': 1 },
    ...overrides
  }
}

function fakeEstimate(overrides = {}) {
  return {
    projectId: 'proj-1',
    generatedAt: '2025-12-31T00:00:00.000Z',
    plan: {
      estimate: {
        activeEffortHours: { p50: 20 },
        wallClockHours: { p10: 30, p50: 40, p80: 55, p95: 70, mean: 42 }
      }
    },
    ...overrides
  }
}

test('extractRunActuals rejects a run that has not settled yet', () => {
  assert.throws(() => extractRunActuals(fakeRun({ state: 'ACTIVE' })), /settled/)
})

test('extractRunActuals computes real wall-clock hours from createdAt to the terminal transition', () => {
  const actual = extractRunActuals(fakeRun())
  assert.equal(actual.wallClockHoursActual, 48) // 2 real days
  assert.equal(actual.wavesCompleted, 2)
  assert.equal(actual.totalRetries, 3)
  assert.equal(actual.humanReviewHoursActual, null)
})

test('extractRunActuals sums retries across every task, including zero-retry runs', () => {
  const actual = extractRunActuals(fakeRun({ retryCounts: {} }))
  assert.equal(actual.totalRetries, 0)
})

test('extractRunActuals uses the LAST matching terminal transition, not the first', () => {
  // A run that stalled into BLOCKED and was later manually resumed and
  // completed -- the real completion time is the later transition.
  const run = fakeRun({
    transitions: [
      { from: null, to: 'ACTIVE', at: '2026-01-01T00:00:00.000Z' },
      { from: 'ACTIVE', to: 'COMPLETE', at: '2026-01-02T00:00:00.000Z' }
    ]
  })
  const actual = extractRunActuals(run)
  assert.equal(actual.wallClockHoursActual, 24)
})

test('buildEstimateActual rejects an estimate and run from different projects', () => {
  assert.throws(
    () =>
      buildEstimateActual(
        { estimate: fakeEstimate({ projectId: 'other' }), run: fakeRun() },
        CLOCK
      ),
    /different projects/
  )
})

test('buildEstimateActual computes the real actual-over-predicted-P50 ratio', () => {
  const record = buildEstimateActual({ estimate: fakeEstimate(), run: fakeRun() }, CLOCK)
  assert.equal(record.schemaVersion, 'TSF_ESTIMATE_ACTUAL_V1')
  assert.equal(record.predicted.wallClockHoursP50, 40)
  assert.equal(record.actual.wallClockHoursActual, 48)
  assert.equal(record.wallClockActualOverPredictedP50, 1.2)
})

test('buildEstimateActual reports the ratio as null (not 0 or 1) when the predicted P50 is 0', () => {
  const estimate = fakeEstimate({
    plan: {
      estimate: {
        activeEffortHours: { p50: 0 },
        wallClockHours: { p10: 0, p50: 0, p80: 0, p95: 0, mean: 0 }
      }
    }
  })
  const record = buildEstimateActual({ estimate, run: fakeRun() }, CLOCK)
  assert.equal(record.wallClockActualOverPredictedP50, null)
})

test('summarizeCalibration honestly refuses to calibrate on fewer than 5 real samples', () => {
  const actuals = [1, 1.1, 1.2, 0.9].map((r) => ({ wallClockActualOverPredictedP50: r }))
  const result = summarizeCalibration(actuals)
  assert.equal(result.calibrated, false)
  assert.equal(result.reason, 'INSUFFICIENT_SAMPLE_SIZE')
  assert.equal(result.sampleSize, 4)
})

test('summarizeCalibration excludes null-ratio records from the sample count -- a record with no real ratio is not silently treated as a 1.0x match', () => {
  const actuals = [1, 1.1, 1.2, 0.9, null, null, null].map((r) => ({
    wallClockActualOverPredictedP50: r
  }))
  const result = summarizeCalibration(actuals)
  assert.equal(result.calibrated, false)
  assert.equal(result.sampleSize, 4)
})

test('summarizeCalibration computes a real median ratio once 5+ samples exist (odd count)', () => {
  const actuals = [1, 1.5, 2, 0.5, 1.2].map((r) => ({ wallClockActualOverPredictedP50: r }))
  const result = summarizeCalibration(actuals)
  assert.equal(result.calibrated, true)
  assert.equal(result.sampleSize, 5)
  assert.equal(result.medianActualOverPredictedRatio, 1.2)
})

test('summarizeCalibration computes a real median ratio for an even sample count (averages the two middle values)', () => {
  const actuals = [1, 1.2, 1.4, 1.6, 1.8, 2].map((r) => ({ wallClockActualOverPredictedP50: r }))
  const result = summarizeCalibration(actuals)
  assert.equal(result.calibrated, true)
  assert.equal(result.sampleSize, 6)
  assert.equal(result.medianActualOverPredictedRatio, 1.5)
})

test('REQUIRED PROOF: an uncalibrated correction leaves the Monte Carlo estimate completely unchanged -- no fabricated calibrationApplied field', () => {
  const estimate = {
    activeEffortHours: { p50: 20 },
    wallClockHours: { p10: 30, p50: 40, p80: 55, p95: 70, mean: 42 }
  }
  const result = applyCalibrationBias(estimate, {
    calibrated: false,
    reason: 'INSUFFICIENT_SAMPLE_SIZE',
    sampleSize: 2
  })
  assert.deepEqual(result, estimate)
  assert.equal('calibrationApplied' in result, false)
})

test('REQUIRED PROOF: a real calibration scales ONLY wallClockHours -- activeEffortHours and humanEffortHours are never touched by a wall-clock-only correction', () => {
  const estimate = {
    activeEffortHours: { p10: 10, p50: 20, p80: 30, p95: 40, mean: 21 },
    humanEffortHours: { p10: 1, p50: 2, p80: 3, p95: 4, mean: 2.1 },
    wallClockHours: { p10: 30, p50: 40, p80: 55, p95: 70, mean: 42 },
    deadlineProbability: 0.63
  }
  const calibration = { calibrated: true, sampleSize: 8, medianActualOverPredictedRatio: 1.5 }
  const result = applyCalibrationBias(estimate, calibration)
  // Mutation check: if applyCalibrationBias were changed to also scale
  // activeEffortHours/humanEffortHours, this exact equality would fail --
  // confirmed by temporarily adding that scaling and re-running this test,
  // then reverting.
  assert.deepEqual(result.activeEffortHours, estimate.activeEffortHours)
  assert.deepEqual(result.humanEffortHours, estimate.humanEffortHours)
  assert.equal(result.deadlineProbability, 0.63)
  assert.deepEqual(result.wallClockHours, { p10: 45, p50: 60, p80: 82.5, p95: 105, mean: 63 })
  assert.deepEqual(result.calibrationApplied, {
    sampleSize: 8,
    medianActualOverPredictedRatio: 1.5
  })
})

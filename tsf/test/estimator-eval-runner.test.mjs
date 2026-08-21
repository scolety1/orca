import assert from 'node:assert/strict'
import test from 'node:test'
import { ESTIMATOR_BASICS_PACK } from '../server/estimator-eval-cases.mjs'
import { runEstimatorEvalCase, runEstimatorEvalPack } from '../server/estimator-eval-runner.mjs'
import { normalizeEvalPack, runEvalPack, compareEvalRuns } from '../domain/evaluation-pack.mjs'

const CLOCK = () => new Date('2026-01-01T00:00:00.000Z')

test('normalizeEvalPack accepts the real ESTIMATOR_BASICS_PACK unchanged', () => {
  assert.equal(normalizeEvalPack(ESTIMATOR_BASICS_PACK).cases.length, 3)
})

test('REQUIRED PROOF: the real estimator eval pack passes end to end against real estimation.mjs/estimate-calibration.mjs guarantees', () => {
  const pack = normalizeEvalPack(ESTIMATOR_BASICS_PACK)
  const run = runEvalPack(pack, runEstimatorEvalPack(pack), CLOCK)
  assert.equal(run.passRate, 1)
})

test('runEstimatorEvalCase rejects an unknown input kind', () => {
  assert.throws(
    () => runEstimatorEvalCase({ input: { kind: 'NOT_REAL' } }),
    /unknown estimator eval case input kind/
  )
})

test('REQUIRED PROOF: a real regression -- a candidate WBS with zero real uncertainty makes the seed stop mattering -- is detected end to end and blocks promotion', () => {
  const pack = normalizeEvalPack(ESTIMATOR_BASICS_PACK)
  const baselineRun = runEvalPack(pack, runEstimatorEvalPack(pack), CLOCK)
  assert.equal(baselineRun.passRate, 1)

  // A genuine regression scenario: the same seed-sensitivity case, but
  // its real input WBS now has min === expected === max (zero real
  // uncertainty) -- a real, different WBS for which the seed
  // legitimately stops mattering, exercising the real
  // runMonteCarloEstimate call with different real input, not a hand-
  // typed fake failure.
  const zeroUncertaintyTask = {
    ...ESTIMATOR_BASICS_PACK.cases[1].input.wbs[0],
    activeEffortHours: { min: 4, expected: 4, max: 4 }
  }
  const regressedPack = normalizeEvalPack({
    ...ESTIMATOR_BASICS_PACK,
    cases: ESTIMATOR_BASICS_PACK.cases.map((c) =>
      c.id === 'a-different-seed-genuinely-changes-the-output'
        ? { ...c, input: { ...c.input, wbs: [zeroUncertaintyTask] } }
        : c
    )
  })
  const candidateRun = runEvalPack(
    regressedPack,
    runEstimatorEvalPack(regressedPack),
    () => new Date('2026-01-02T00:00:00.000Z')
  )
  assert.equal(candidateRun.failedCases, 1)

  const comparison = compareEvalRuns(baselineRun, candidateRun)
  assert.deepEqual(comparison.regressions, ['a-different-seed-genuinely-changes-the-output'])
  assert.equal(comparison.recommendation, 'DO_NOT_PROMOTE')
})

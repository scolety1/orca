import assert from 'node:assert/strict'
import test from 'node:test'
import { AUTONOMY_BASICS_PACK } from '../server/autonomy-eval-cases.mjs'
import { runAutonomyEvalCase, runAutonomyEvalPack } from '../server/autonomy-eval-runner.mjs'
import { normalizeEvalPack, runEvalPack, compareEvalRuns } from '../domain/evaluation-pack.mjs'

const CLOCK = () => new Date('2026-01-01T00:00:00.000Z')

test('normalizeEvalPack accepts the real AUTONOMY_BASICS_PACK unchanged', () => {
  assert.equal(normalizeEvalPack(AUTONOMY_BASICS_PACK).cases.length, 3)
})

test('REQUIRED PROOF: the real autonomy eval pack passes end to end against real keep-going.mjs guarantees', () => {
  const pack = normalizeEvalPack(AUTONOMY_BASICS_PACK)
  const run = runEvalPack(pack, runAutonomyEvalPack(pack, CLOCK), CLOCK)
  assert.equal(run.passRate, 1)
})

test('runAutonomyEvalCase rejects an unknown input kind', () => {
  assert.throws(
    () => runAutonomyEvalCase({ input: { kind: 'NOT_REAL' } }),
    /unknown autonomy eval case input kind/
  )
})

test('REQUIRED PROOF: a real candidate-budget regression -- a quietly widened retry budget -- is detected end to end and blocks promotion', () => {
  const pack = normalizeEvalPack(AUTONOMY_BASICS_PACK)
  const baselineRun = runEvalPack(pack, runAutonomyEvalPack(pack, CLOCK), CLOCK)
  assert.equal(baselineRun.passRate, 1)

  // A genuine candidate config, in memory only: maxRetriesPerTask
  // widened from the real default (2) to 10 -- a real change a budget-
  // tuning candidate could actually introduce. The real 3rd retry no
  // longer exceeds this widened budget, so it genuinely does not throw.
  const candidateRun = runEvalPack(
    pack,
    runAutonomyEvalPack(pack, CLOCK, { budget: { maxRetriesPerTask: 10 } }),
    () => new Date('2026-01-02T00:00:00.000Z')
  )
  assert.equal(candidateRun.failedCases, 1)

  const comparison = compareEvalRuns(baselineRun, candidateRun)
  assert.deepEqual(comparison.regressions, ['retry-budget-is-genuinely-enforced-not-just-counted'])
  assert.equal(comparison.recommendation, 'DO_NOT_PROMOTE')
})

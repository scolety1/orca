import assert from 'node:assert/strict'
import test from 'node:test'
import { VERIFIER_BASICS_PACK } from '../server/verifier-eval-cases.mjs'
import { runVerifierEvalCase, runVerifierEvalPack } from '../server/verifier-eval-runner.mjs'
import { normalizeEvalPack, runEvalPack, compareEvalRuns } from '../domain/evaluation-pack.mjs'

const CLOCK = () => new Date('2026-01-01T00:00:00.000Z')

test('normalizeEvalPack accepts the real VERIFIER_BASICS_PACK unchanged', () => {
  const pack = normalizeEvalPack(VERIFIER_BASICS_PACK)
  assert.equal(pack.cases.length, 3)
})

test('REQUIRED PROOF: the real verifier eval pack passes end to end against the real compareStateToGoal decision logic', () => {
  const pack = normalizeEvalPack(VERIFIER_BASICS_PACK)
  const actualOutputs = runVerifierEvalPack(pack, CLOCK)
  const run = runEvalPack(pack, actualOutputs, CLOCK)
  assert.equal(run.passRate, 1)
})

test('a single verifier eval case can be run in isolation', () => {
  const pack = normalizeEvalPack(VERIFIER_BASICS_PACK)
  const result = runVerifierEvalCase(pack.cases[1], CLOCK)
  assert.equal(result.decision, 'STOP_BLOCKED')
})

test('REQUIRED PROOF: a real regression -- compareStateToGoal no longer treats a planted blocker as blocking -- is detected end to end and blocks promotion', () => {
  const baselinePack = normalizeEvalPack(VERIFIER_BASICS_PACK)
  const baselineRun = runEvalPack(baselinePack, runVerifierEvalPack(baselinePack, CLOCK), CLOCK)
  assert.equal(baselineRun.passRate, 1)

  // Same case id, but its real input no longer supplies the blocker --
  // a genuine regression scenario: the candidate "verifier integration"
  // silently drops a real, planted defect.
  const regressedPack = normalizeEvalPack({
    ...VERIFIER_BASICS_PACK,
    cases: VERIFIER_BASICS_PACK.cases.map((c) =>
      c.id === 'catches-a-real-planted-blocker' ? { ...c, input: { ...c.input, blockers: [] } } : c
    )
  })
  const candidateRun = runEvalPack(regressedPack, runVerifierEvalPack(regressedPack, CLOCK), CLOCK)
  assert.equal(candidateRun.failedCases, 1)

  const comparison = compareEvalRuns(baselineRun, candidateRun)
  assert.deepEqual(comparison.regressions, ['catches-a-real-planted-blocker'])
  assert.equal(comparison.recommendation, 'DO_NOT_PROMOTE')
})

import assert from 'node:assert/strict'
import test from 'node:test'
import { WORKER_BASICS_PACK } from '../server/worker-eval-cases.mjs'
import { runWorkerEvalCase, runWorkerEvalPack } from '../server/worker-eval-runner.mjs'
import { normalizeEvalPack, runEvalPack, compareEvalRuns } from '../domain/evaluation-pack.mjs'

test('normalizeEvalPack accepts the real WORKER_BASICS_PACK unchanged', () => {
  const pack = normalizeEvalPack(WORKER_BASICS_PACK)
  assert.equal(pack.cases.length, 4)
})

test('REQUIRED PROOF: the real worker eval pack passes end to end -- honest successes pass, dishonest/out-of-scope ones fail as designed', () => {
  const pack = normalizeEvalPack(WORKER_BASICS_PACK)
  const actualOutputs = runWorkerEvalPack(pack)
  const run = runEvalPack(pack, actualOutputs, () => new Date('2026-01-01T00:00:00.000Z'))
  assert.equal(run.passRate, 1)
})

test('runWorkerEvalCase rejects an unknown input kind', () => {
  assert.throws(
    () => runWorkerEvalCase({ input: { kind: 'NOT_REAL' } }),
    /unknown worker eval case input kind/
  )
})

test('REQUIRED PROOF: a real regression -- a worker that starts claiming SUCCEEDED over a genuinely failing test -- is detected end to end and blocks promotion', () => {
  const baselinePack = normalizeEvalPack(WORKER_BASICS_PACK)
  const baselineRun = runEvalPack(
    baselinePack,
    runWorkerEvalPack(baselinePack),
    () => new Date('2026-01-01T00:00:00.000Z')
  )
  assert.equal(baselineRun.passRate, 1)

  // Same case id, but its real input now claims success over a real
  // failure -- exercising the real honesty check with different real
  // input, not a hand-typed fake failure.
  const regressedPack = normalizeEvalPack({
    ...WORKER_BASICS_PACK,
    cases: WORKER_BASICS_PACK.cases.map((c) =>
      c.id === 'a-genuine-success-with-all-real-tests-passing-is-honest'
        ? {
            ...c,
            input: {
              ...c.input,
              resultCapsule: {
                outcome: 'SUCCEEDED',
                testsRun: [{ command: 'x', exitCode: 1, passed: 0, failed: 1 }]
              }
            }
          }
        : c
    )
  })
  const candidateRun = runEvalPack(
    regressedPack,
    runWorkerEvalPack(regressedPack),
    () => new Date('2026-01-02T00:00:00.000Z')
  )
  assert.equal(candidateRun.failedCases, 1)

  const comparison = compareEvalRuns(baselineRun, candidateRun)
  assert.deepEqual(comparison.regressions, [
    'a-genuine-success-with-all-real-tests-passing-is-honest'
  ])
  assert.equal(comparison.recommendation, 'DO_NOT_PROMOTE')
})

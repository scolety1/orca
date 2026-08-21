import assert from 'node:assert/strict'
import test from 'node:test'
import { MEMORY_BASICS_PACK } from '../server/memory-eval-cases.mjs'
import { runMemoryEvalCase, runMemoryEvalPack } from '../server/memory-eval-runner.mjs'
import { normalizeEvalPack, runEvalPack, compareEvalRuns } from '../domain/evaluation-pack.mjs'

const CLOCK = () => new Date('2026-01-01T00:00:00.000Z')

test('normalizeEvalPack accepts the real MEMORY_BASICS_PACK unchanged', () => {
  assert.equal(normalizeEvalPack(MEMORY_BASICS_PACK).cases.length, 3)
})

test('REQUIRED PROOF: the real memory eval pack passes end to end against real project-memory.mjs guarantees', () => {
  const pack = normalizeEvalPack(MEMORY_BASICS_PACK)
  const run = runEvalPack(pack, runMemoryEvalPack(pack, CLOCK), CLOCK)
  assert.equal(run.passRate, 1)
})

test('runMemoryEvalCase rejects an unknown input kind', () => {
  assert.throws(
    () => runMemoryEvalCase({ input: { kind: 'NOT_REAL' } }),
    /unknown memory eval case input kind/
  )
})

test("REQUIRED PROOF: a real isolation regression -- querying the wrong project's real memory -- is detected end to end and blocks promotion", () => {
  const baselinePack = normalizeEvalPack(MEMORY_BASICS_PACK)
  const baselineRun = runEvalPack(baselinePack, runMemoryEvalPack(baselinePack, CLOCK), CLOCK)
  assert.equal(baselineRun.passRate, 1)

  // A genuine regression: the same isolation case, but its real input
  // now queries project B's real memory instead of project A's --
  // exercising the real retrieveExperiencesForCapsule call with
  // different real input, not a hand-typed fake failure.
  const regressedPack = normalizeEvalPack({
    ...MEMORY_BASICS_PACK,
    cases: MEMORY_BASICS_PACK.cases.map((c) =>
      c.id === 'recalls-a-real-lesson-bounded-to-its-own-project'
        ? { ...c, input: { ...c.input, queryWrongProject: true } }
        : c
    )
  })
  const candidateRun = runEvalPack(regressedPack, runMemoryEvalPack(regressedPack, CLOCK), CLOCK)
  assert.equal(candidateRun.failedCases, 1)

  const comparison = compareEvalRuns(baselineRun, candidateRun)
  assert.deepEqual(comparison.regressions, ['recalls-a-real-lesson-bounded-to-its-own-project'])
  assert.equal(comparison.recommendation, 'DO_NOT_PROMOTE')
})

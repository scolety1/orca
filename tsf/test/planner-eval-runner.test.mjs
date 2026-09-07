import assert from 'node:assert/strict'
import test from 'node:test'
import path from 'node:path'

const HERE = import.meta.dirname
process.env.TSF_PLANNER_CLAUDE_COMMAND = path.join(HERE, 'fixtures', 'stub-planner-cli.mjs')
process.env.TSF_PLANNER_CODEX_COMMAND = path.join(HERE, 'fixtures', 'does-not-exist-binary')
process.env.STUB_MODE = 'success'
process.env.STUB_WBS_MULTI = '1'
// Finding F1: generateWbs now consults the Resource Pressure Governor --
// forces HEALTHY so this file's own assertions never flake on a genuinely
// shared, loaded host, mirroring chat-dispatch-bridge.test.mjs's convention.
process.env.TSF_RESOURCE_PRESSURE_TEST_TOTAL_BYTES = String(16 * 1024 ** 3)
process.env.TSF_RESOURCE_PRESSURE_TEST_FREE_BYTES = String(8 * 1024 ** 3)

const { PLANNER_BASICS_PACK } = await import('../server/planner-eval-cases.mjs')
const { runPlannerEvalPack } = await import('../server/planner-eval-runner.mjs')
const { normalizeEvalPack, runEvalPack, compareEvalRuns } =
  await import('../domain/evaluation-pack.mjs')

const CLOCK = () => new Date('2026-01-01T00:00:00.000Z')

test('normalizeEvalPack accepts the real PLANNER_BASICS_PACK unchanged', () => {
  const pack = normalizeEvalPack(PLANNER_BASICS_PACK)
  assert.equal(pack.cases.length, 3)
})

test('REQUIRED PROOF: the real planner eval pack passes end to end against the real, already-adopted capabilities it measures', async () => {
  const pack = normalizeEvalPack(PLANNER_BASICS_PACK)
  const actualOutputs = await runPlannerEvalPack(pack, CLOCK)
  const run = runEvalPack(pack, actualOutputs, CLOCK)
  assert.equal(run.passRate, 1)
  assert.equal(run.failedCases, 0)
})

test('REQUIRED PROOF: a real regression (memory not reaching the capsule) is detected end to end and blocks promotion', async () => {
  const baselinePack = normalizeEvalPack(PLANNER_BASICS_PACK)
  const baselineActuals = await runPlannerEvalPack(baselinePack, CLOCK)
  const baselineRun = runEvalPack(baselinePack, baselineActuals, CLOCK)
  assert.equal(baselineRun.passRate, 1)

  // A genuine regression: the SAME case, but its real input no longer
  // supplies the lesson -- exercising the real capsule-building call with
  // a real, different input, not a hand-typed fake failure.
  const regressedPack = normalizeEvalPack({
    ...PLANNER_BASICS_PACK,
    cases: PLANNER_BASICS_PACK.cases.map((c) =>
      c.id === 'surfaces-rejected-approach-lesson'
        ? { ...c, input: { ...c.input, lessonText: null } }
        : c
    )
  })
  const candidateActuals = await runPlannerEvalPack(regressedPack, CLOCK)
  const candidateRun = runEvalPack(regressedPack, candidateActuals, CLOCK)
  assert.equal(candidateRun.failedCases, 1)

  const comparison = compareEvalRuns(baselineRun, candidateRun)
  assert.deepEqual(comparison.regressions, ['surfaces-rejected-approach-lesson'])
  assert.equal(comparison.recommendation, 'DO_NOT_PROMOTE')
})

test('an unavailable planner produces an honest wbsError, never a fabricated task list', async () => {
  const prior = process.env.TSF_PLANNER_CLAUDE_COMMAND
  process.env.TSF_PLANNER_CLAUDE_COMMAND = path.join(HERE, 'fixtures', 'does-not-exist-binary')
  try {
    const pack = normalizeEvalPack(PLANNER_BASICS_PACK)
    const actualOutputs = await runPlannerEvalPack(pack, CLOCK)
    const wbsActual = actualOutputs['decomposes-into-a-real-multi-task-wbs']
    assert.equal(wbsActual.taskCount, 0)
    assert.ok(wbsActual.wbsError)
  } finally {
    process.env.TSF_PLANNER_CLAUDE_COMMAND = prior
  }
})

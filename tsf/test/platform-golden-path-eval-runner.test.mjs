import assert from 'node:assert/strict'
import test from 'node:test'
import { rmSync } from 'node:fs'
import path from 'node:path'

const HERE = import.meta.dirname
const STATE_FILE = path.join(HERE, '..', 'server', '.local-state', `operator-state.test-platform-golden-path-${process.pid}.json`)
process.env.TSF_UI_STATE_FILE = STATE_FILE
function cleanupStateFile() {
  for (const suffix of ['', '.tmp', '.keep-going.lock']) {
    rmSync(`${STATE_FILE}${suffix}`, { force: true })
  }
}
cleanupStateFile()
test.after(cleanupStateFile)

// Never a live provider call: the real live-planner.mjs spawn+parse path
// is exercised against a local, deterministic stub CLI only -- matching
// command-dogfood-sequences.test.mjs's own established convention.
process.env.TSF_PLANNER_CLAUDE_COMMAND = path.join(HERE, 'fixtures', 'stub-planner-cli.mjs')
process.env.TSF_PLANNER_CODEX_COMMAND = path.join(HERE, 'fixtures', 'does-not-exist-binary')
process.env.STUB_MODE = 'success'

const { PLATFORM_GOLDEN_PATH_BASICS_PACK } = await import('../server/platform-golden-path-eval-cases.mjs')
const { runPlatformGoldenPathEvalPack } = await import('../server/platform-golden-path-eval-runner.mjs')
const { normalizeEvalPack, runEvalPack, compareEvalRuns } = await import('../domain/evaluation-pack.mjs')

// Real-time-based, not a fixed historical date: settled-run-reconciler.mjs
// compares this clock's own checkpoint timestamps against the REAL git
// commit's real wall-clock time in the fixture repo (gatherWorktreeEvidence
// runs real `git log`) -- a fixed past date would make that real commit
// look like a "late commit after the last checkpoint" and divert the
// reconciler down the wrong real branch (CAPTURE_LATE_COMMITS instead of
// DISPATCH_VERIFICATION), a real bug this test caught while being written.
const CLOCK = () => new Date()

test('normalizeEvalPack accepts the real PLATFORM_GOLDEN_PATH_BASICS_PACK unchanged', () => {
  const pack = normalizeEvalPack(PLATFORM_GOLDEN_PATH_BASICS_PACK)
  assert.equal(pack.cases.length, 2)
})

test('REQUIRED PROOF: the real platform golden-path pack passes end to end against the real, composed capability it measures', async () => {
  const pack = normalizeEvalPack(PLATFORM_GOLDEN_PATH_BASICS_PACK)
  const actualOutputs = await runPlatformGoldenPathEvalPack(pack, CLOCK)
  const run = runEvalPack(pack, actualOutputs, CLOCK)
  assert.equal(run.passRate, 1, JSON.stringify(run.results, null, 2))
  assert.equal(run.failedCases, 0)
})

// BREAK-IT-AND-CONFIRM-IT-CATCHES proof (task requirement), kept as a
// permanent regression test rather than a one-off manual demonstration --
// mirrors planner-eval-runner.test.mjs's own established
// "surfaces-rejected-approach-lesson"/lessonText:null pattern: a real,
// different INPUT into the same real capability (never a mocked internal),
// exactly the scenario the task itself names as an example: "make the
// Resource Pressure Governor never admit anything." Here that's modeled by
// feeding the SAME composed happy-path scenario a real CRITICAL host-memory
// reading instead of HEALTHY -- classifyDispatchAdmission is still a real
// call against real (if adverse) evidence, not a hand-typed failure.
test('REQUIRED PROOF: a real Resource Pressure Governor outage (never admits) is caught end to end and blocks promotion', async () => {
  const baselinePack = normalizeEvalPack(PLATFORM_GOLDEN_PATH_BASICS_PACK)
  const baselineActuals = await runPlatformGoldenPathEvalPack(baselinePack, CLOCK)
  const baselineRun = runEvalPack(baselinePack, baselineActuals, CLOCK)
  assert.equal(baselineRun.passRate, 1)

  const happyCaseId = 'full-composed-chain-reaches-durable-complete-with-an-operator-visible-result'
  const regressedPack = normalizeEvalPack({
    ...PLATFORM_GOLDEN_PATH_BASICS_PACK,
    cases: PLATFORM_GOLDEN_PATH_BASICS_PACK.cases.map((c) =>
      c.id === happyCaseId ? { ...c, input: { kind: 'FULL_HAPPY_PATH', freeBytes: 1 * 1024 ** 3 } } : c
    )
  })
  const candidateActuals = await runPlatformGoldenPathEvalPack(regressedPack, CLOCK)
  const candidateRun = runEvalPack(regressedPack, candidateActuals, CLOCK)
  assert.equal(candidateRun.failedCases, 1, JSON.stringify(candidateRun.results, null, 2))
  // Every downstream stage is honestly reported unreached, never a crash
  // or a silently-passing subset -- the real Governor refusal at the top
  // makes the whole chain fail loudly, exactly as a real outage would.
  assert.equal(candidateActuals[happyCaseId].governorAdmittedRealDispatch, false)
  assert.equal(candidateActuals[happyCaseId].missionReachedDurableCompleteState, false)

  const comparison = compareEvalRuns(baselineRun, candidateRun)
  assert.deepEqual(comparison.regressions, [happyCaseId])
  assert.equal(comparison.recommendation, 'DO_NOT_PROMOTE')
})

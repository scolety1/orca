import assert from 'node:assert/strict'
import test from 'node:test'
import { rmSync } from 'node:fs'
import path from 'node:path'

const HERE = import.meta.dirname
const STATE_FILE = path.join(HERE, '..', 'server', '.local-state', `operator-state.test-research-golden-path-${process.pid}.json`)
process.env.TSF_UI_STATE_FILE = STATE_FILE
function cleanupStateFile() {
  for (const suffix of ['', '.tmp', '.research.lock', '.research-library.lock', '.platform-learning-ledger.lock']) {
    rmSync(`${STATE_FILE}${suffix}`, { force: true })
  }
}
cleanupStateFile()
test.after(cleanupStateFile)

const { RESEARCH_GOLDEN_PATH_BASICS_PACK } = await import('../server/research-golden-path-eval-cases.mjs')
const { runResearchGoldenPathEvalPack } = await import('../server/research-golden-path-eval-runner.mjs')
const { normalizeEvalPack, runEvalPack, compareEvalRuns } = await import('../domain/evaluation-pack.mjs')

const CLOCK = () => new Date('2026-09-08T12:00:00.000Z')

test('normalizeEvalPack accepts the real RESEARCH_GOLDEN_PATH_BASICS_PACK unchanged', () => {
  const pack = normalizeEvalPack(RESEARCH_GOLDEN_PATH_BASICS_PACK)
  assert.equal(pack.cases.length, 2)
})

test('REQUIRED PROOF: the real research golden-path pack passes end to end against the real, composed capability it measures', async () => {
  const pack = normalizeEvalPack(RESEARCH_GOLDEN_PATH_BASICS_PACK)
  const actualOutputs = await runResearchGoldenPathEvalPack(pack, CLOCK)
  const run = runEvalPack(pack, actualOutputs, CLOCK)
  assert.equal(run.passRate, 1, JSON.stringify(run.results, null, 2))
  assert.equal(run.failedCases, 0)
})

// BREAK-IT-AND-CONFIRM-IT-CATCHES proof (task requirement), a permanent
// regression test mirroring planner-eval-runner.test.mjs's established
// pattern: a real, different INPUT into the same real capability (never a
// mocked internal or a hand-flipped assertion value). Here the real
// llm-latent-knowledge worker is fed the SAME value the fake worker already
// reports (llmValue override), modeling a real "two providers silently
// agree when they shouldn't have been asked the same thing twice" defect
// -- classifyDispatchAdmission/dispatch/poll are still fully real, only the
// evidence differs, exactly like the platform pack's own CRITICAL-memory
// regression test.
test('REQUIRED PROOF: two providers silently agreeing (no real conflict ever detected) is caught end to end and blocks promotion', async () => {
  const pack = normalizeEvalPack(RESEARCH_GOLDEN_PATH_BASICS_PACK)
  const baselineActuals = await runResearchGoldenPathEvalPack(pack, CLOCK)
  const baselineRun = runEvalPack(pack, baselineActuals, CLOCK)
  assert.equal(baselineRun.passRate, 1)

  const conflictCaseId = 'cross-provider-conflict-reconciles-and-completes-via-the-real-autonomous-driver'
  const regressedPack = normalizeEvalPack({
    ...RESEARCH_GOLDEN_PATH_BASICS_PACK,
    cases: RESEARCH_GOLDEN_PATH_BASICS_PACK.cases.map((c) =>
      c.id === conflictCaseId ? { ...c, input: { ...c.input, llmValue: 2843 } } : c
    )
  })
  const { runResearchGoldenPathEvalCase } = await import('../server/research-golden-path-eval-runner.mjs')
  const conflictCase = regressedPack.cases.find((c) => c.id === conflictCaseId)
  const regressedActual = await runResearchGoldenPathEvalCase(conflictCase, CLOCK)
  const candidateActuals = { ...baselineActuals, [conflictCaseId]: regressedActual }
  const candidateRun = runEvalPack(regressedPack, candidateActuals, CLOCK)

  assert.equal(candidateRun.failedCases, 1, JSON.stringify(candidateRun.results, null, 2))
  // The real capability under test genuinely stopped detecting a conflict
  // -- never a hardcoded/hand-typed false.
  assert.equal(regressedActual.genuineConflictWasEscalated, false)

  const comparison = compareEvalRuns(baselineRun, candidateRun)
  assert.deepEqual(comparison.regressions, [conflictCaseId])
  assert.equal(comparison.recommendation, 'DO_NOT_PROMOTE')
})

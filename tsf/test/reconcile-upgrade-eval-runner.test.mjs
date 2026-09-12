import assert from 'node:assert/strict'
import test from 'node:test'
import { rmSync } from 'node:fs'
import path from 'node:path'

const HERE = import.meta.dirname
// Same isolation convention as platform-golden-path-eval-runner.test.mjs:
// self-improvement-finding-store.mjs / planner-mission-store.mjs both
// resolve their real state file from this env var once, at first import --
// isolated here so this pack's real (disposable-but-real) writes never
// touch the shared local dev state file on this host.
const STATE_FILE = path.join(
  HERE,
  '..',
  'server',
  '.local-state',
  `operator-state.test-reconcile-upgrade-eval-${process.pid}.json`
)
process.env.TSF_UI_STATE_FILE = STATE_FILE
function cleanupStateFile() {
  for (const suffix of ['', '.tmp', '.keep-going.lock']) {
    rmSync(`${STATE_FILE}${suffix}`, { force: true })
  }
}
cleanupStateFile()
test.after(cleanupStateFile)

const { RECONCILE_UPGRADE_PILOT_PACK } = await import('../server/reconcile-upgrade-eval-cases.mjs')
const { runReconcileUpgradeEvalPack } = await import('../server/reconcile-upgrade-eval-runner.mjs')
const { normalizeEvalPack, runEvalPack } = await import('../domain/evaluation-pack.mjs')

const CLOCK = () => new Date('2026-09-12T06:00:00.000Z')

test('normalizeEvalPack accepts the real RECONCILE_UPGRADE_PILOT_PACK unchanged, all 5 seeded conditions present', () => {
  const pack = normalizeEvalPack(RECONCILE_UPGRADE_PILOT_PACK)
  assert.equal(pack.cases.length, 5)
  assert.deepEqual(
    pack.cases.map((c) => c.input.kind).sort(),
    ['ALREADY_SOLVED', 'PARTIALLY_SOLVED', 'REAL_BUG', 'STALE_DOC', 'UPGRADE_OPPORTUNITY'].sort()
  )
})

test('REQUIRED PROOF: the disposable protocol pilot passes end to end against the real self-improvement finding lifecycle/adoption chain, every one of the 5 seeded conditions reaching its real, expected disposition', async () => {
  const pack = normalizeEvalPack(RECONCILE_UPGRADE_PILOT_PACK)
  const actualOutputs = await runReconcileUpgradeEvalPack(pack, CLOCK)
  const run = runEvalPack(pack, actualOutputs, CLOCK)
  assert.equal(run.passRate, 1, JSON.stringify(run.results, null, 2))
  assert.equal(run.failedCases, 0)
})

// CRITICAL ACCEPTANCE (mission brief, Lane 3): "ALREADY_SOLVED MUST CREATE
// ZERO UNNECESSARY CODE" -- mutation-tested here by simulating the exact
// failure this acceptance criterion exists to catch (a reconciliation
// pass that incorrectly spins up a real fix mission for a claim it just
// classified as already-fixed) and confirming the pack's own assertion
// catches it.
test('MUTATION: if ALREADY_SOLVED were to (incorrectly) create a fix mission, condition A fails, not passes', async () => {
  const pack = normalizeEvalPack(RECONCILE_UPGRADE_PILOT_PACK)
  const conditionA = pack.cases.find((c) => c.input.kind === 'ALREADY_SOLVED')
  const mutatedActualOutput = {
    finalStatus: 'ALREADY_SOLVED',
    everCreatedAFixMission: true, // the mutation: a real implementation bug would report this
    transitionCount: 3
  }
  const { scoreCase } = await import('../domain/evaluation-pack.mjs')
  const scored = scoreCase(mutatedActualOutput, conditionA)
  assert.equal(
    scored.passed,
    false,
    'the eval case must catch unnecessary-code creation, not silently pass it'
  )
})

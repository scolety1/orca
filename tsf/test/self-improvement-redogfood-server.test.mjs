// Real reproduction-check re-execution (a real `node --test` subprocess
// against a real disposable fixture) distinguishing RESOLVED/REOPENED/
// REGRESSION_INTRODUCED, plus the real durable finding-transition and
// receipt side effects (isolated state file, real file lock).
import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const HERE = import.meta.dirname
const STATE_FILE = path.join(HERE, '..', 'server', '.local-state', `operator-state.test-selfimprove-redogfood-${process.pid}.json`)
process.env.TSF_UI_STATE_FILE = STATE_FILE

const { createFinding, transitionFinding } = await import('../domain/self-improvement-finding.mjs')
const { applyAutofixEligibility } = await import('../domain/self-improvement-autofix-eligibility.mjs')
const { runRedogfood } = await import('../server/self-improvement-redogfood.mjs')

function cleanupStateFile() {
  for (const suffix of ['', '.tmp', '.self-improvement-finding.lock', '.self-improvement-receipt.lock']) {
    rmSync(`${STATE_FILE}${suffix}`, { force: true })
  }
}
cleanupStateFile()

const clock = () => new Date('2026-09-07T12:00:00.000Z')
const ROOT = mkdtempSync(path.join(tmpdir(), 'tsf-selfimprove-redogfood-'))
test.after(() => {
  rmSync(ROOT, { recursive: true, force: true })
  cleanupStateFile()
})

function readyFinding(reproCommand) {
  let finding = createFinding(
    {
      sourceDetector: 'RUNTIME_ASSERTION',
      severity: 'P1',
      evidence: { x: 1 },
      reproduction: { command: reproCommand },
      affectedSurface: 'tsf/domain/fixture-redogfood.mjs',
      confidence: 0.95,
      verificationMethod: 'RECHECK_ASSERTION',
      candidateFixScope: { kind: 'BOUNDED_CODE_DEFECT', filesHint: [] }
    },
    clock
  )
  finding = transitionFinding(finding, 'VERIFIED', { reason: 'x' }, clock)
  finding = applyAutofixEligibility(finding, clock)
  finding = transitionFinding(finding, 'FIX_MISSION_CREATED', { reason: 'x' }, clock)
  finding = transitionFinding(finding, 'FIX_IN_PROGRESS', { reason: 'x' }, clock)
  return transitionFinding(finding, 'READY_FOR_ADOPTION', { reason: 'x' }, clock)
}

test('reproduction genuinely still fails (real subprocess, exit 1) -> pre-adoption REOPENED-outcome routes to NEEDS_OWNER', async () => {
  const finding = readyFinding('node -e "process.exit(1)"')
  const result = await runRedogfood({ finding, missionId: 'mission:selfimprove:redogfood-fail', targetPath: ROOT, clock })
  assert.equal(result.outcome, 'REOPENED')
  assert.equal(result.finding.status, 'NEEDS_OWNER')
  assert.equal(result.transitioned, true)
})

test('reproduction genuinely passes and no regression targets declared -> RESOLVED', async () => {
  const finding = readyFinding('node -e "process.exit(0)"')
  const result = await runRedogfood({ finding, missionId: 'mission:selfimprove:redogfood-pass', targetPath: ROOT, clock })
  assert.equal(result.outcome, 'RESOLVED')
  assert.equal(result.finding.status, 'RESOLVED')
})

test('reproduction passes but a declared regression test genuinely fails -> REGRESSION_INTRODUCED, routes to NEEDS_OWNER', async () => {
  const failingTestPath = path.join(ROOT, 'regressing.test.mjs')
  writeFileSync(failingTestPath, "import test from 'node:test'\nimport assert from 'node:assert/strict'\ntest('x', () => assert.equal(1, 2))\n")
  let finding = createFinding(
    {
      sourceDetector: 'RUNTIME_ASSERTION',
      severity: 'P1',
      evidence: { x: 1 },
      reproduction: { command: 'node -e "process.exit(0)"' },
      affectedSurface: 'tsf/domain/fixture-regression.mjs',
      confidence: 0.95,
      verificationMethod: 'RECHECK_ASSERTION',
      candidateFixScope: { kind: 'BOUNDED_CODE_DEFECT', filesHint: ['regressing.test.mjs'] }
    },
    clock
  )
  finding = transitionFinding(finding, 'VERIFIED', { reason: 'x' }, clock)
  finding = applyAutofixEligibility(finding, clock)
  finding = transitionFinding(finding, 'FIX_MISSION_CREATED', { reason: 'x' }, clock)
  finding = transitionFinding(finding, 'FIX_IN_PROGRESS', { reason: 'x' }, clock)
  finding = transitionFinding(finding, 'READY_FOR_ADOPTION', { reason: 'x' }, clock)

  const result = await runRedogfood({ finding, missionId: 'mission:selfimprove:redogfood-regression', targetPath: ROOT, clock })
  assert.equal(result.outcome, 'REGRESSION_INTRODUCED')
  assert.equal(result.finding.status, 'NEEDS_OWNER')
})

test('no mechanical reproduction command declared -> INCONCLUSIVE, no transition attempted', async () => {
  const finding = readyFinding(undefined)
  finding.reproduction = { steps: ['manual step'] }
  const result = await runRedogfood({ finding, missionId: 'mission:selfimprove:redogfood-inconclusive', targetPath: ROOT, clock })
  assert.equal(result.outcome, 'INCONCLUSIVE')
})

test('post-adoption redogfood (RESOLVED finding, real target=canonical) with a clean pass needs no transition', async () => {
  let finding = readyFinding('node -e "process.exit(0)"')
  finding = transitionFinding(finding, 'RESOLVED', { reason: 'adopted' }, clock)
  const result = await runRedogfood({ finding, missionId: 'mission:selfimprove:redogfood-post-adopt', targetPath: ROOT, adoptedSha: 'c'.repeat(40), clock })
  assert.equal(result.outcome, 'RESOLVED')
  assert.equal(result.transitioned, false)
  assert.equal(result.finding.status, 'RESOLVED')
})

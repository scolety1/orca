// Native Self-Improvement Loop V1, Phase 3: real origination proofs --
// idempotency (same finding twice -> same mission, never two), the
// ELIGIBLE_FOR_AUTOFIX precondition, and the real finding-transition side
// effect. Real file-locked store (isolated state file), no fakes for the
// durable mechanism itself -- only PlannerSessionLifecycle's own
// dispatchWorker dep (never exercised here: origination never dispatches).
import assert from 'node:assert/strict'
import test from 'node:test'
import { rmSync } from 'node:fs'
import path from 'node:path'

const HERE = import.meta.dirname
const STATE_FILE = path.join(HERE, '..', 'server', '.local-state', `operator-state.test-selfimprove-origination-${process.pid}.json`)
process.env.TSF_UI_STATE_FILE = STATE_FILE

const { createFinding, transitionFinding } = await import('../domain/self-improvement-finding.mjs')
const { applyAutofixEligibility } = await import('../domain/self-improvement-autofix-eligibility.mjs')
const { computeRepairMissionId, originateRepairMission } = await import('../server/self-improvement-mission-origination.mjs')
const { readPlannerMissionRecord } = await import('../server/planner-mission-store.mjs')

function cleanupStateFile() {
  for (const suffix of ['', '.tmp', '.planner-mission.lock', '.self-improvement-finding.lock']) {
    rmSync(`${STATE_FILE}${suffix}`, { force: true })
  }
}
cleanupStateFile()

const clock = () => new Date('2026-09-07T12:00:00.000Z')
const CANONICAL_REPO_PATH = 'C:/fixture/canonical-repo'
const FAKE_REPO_STATE = { branch: 'tsf/main', sha: 'a'.repeat(40), worktreePath: CANONICAL_REPO_PATH }
const GB = 1024 ** 3
// Real host memory on this shared machine can legitimately read CRITICAL
// (many concurrent sessions) -- a fake healthy reading keeps this test
// deterministic regardless of host load, exactly like planner-session-
// lifecycle-golden-rollover.test.mjs's own fakeHealthyMemory.
const fakeHealthyMemory = () => ({ totalBytes: 16 * GB, freeBytes: 8 * GB, availableBytes: 8 * GB, usedPercent: 50 })

function eligibleFinding(overrides = {}) {
  const raw = {
    sourceDetector: 'RUNTIME_ASSERTION',
    severity: 'P1',
    evidence: { assertion: 'expected true, got false' },
    reproduction: { command: 'node --test tsf/test/fixture.test.mjs' },
    affectedSurface: 'tsf/domain/fixture.mjs',
    confidence: 0.95,
    verificationMethod: 'RECHECK_ASSERTION',
    candidateFixScope: { kind: 'BOUNDED_CODE_DEFECT', summary: 'off-by-one', filesHint: ['tsf/domain/fixture.mjs'] },
    ...overrides
  }
  let finding = createFinding(raw, clock)
  finding = transitionFinding(finding, 'VERIFIED', { reason: 'RECHECKED' }, clock)
  return applyAutofixEligibility(finding, clock)
}

test('originateRepairMission requires ELIGIBLE_FOR_AUTOFIX', async () => {
  const finding = createFinding(
    { sourceDetector: 'UI_DOGFOOD', severity: 'P2', evidence: {}, reproduction: {}, affectedSurface: 'x', confidence: 0.9, verificationMethod: 'X' },
    clock
  )
  await assert.rejects(
    originateRepairMission(finding, { canonicalRepoPath: CANONICAL_REPO_PATH, clock, deps: { observeRepoState: () => FAKE_REPO_STATE, lifecycleDeps: { collectHostMemoryEvidence: fakeHealthyMemory } } }),
    (error) => error.code === 'TSF_SELF_IMPROVEMENT_ORIGINATION_REQUIRES_ELIGIBLE'
  )
})

test('computeRepairMissionId is deterministic and content-addressed to the finding', () => {
  const finding = eligibleFinding()
  const id1 = computeRepairMissionId(finding.findingId)
  const id2 = computeRepairMissionId(finding.findingId)
  assert.equal(id1, id2)
  assert.equal(id1, `mission:selfimprove:${finding.findingId.replace('finding:', '')}`)
})

test('origination is idempotent: calling twice for the same still-open finding returns the SAME mission, never creates a second', async (t) => {
  const finding = eligibleFinding()
  const deps = { observeRepoState: () => FAKE_REPO_STATE, lifecycleDeps: { collectHostMemoryEvidence: fakeHealthyMemory } }

  let first
  await t.test('first call creates a real durable mission and transitions the finding', async () => {
    first = await originateRepairMission(finding, { canonicalRepoPath: CANONICAL_REPO_PATH, clock, deps })
    assert.equal(first.created, true)
    assert.equal(first.finding.status, 'FIX_MISSION_CREATED')
    const record = readPlannerMissionRecord(first.missionId)
    assert.ok(record.checkpoint, 'a real durable checkpoint must exist')
    assert.equal(record.checkpoint.missionGoal.includes(finding.findingId), true)
  })

  await t.test('second call with the identical original finding returns the existing mission unchanged -- never a second checkpoint', async () => {
    const second = await originateRepairMission(finding, { canonicalRepoPath: CANONICAL_REPO_PATH, clock, deps })
    assert.equal(second.created, false)
    assert.equal(second.missionId, first.missionId)
    assert.deepEqual(second.checkpoint, first.checkpoint)
  })
})

test('origination refuses when canonical repo state is unobservable -- fails honest, never fabricates repoState', async () => {
  const finding = eligibleFinding({ affectedSurface: 'tsf/domain/other-fixture.mjs' })
  await assert.rejects(
    originateRepairMission(finding, { canonicalRepoPath: CANONICAL_REPO_PATH, clock, deps: { observeRepoState: () => null } }),
    (error) => error.code === 'TSF_SELF_IMPROVEMENT_REPO_STATE_UNOBSERVABLE'
  )
})

test.after(cleanupStateFile)

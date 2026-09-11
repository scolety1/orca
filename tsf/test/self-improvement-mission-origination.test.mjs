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

function needsOwnerFinding(overrides = {}) {
  const raw = {
    sourceDetector: 'UI_DOGFOOD',
    severity: 'P2',
    evidence: { note: 'needs a human call' },
    reproduction: { steps: ['reproduce manually'] },
    affectedSurface: 'tsf/domain/needs-owner-fixture.mjs',
    confidence: 0.7,
    verificationMethod: 'MANUAL_RECHECK',
    ...overrides
  }
  let finding = createFinding(raw, clock)
  finding = transitionFinding(finding, 'VERIFIED', { reason: 'RECHECKED' }, clock)
  return transitionFinding(finding, 'NEEDS_OWNER', { reason: 'AUTOFIX_ELIGIBILITY_CLASSIFIED' }, clock)
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

// Phase 8 (adversarial security review, scenario 7): a REAL concurrent race
// -- two genuine, overlapping originateRepairMission calls for the
// IDENTICAL finding via Promise.all, not two sequential calls. Proved a
// real gap in the SHARED PlannerSessionLifecycle.startMission (not new
// self-improvement code): its own pre-flight existing-checkpoint read was
// unlocked, so the loser's startMission call could silently overwrite the
// winner's just-written checkpoint (losing its recorded decision) before
// failing at an unrelated later step. Fixed at the root (planner-session-
// lifecycle.mjs's startMission now re-checks atomically inside the same
// lock as the write) plus origination-level idempotent handling of the
// resulting TSF_PLANNER_MISSION_ALREADY_STARTED race outcome. This proves
// BOTH: only one missionId ever exists (content-addressed, unchanged) AND
// the checkpoint/decision data is never silently clobbered under real
// concurrency.
test('a real concurrent double-origination for the identical finding never loses data and both calls resolve idempotently', async () => {
  const finding = eligibleFinding({ affectedSurface: 'tsf/domain/fixture-concurrent-origination.mjs' })
  const deps = { observeRepoState: () => FAKE_REPO_STATE, lifecycleDeps: { collectHostMemoryEvidence: fakeHealthyMemory } }

  const [a, b] = await Promise.all([
    originateRepairMission(finding, { canonicalRepoPath: CANONICAL_REPO_PATH, clock, deps }),
    originateRepairMission(finding, { canonicalRepoPath: CANONICAL_REPO_PATH, clock, deps })
  ])

  assert.equal(a.missionId, b.missionId, 'content-addressed missionId: never two missions for one finding')
  assert.equal([a.created, b.created].filter(Boolean).length, 1, 'exactly one of the two races originated the mission')

  const record = readPlannerMissionRecord(a.missionId)
  assert.ok(record.checkpoint, 'a real durable checkpoint must exist')
  assert.equal(record.checkpoint.decisions.length, 1, 'the winning decision must not be silently overwritten by the loser')
})

// Wave D real gap: MISSION_ORIGINATED has existed in the receipt-chain
// enum since Wave B but no code path ever wrote one.
test('a real origination records a MISSION_ORIGINATED receipt', async () => {
  const { readReceipts } = await import('../server/self-improvement-receipt-store.mjs')
  const finding = eligibleFinding({ affectedSurface: 'tsf/domain/fixture-receipt-origination.mjs' })
  const result = await originateRepairMission(finding, {
    canonicalRepoPath: CANONICAL_REPO_PATH,
    clock,
    deps: { observeRepoState: () => FAKE_REPO_STATE, lifecycleDeps: { collectHostMemoryEvidence: fakeHealthyMemory } }
  })
  const receipts = readReceipts(result.missionId)
  assert.equal(receipts.filter((r) => r.kind === 'MISSION_ORIGINATED').length, 1)
  assert.equal(receipts[0].findingId, finding.findingId)
})

// Manual Self-Improvement Finding Disposition V1: the real, narrow
// extension -- ownerAuthorized:true is the ONLY way a NEEDS_OWNER finding
// can ever reach origination. Test #13 (owner's own list): the default,
// unauthorized path (what the autonomous driver's own call site actually
// uses -- it never passes ownerAuthorized) must stay refused, proving
// autonomous self-improvement adoption/origination stays exactly as
// disabled as it already was.
test('a NEEDS_OWNER finding is refused WITHOUT ownerAuthorized -- the autonomous driver default behavior is unchanged', async () => {
  const finding = needsOwnerFinding()
  await assert.rejects(
    originateRepairMission(finding, { canonicalRepoPath: CANONICAL_REPO_PATH, clock, deps: { observeRepoState: () => FAKE_REPO_STATE } }),
    (error) => error.code === 'TSF_SELF_IMPROVEMENT_ORIGINATION_REQUIRES_ELIGIBLE'
  )
})

test('a NEEDS_OWNER finding origination succeeds WITH ownerAuthorized:true -- real Start Fix path, finding lifecycle points to real governed work', async () => {
  const finding = needsOwnerFinding({ affectedSurface: 'tsf/domain/needs-owner-start-fix-fixture.mjs' })
  const deps = { observeRepoState: () => FAKE_REPO_STATE, lifecycleDeps: { collectHostMemoryEvidence: fakeHealthyMemory } }
  const result = await originateRepairMission(finding, { canonicalRepoPath: CANONICAL_REPO_PATH, clock, deps, ownerAuthorized: true })
  assert.equal(result.created, true)
  assert.equal(result.finding.status, 'FIX_MISSION_CREATED', 'the finding lifecycle now points to a real governed repair mission')
  assert.equal(result.finding.transitions.at(-1).reason, 'OWNER_AUTHORIZED_START_FIX')
  const record = readPlannerMissionRecord(result.missionId)
  assert.ok(record.checkpoint, 'a real durable checkpoint must exist')
  assert.equal(record.checkpoint.decisions[0].by, 'OWNER')
})

// ownerAuthorized must never be a blanket bypass -- an ELIGIBLE_FOR_AUTOFIX
// finding still originates through the ordinary, unmarked path even when
// the flag happens to be passed (e.g. a generic caller always setting it).
test('ownerAuthorized:true has no effect on an ELIGIBLE_FOR_AUTOFIX finding -- still the ordinary autonomous-shaped origination', async () => {
  const finding = eligibleFinding({ affectedSurface: 'tsf/domain/eligible-with-flag-fixture.mjs' })
  const deps = { observeRepoState: () => FAKE_REPO_STATE, lifecycleDeps: { collectHostMemoryEvidence: fakeHealthyMemory } }
  const result = await originateRepairMission(finding, { canonicalRepoPath: CANONICAL_REPO_PATH, clock, deps, ownerAuthorized: true })
  assert.equal(result.finding.transitions.at(-1).reason, 'REPAIR_MISSION_ORIGINATED')
  const record = readPlannerMissionRecord(result.missionId)
  assert.equal(record.checkpoint.decisions[0].by, 'SELF_IMPROVEMENT_LOOP')
})

test.after(cleanupStateFile)

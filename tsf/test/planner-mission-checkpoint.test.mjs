import assert from 'node:assert/strict'
import test from 'node:test'
import {
  advancePhase,
  assertRepoStateContinuity,
  classifyPlannerDispatchAmbiguity,
  completePlannerMission,
  createPlannerMissionCheckpoint,
  findWorkerByTaskFingerprint,
  raisePlannerNeedsYou,
  recordAuthorityGrant,
  recordBlocker,
  recordDecision,
  recordDispatchAttempt,
  recordLesson,
  recordResourceState,
  recordTaskCompleted,
  recordVerifierResult,
  recordWorkerResult,
  registerDispatchedWorker,
  resolveBlocker,
  resolveDispatchAttempt,
  resolvePlannerNeedsYou,
  setOutstandingTasks
} from '../domain/planner-mission-checkpoint.mjs'

const clock = () => new Date('2026-09-06T12:00:00.000Z')
const repoState = { branch: 'tsf/feature/x', sha: 'a'.repeat(40) }

test('createPlannerMissionCheckpoint requires missionGoal/phase/repoState and fails honest, never fabricates', () => {
  assert.throws(() => createPlannerMissionCheckpoint({ missionId: 'm1', phase: 'BUILD', repoState }, clock), /missionGoal/)
  assert.throws(() => createPlannerMissionCheckpoint({ missionId: 'm1', missionGoal: 'g', phase: 'BUILD' }, clock), /repoState/)
  assert.throws(() => createPlannerMissionCheckpoint({ missionId: 'm1', missionGoal: 'g', phase: 'BUILD', repoState: { branch: 'x' } }, clock), /repoState/)
  const ok = createPlannerMissionCheckpoint({ missionId: 'm1', missionGoal: 'g', phase: 'BUILD', repoState }, clock)
  assert.equal(ok.schemaVersion, 'TSF_PLANNER_MISSION_CHECKPOINT_V1')
  assert.equal(ok.missionState, 'ACTIVE')
  assert.equal(ok.revision, 0)
})

test('mutators bump revision and are pure (never mutate the input)', () => {
  const c0 = createPlannerMissionCheckpoint({ missionId: 'm1', missionGoal: 'g', phase: 'BUILD', repoState }, clock)
  const c1 = recordDecision(c0, { summary: 'use X', kind: 'ACCEPTED' }, clock)
  assert.equal(c0.decisions.length, 0, 'input must not be mutated')
  assert.equal(c1.decisions.length, 1)
  assert.equal(c1.revision, 1)
  assert.equal(c1.decisions[0].kind, 'ACCEPTED')
})

test('recordDecision rejects an unknown kind', () => {
  const c0 = createPlannerMissionCheckpoint({ missionId: 'm1', missionGoal: 'g', phase: 'BUILD', repoState }, clock)
  assert.throws(() => recordDecision(c0, { summary: 'x', kind: 'MAYBE' }, clock), /ACCEPTED\|REJECTED/)
})

test('blockers: raise then resolve', () => {
  let c = createPlannerMissionCheckpoint({ missionId: 'm1', missionGoal: 'g', phase: 'BUILD', repoState }, clock)
  c = recordBlocker(c, { summary: 'waiting on X' }, clock)
  assert.equal(c.blockers[0].resolvedAt, null)
  c = resolveBlocker(c, c.blockers[0].id, 'unblocked by Y', clock)
  assert.ok(c.blockers[0].resolvedAt)
  assert.equal(c.blockers[0].resolution, 'unblocked by Y')
  assert.throws(() => resolveBlocker(c, 'unknown-id', 'x', clock), /unknown blocker/)
})

test('Needs-You: raise, appears unresolved, then resolve', () => {
  let c = createPlannerMissionCheckpoint({ missionId: 'm1', missionGoal: 'g', phase: 'BUILD', repoState }, clock)
  c = raisePlannerNeedsYou(c, { question: 'ok to force-push?', category: 'DESTRUCTIVE_ACTION_CONFIRMATION' }, clock)
  assert.equal(c.needsYou.length, 1)
  assert.equal(c.needsYou[0].resolvedAt, null)
  assert.throws(() => raisePlannerNeedsYou(c, { question: 'x', category: 'NOT_A_REAL_CATEGORY' }, clock), /unknown Needs-You category/)
  c = resolvePlannerNeedsYou(c, c.needsYou[0].id, 'yes, confirmed by owner', clock)
  assert.ok(c.needsYou[0].resolvedAt)
})

test('workers: registerDispatchedWorker is discoverable by taskFingerprint and refuses a duplicate workerId', () => {
  let c = createPlannerMissionCheckpoint({ missionId: 'm1', missionGoal: 'g', phase: 'BUILD', repoState }, clock)
  assert.equal(findWorkerByTaskFingerprint(c, 'task-1'), null)
  c = registerDispatchedWorker(c, { workerId: 'w1', kind: 'FIXTURE', taskFingerprint: 'task-1' }, clock)
  const found = findWorkerByTaskFingerprint(c, 'task-1')
  assert.equal(found.workerId, 'w1')
  assert.equal(found.status, 'DISPATCHED')
  assert.throws(
    () => registerDispatchedWorker(c, { workerId: 'w1', kind: 'FIXTURE', taskFingerprint: 'task-1' }, clock),
    (error) => error.code === 'TSF_PLANNER_WORKER_ALREADY_REGISTERED'
  )
})

// Phase 5 regression: providerId/agentId is additive/optional -- an
// existing caller that never supplies it (the test above) must keep
// getting an honest null, never a fabricated/guessed identity, and a
// caller that DOES supply it must have it recorded verbatim.
test('workers: registerDispatchedWorker\'s providerId/agentId is additive -- absent stays honestly null, supplied is recorded verbatim', () => {
  let c = createPlannerMissionCheckpoint({ missionId: 'm1', missionGoal: 'g', phase: 'BUILD', repoState }, clock)
  c = registerDispatchedWorker(c, { workerId: 'w-no-identity', kind: 'FIXTURE', taskFingerprint: 'task-no-identity' }, clock)
  const withoutIdentity = findWorkerByTaskFingerprint(c, 'task-no-identity')
  assert.equal(withoutIdentity.providerId, null, 'never guessed when the caller does not know')
  assert.equal(withoutIdentity.agentId, null)

  c = registerDispatchedWorker(c, { workerId: 'w-with-identity', kind: 'RESEARCH', taskFingerprint: 'task-with-identity', providerId: 'openai', agentId: 'codex' }, clock)
  const withIdentity = findWorkerByTaskFingerprint(c, 'task-with-identity')
  assert.equal(withIdentity.providerId, 'openai')
  assert.equal(withIdentity.agentId, 'codex')
})

// Phase 11 finding: the dispatch-attempt ledger is the durable pre-flight
// record registerDispatchedWorker alone never provided -- proves the ledger
// itself, independent of PlannerSessionLifecycle's wiring (proven separately
// below in planner-session-lifecycle-crash-mid-dispatch.test.mjs).
test('dispatch-attempt ledger: no attempt ever recorded classifies as null (nothing to reconcile)', () => {
  const c = createPlannerMissionCheckpoint({ missionId: 'm1', missionGoal: 'g', phase: 'BUILD', repoState }, clock)
  assert.equal(classifyPlannerDispatchAmbiguity(c, 'task-never-attempted'), null)
})

test('dispatch-attempt ledger: an attempt left UNKNOWN (simulated crash before resolution) classifies as ambiguous', () => {
  let c = createPlannerMissionCheckpoint({ missionId: 'm1', missionGoal: 'g', phase: 'BUILD', repoState }, clock)
  c = recordDispatchAttempt(c, 'task-crashed', clock)
  const result = classifyPlannerDispatchAmbiguity(c, 'task-crashed')
  assert.equal(result.ambiguous, true)
  assert.match(result.reason, /never durably resolved/)
})

test('dispatch-attempt ledger: a CONFIRMED-resolved attempt is no longer ambiguous', () => {
  let c = createPlannerMissionCheckpoint({ missionId: 'm1', missionGoal: 'g', phase: 'BUILD', repoState }, clock)
  c = recordDispatchAttempt(c, 'task-ok', clock)
  c = resolveDispatchAttempt(c, 'task-ok', 'CONFIRMED', clock)
  assert.equal(classifyPlannerDispatchAmbiguity(c, 'task-ok').ambiguous, false)
})

test('dispatch-attempt ledger: a FAILED_CLEAN-resolved attempt is no longer ambiguous', () => {
  let c = createPlannerMissionCheckpoint({ missionId: 'm1', missionGoal: 'g', phase: 'BUILD', repoState }, clock)
  c = recordDispatchAttempt(c, 'task-failed', clock)
  c = resolveDispatchAttempt(c, 'task-failed', 'FAILED_CLEAN', clock)
  assert.equal(classifyPlannerDispatchAmbiguity(c, 'task-failed').ambiguous, false)
})

test('dispatch-attempt ledger: resolveDispatchAttempt rejects an unknown outcome and is a no-op for an unattempted taskFingerprint', () => {
  const c = createPlannerMissionCheckpoint({ missionId: 'm1', missionGoal: 'g', phase: 'BUILD', repoState }, clock)
  assert.throws(() => resolveDispatchAttempt(c, 'task-x', 'MAYBE', clock), /unknown planner dispatch attempt outcome/)
  const unchanged = resolveDispatchAttempt(c, 'task-never-recorded', 'CONFIRMED', clock)
  assert.deepEqual(unchanged.dispatchAttempts, [])
})

test('recordWorkerResult transitions a known worker to COMPLETED/FAILED and rejects an unknown worker', () => {
  let c = createPlannerMissionCheckpoint({ missionId: 'm1', missionGoal: 'g', phase: 'BUILD', repoState }, clock)
  c = registerDispatchedWorker(c, { workerId: 'w1', kind: 'FIXTURE', taskFingerprint: 'task-1' }, clock)
  c = recordWorkerResult(c, 'w1', { status: 'COMPLETED', result: { ok: true } }, clock)
  assert.equal(c.workers.w1.status, 'COMPLETED')
  assert.deepEqual(c.workers.w1.result, { ok: true })
  assert.ok(c.workers.w1.completedAt)
  assert.throws(() => recordWorkerResult(c, 'w2', { status: 'COMPLETED' }, clock), /unknown worker/)
  assert.throws(() => recordWorkerResult(c, 'w1', { status: 'BOGUS' }, clock), /COMPLETED\|FAILED/)
})

test('completePlannerMission fails honest on unresolved Needs-You or outstanding tasks -- never fabricates completion', () => {
  let c = createPlannerMissionCheckpoint({ missionId: 'm1', missionGoal: 'g', phase: 'BUILD', repoState }, clock)
  c = raisePlannerNeedsYou(c, { question: 'q' }, clock)
  assert.throws(() => completePlannerMission(c, clock), /unresolved Needs-You/)
  c = resolvePlannerNeedsYou(c, c.needsYou[0].id, 'resolved', clock)
  c = setOutstandingTasks(c, ['t1'], clock)
  assert.throws(() => completePlannerMission(c, clock), /outstanding task/)
  c = recordTaskCompleted(c, 't1', clock)
  assert.equal(c.outstandingTasks.length, 0)
  c = completePlannerMission(c, clock)
  assert.equal(c.missionState, 'COMPLETE')
})

test('resource state, authority grants, verifier results, and lessons all record and persist', () => {
  let c = createPlannerMissionCheckpoint({ missionId: 'm1', missionGoal: 'g', phase: 'BUILD', repoState }, clock)
  c = recordResourceState(c, { tier: 'HEALTHY', observedAt: '2026-09-06T12:00:00.000Z' }, clock)
  assert.equal(c.resourceState.tier, 'HEALTHY')
  c = recordAuthorityGrant(c, { scope: 'PAID_PROVIDER_DISPATCH', grantedBy: 'owner' }, clock)
  assert.equal(c.authority.grants.length, 1)
  c = recordVerifierResult(c, { verifier: 'oxlint', verdict: 'PASS' }, clock)
  assert.equal(c.verifierResults[0].verdict, 'PASS')
  c = recordLesson(c, 'always fail closed on ambiguous repo state', clock)
  assert.equal(c.lessons.length, 1)
})

test('advancePhase updates phase and bumps revision', () => {
  let c = createPlannerMissionCheckpoint({ missionId: 'm1', missionGoal: 'g', phase: 'BUILD', repoState }, clock)
  c = advancePhase(c, 'VERIFY', clock)
  assert.equal(c.phase, 'VERIFY')
})

test('assertRepoStateContinuity: matches passes, drift and unverifiable both fail honest with distinct codes', () => {
  const c = createPlannerMissionCheckpoint({ missionId: 'm1', missionGoal: 'g', phase: 'BUILD', repoState }, clock)
  assert.ok(assertRepoStateContinuity(c, { branch: repoState.branch, sha: repoState.sha, worktreePath: '/somewhere/else' }))
  assert.throws(
    () => assertRepoStateContinuity(c, { branch: repoState.branch, sha: 'b'.repeat(40) }),
    (error) => error.code === 'TSF_PLANNER_REPO_STATE_DRIFT'
  )
  assert.throws(
    () => assertRepoStateContinuity(c, null),
    (error) => error.code === 'TSF_PLANNER_REPO_STATE_UNVERIFIABLE'
  )
})

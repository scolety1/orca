import assert from 'node:assert/strict'
import test from 'node:test'
import {
  advancePhase,
  assertRepoStateContinuity,
  completePlannerMission,
  createPlannerMissionCheckpoint,
  findWorkerByTaskFingerprint,
  raisePlannerNeedsYou,
  recordAuthorityGrant,
  recordBlocker,
  recordDecision,
  recordLesson,
  recordResourceState,
  recordTaskCompleted,
  recordVerifierResult,
  recordWorkerResult,
  registerDispatchedWorker,
  resolveBlocker,
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

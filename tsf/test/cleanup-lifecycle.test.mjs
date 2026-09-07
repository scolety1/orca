import assert from 'node:assert/strict'
import test from 'node:test'
import {
  CLEANUP_SCHEMA,
  beginCleanupExecution,
  buildCleanupPlan,
  buildCleanupRecommendation,
  completeCleanupExecution,
  computeCleanupRequestId,
  createCleanupAuthorization,
  failCleanupExecution,
  isAuthorizationLive,
  recordExecutionStep
} from '../domain/cleanup-lifecycle.mjs'

const CLOCK = () => new Date('2026-09-06T12:00:00.000Z')
const TARGET = { realPath: 'C:/fixtures/some-worktree', branch: 'tsf/feature/disposable' }
const CLEAR_BLOCKERS = { blocked: false, tier: 'CLEAR', blockers: [], passedChecks: [] }

function buildRecommendation() {
  return buildCleanupRecommendation(
    { actionClass: 'REMOVE_DISPOSABLE_WORKTREE', targetIdentity: TARGET, rationale: 'disposable per audit' },
    CLOCK
  )
}

test('computeCleanupRequestId is deterministic -- same (actionClass, targetIdentity) always yields the same id', () => {
  const a = computeCleanupRequestId('REMOVE_DISPOSABLE_WORKTREE', TARGET)
  const b = computeCleanupRequestId('REMOVE_DISPOSABLE_WORKTREE', { ...TARGET })
  const c = computeCleanupRequestId('DELETE_LOCAL_MERGED_BRANCH', TARGET)
  assert.equal(a, b)
  assert.notEqual(a, c)
})

test('buildCleanupRecommendation refuses an unknown action class', () => {
  assert.throws(() => buildCleanupRecommendation({ actionClass: 'NOPE', targetIdentity: TARGET, rationale: 'x' }, CLOCK))
})

test('buildCleanupRecommendation refuses a target with no resolved realPath -- no fuzzy targets', () => {
  assert.throws(() =>
    buildCleanupRecommendation({ actionClass: 'RETIRE_SESSION', targetIdentity: { branch: 'x' }, rationale: 'x' }, CLOCK)
  )
})

test('buildCleanupRecommendation refuses a missing rationale rather than fabricating one', () => {
  assert.throws(() => buildCleanupRecommendation({ actionClass: 'RETIRE_SESSION', targetIdentity: TARGET }, CLOCK))
})

test('the four stages are genuinely distinct schemas, not labels on one blob', () => {
  const recommendation = buildRecommendation()
  const plan = buildCleanupPlan(recommendation, { steps: ['A'], blockerEvaluationAtPlanTime: CLEAR_BLOCKERS }, CLOCK)
  const authorization = createCleanupAuthorization(
    plan,
    { grantedBy: 'owner', ownerGateOpen: true, blockerEvaluationAtAuthorizationTime: CLEAR_BLOCKERS },
    CLOCK
  )
  const execution = beginCleanupExecution(authorization, CLOCK)
  const schemas = new Set([recommendation.schemaVersion, plan.schemaVersion, authorization.schemaVersion, execution.schemaVersion])
  assert.equal(schemas.size, 4)
  assert.deepEqual(
    [...schemas].sort(),
    [CLEANUP_SCHEMA.AUTHORIZATION, CLEANUP_SCHEMA.EXECUTION, CLEANUP_SCHEMA.PLAN, CLEANUP_SCHEMA.RECOMMENDATION].sort()
  )
  // Every stage shares the SAME requestId -- they are one lineage, not
  // independent objects that happen to look related.
  assert.equal(plan.requestId, recommendation.requestId)
  assert.equal(authorization.requestId, plan.requestId)
  assert.equal(execution.requestId, authorization.requestId)
})

test('a RECOMMENDATION never carries executionAuthorized -- only a PLAN/onward can even express that field, and it defaults false', () => {
  const recommendation = buildRecommendation()
  assert.equal(recommendation.executionAuthorized, undefined)
  const plan = buildCleanupPlan(recommendation, { steps: ['A'], blockerEvaluationAtPlanTime: CLEAR_BLOCKERS }, CLOCK)
  assert.equal(plan.executionAuthorized, false)
})

test('createCleanupAuthorization refuses when ownerGateOpen is not literally true', () => {
  const recommendation = buildRecommendation()
  const plan = buildCleanupPlan(recommendation, { steps: ['A'], blockerEvaluationAtPlanTime: CLEAR_BLOCKERS }, CLOCK)
  assert.throws(
    () => createCleanupAuthorization(plan, { grantedBy: 'owner', ownerGateOpen: false, blockerEvaluationAtAuthorizationTime: CLEAR_BLOCKERS }, CLOCK),
    (error) => error.code === 'TSF_CLEANUP_OWNER_GATE_CLOSED'
  )
  assert.throws(
    () => createCleanupAuthorization(plan, { grantedBy: 'owner', ownerGateOpen: 'true', blockerEvaluationAtAuthorizationTime: CLEAR_BLOCKERS }, CLOCK),
    (error) => error.code === 'TSF_CLEANUP_OWNER_GATE_CLOSED',
    'a truthy-but-not-boolean-true value must not be accepted'
  )
})

test('createCleanupAuthorization refuses when a fresh blocker evaluation at authorization time is blocked, even if the plan-time snapshot was clear', () => {
  const recommendation = buildRecommendation()
  const plan = buildCleanupPlan(recommendation, { steps: ['A'], blockerEvaluationAtPlanTime: CLEAR_BLOCKERS }, CLOCK)
  const nowBlocked = { blocked: true, tier: 'PROTECTED', blockers: [{ code: 'DIRTY_WORKTREE', tier: 'PROTECTED' }] }
  assert.throws(
    () => createCleanupAuthorization(plan, { grantedBy: 'owner', ownerGateOpen: true, blockerEvaluationAtAuthorizationTime: nowBlocked }, CLOCK),
    (error) => error.code === 'TSF_CLEANUP_STILL_BLOCKED'
  )
})

test('beginCleanupExecution refuses an expired or revoked authorization', () => {
  const recommendation = buildRecommendation()
  const plan = buildCleanupPlan(recommendation, { steps: ['A'], blockerEvaluationAtPlanTime: CLEAR_BLOCKERS }, CLOCK)
  const authorization = createCleanupAuthorization(
    plan,
    { grantedBy: 'owner', ownerGateOpen: true, blockerEvaluationAtAuthorizationTime: CLEAR_BLOCKERS, ttlMs: -1 },
    CLOCK
  )
  assert.equal(isAuthorizationLive(authorization, CLOCK()), false)
  assert.throws(() => beginCleanupExecution(authorization, CLOCK), (error) => error.code === 'TSF_CLEANUP_AUTHORIZATION_NOT_LIVE')

  const revoked = { ...authorization, revoked: true, expiresAt: new Date(CLOCK().getTime() + 1e6).toISOString() }
  assert.throws(() => beginCleanupExecution(revoked, CLOCK), (error) => error.code === 'TSF_CLEANUP_AUTHORIZATION_NOT_LIVE')
})

test('execution step recording and completion/failure transitions', () => {
  const recommendation = buildRecommendation()
  const plan = buildCleanupPlan(recommendation, { steps: ['A'], blockerEvaluationAtPlanTime: CLEAR_BLOCKERS }, CLOCK)
  const authorization = createCleanupAuthorization(
    plan,
    { grantedBy: 'owner', ownerGateOpen: true, blockerEvaluationAtAuthorizationTime: CLEAR_BLOCKERS },
    CLOCK
  )
  let execution = beginCleanupExecution(authorization, CLOCK)
  assert.equal(execution.status, 'PENDING')
  execution = recordExecutionStep(execution, { name: 'STEP_1', status: 'COMPLETED' }, CLOCK)
  assert.equal(execution.status, 'IN_PROGRESS')
  assert.equal(execution.steps.length, 1)

  const completed = completeCleanupExecution(execution, { ok: true }, CLOCK)
  assert.equal(completed.status, 'COMPLETED')
  assert.ok(completed.completedAt)

  const failed = failCleanupExecution(execution, new Error('boom'), CLOCK)
  assert.equal(failed.status, 'FAILED')
  assert.equal(failed.result.error, 'boom')
})

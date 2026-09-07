// The governed destructive-action state model: RECOMMENDATION (a
// suggestion) -> PLAN (a concrete proposed set of steps) -> AUTHORIZATION
// (an explicit, non-implied grant) -> EXECUTION (the actual mutation).
// Four genuinely distinct shapes, not labels on one blob -- each has its
// own builder with its own honest-failure rules, and a later stage can only
// be built FROM an already-valid instance of the stage before it (an
// AUTHORIZATION cannot be minted without a PLAN id to reference; an
// EXECUTION cannot start without a granted AUTHORIZATION id).
//
// Pure domain logic only -- no I/O, no reading of the real owner-
// authorization gate (that live check belongs to
// server/cleanup-owner-authorization-gate.mjs; this module only refuses to
// mint an AUTHORIZATION unless the caller already asserts `ownerGateOpen:
// true`, which the server derives from that real, unset-by-default gate).
import { canonicalJson, isoNow, sha256 } from './canonical.mjs'
import { isKnownActionClass, actionClassTier } from './cleanup-action-taxonomy.mjs'

export const CLEANUP_SCHEMA = Object.freeze({
  RECOMMENDATION: 'TSF_CLEANUP_RECOMMENDATION_V1',
  PLAN: 'TSF_CLEANUP_PLAN_V1',
  AUTHORIZATION: 'TSF_CLEANUP_AUTHORIZATION_V1',
  EXECUTION: 'TSF_CLEANUP_EXECUTION_V1'
})

// Deterministic identity for a (actionClass, targetIdentity) pair -- this
// IS the idempotency key: two callers proposing the "same" cleanup collapse
// onto the same durable requestId (server/cleanup-request-store.mjs), so a
// duplicate request never produces a second, independent mutation.
export function computeCleanupRequestId(actionClass, targetIdentity) {
  return sha256(canonicalJson({ actionClass, targetIdentity }))
}

function requireTargetIdentity(targetIdentity) {
  if (!targetIdentity || typeof targetIdentity.realPath !== 'string' || !targetIdentity.realPath) {
    throw new Error('cleanup target identity requires a resolved realPath -- refusing a fuzzy/guessed target')
  }
}

export function buildCleanupRecommendation({ actionClass, targetIdentity, rationale, basis }, clock) {
  if (!isKnownActionClass(actionClass)) {
    throw new Error(`unknown cleanup action class: ${actionClass}`)
  }
  requireTargetIdentity(targetIdentity)
  if (!rationale) {
    throw new Error('cleanup recommendation requires a rationale -- refusing to fabricate one')
  }
  const requestId = computeCleanupRequestId(actionClass, targetIdentity)
  return {
    schemaVersion: CLEANUP_SCHEMA.RECOMMENDATION,
    requestId,
    recommendationId: `${requestId}:recommendation`,
    actionClass,
    actionTier: actionClassTier(actionClass),
    targetIdentity,
    rationale,
    basis: basis ?? null,
    generatedAt: isoNow(clock),
    authority: 'ADVISORY_ONLY'
  }
}

// `blockerEvaluationAtPlanTime` is informational only (see
// cleanup-safety-blockers.mjs's header comment) -- it is never trusted at
// authorization/execution time, which re-evaluate independently against
// fresh evidence. `steps` is the ordered, human-inspectable action plan
// (e.g. ['REVALIDATE', 'QUARANTINE_COPY', 'GIT_WORKTREE_REMOVE']).
export function buildCleanupPlan(recommendation, { steps, blockerEvaluationAtPlanTime, reversibilityStrategy }, clock) {
  if (!recommendation || recommendation.schemaVersion !== CLEANUP_SCHEMA.RECOMMENDATION) {
    throw new Error('buildCleanupPlan requires a valid RECOMMENDATION')
  }
  if (!Array.isArray(steps) || steps.length === 0) {
    throw new Error('cleanup plan requires at least one concrete step')
  }
  return {
    schemaVersion: CLEANUP_SCHEMA.PLAN,
    requestId: recommendation.requestId,
    planId: `${recommendation.requestId}:plan`,
    recommendationId: recommendation.recommendationId,
    actionClass: recommendation.actionClass,
    actionTier: recommendation.actionTier,
    targetIdentity: recommendation.targetIdentity,
    steps,
    reversibilityStrategy: reversibilityStrategy ?? 'NONE',
    blockersAtPlanTime: blockerEvaluationAtPlanTime ?? null,
    planBlocked: blockerEvaluationAtPlanTime?.blocked ?? null,
    createdAt: isoNow(clock),
    authority: 'ADVISORY_ONLY',
    executionAuthorized: false
  }
}

// Refuses to mint an AUTHORIZATION unless BOTH: (1) the caller asserts the
// real owner-authorization gate is open (`ownerGateOpen: true` -- the
// server derives this from cleanup-owner-authorization-gate.mjs, never
// fabricated here), and (2) a FRESH blocker re-evaluation, passed in by the
// caller and computed at authorization time (not reused from plan time),
// is clear. This is what stops a plan built while blocked, then
// authorized later on stale plan-time evidence.
export function createCleanupAuthorization(plan, { grantedBy, ownerGateOpen, blockerEvaluationAtAuthorizationTime, ttlMs = 5 * 60 * 1000 }, clock) {
  if (!plan || plan.schemaVersion !== CLEANUP_SCHEMA.PLAN) {
    throw new Error('createCleanupAuthorization requires a valid PLAN')
  }
  if (ownerGateOpen !== true) {
    const error = new Error('owner-authorization gate is not open -- refusing to mint a real authorization')
    error.code = 'TSF_CLEANUP_OWNER_GATE_CLOSED'
    throw error
  }
  if (!grantedBy) {
    throw new Error('cleanup authorization requires an explicit grantedBy identity')
  }
  if (!blockerEvaluationAtAuthorizationTime || blockerEvaluationAtAuthorizationTime.blocked !== false) {
    const error = new Error('cannot authorize a cleanup action while a blocker is present or unresolved')
    error.code = 'TSF_CLEANUP_STILL_BLOCKED'
    throw error
  }
  const now = clock ? clock() : new Date()
  return {
    schemaVersion: CLEANUP_SCHEMA.AUTHORIZATION,
    requestId: plan.requestId,
    authorizationId: `${plan.requestId}:authorization:${now.getTime()}`,
    planId: plan.planId,
    actionClass: plan.actionClass,
    actionTier: plan.actionTier,
    targetIdentity: plan.targetIdentity,
    grantedBy,
    grantedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
    blockerEvaluationAtGrantTime: blockerEvaluationAtAuthorizationTime,
    revoked: false
  }
}

export function isAuthorizationLive(authorization, now) {
  if (!authorization || authorization.revoked) {
    return false
  }
  return new Date(authorization.expiresAt) > now
}

export function beginCleanupExecution(authorization, clock) {
  if (!authorization || authorization.schemaVersion !== CLEANUP_SCHEMA.AUTHORIZATION) {
    throw new Error('beginCleanupExecution requires a valid AUTHORIZATION')
  }
  const now = clock ? clock() : new Date()
  if (!isAuthorizationLive(authorization, now)) {
    const error = new Error('cannot begin execution: authorization is expired or revoked')
    error.code = 'TSF_CLEANUP_AUTHORIZATION_NOT_LIVE'
    throw error
  }
  return {
    schemaVersion: CLEANUP_SCHEMA.EXECUTION,
    requestId: authorization.requestId,
    executionId: `${authorization.requestId}:execution:${now.getTime()}`,
    authorizationId: authorization.authorizationId,
    planId: authorization.planId,
    actionClass: authorization.actionClass,
    targetIdentity: authorization.targetIdentity,
    status: 'PENDING',
    steps: [],
    startedAt: now.toISOString(),
    completedAt: null,
    result: null
  }
}

export function recordExecutionStep(execution, { name, status, detail }, clock) {
  const now = isoNow(clock)
  return {
    ...execution,
    status: status === 'FAILED' ? 'FAILED' : execution.status === 'PENDING' ? 'IN_PROGRESS' : execution.status,
    steps: [...execution.steps, { name, status, detail: detail ?? null, at: now }]
  }
}

export function completeCleanupExecution(execution, result, clock) {
  return { ...execution, status: 'COMPLETED', result, completedAt: isoNow(clock) }
}

export function failCleanupExecution(execution, error, clock) {
  return {
    ...execution,
    status: 'FAILED',
    result: { error: String(error?.message ?? error), code: error?.code ?? null },
    completedAt: isoNow(clock)
  }
}

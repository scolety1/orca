// Governed destructive-action orchestration -- the ONE place every cleanup
// action class's mutation is dispatched from. runGovernedCleanupAction is
// the sole entry point; it structurally cannot be bypassed by any action
// implementation reaching the real filesystem/git call some other way,
// because every mutate function in cleanup-executor-*.mjs is deliberately
// pure I/O with no access to the request store, receipt chain, or owner
// gate of its own -- only this function can produce a durable EXECUTION
// record and receipts.
//
// Pipeline (every stage persisted + receipted, per Phase 4's required
// RECOMMENDATION -> PLAN -> AUTHORIZATION -> EXECUTION distinction):
//   1. RECOMMENDATION (pure, advisory)
//   2. PLAN (pure, informational blocker snapshot at plan time)
//   3. idempotency short-circuit (an already-COMPLETED requestId replays,
//      never re-mutates)
//   4. NOT_IMPLEMENTED_V0 short-circuit for ELEVATED classes with no real
//      executor (see domain/cleanup-action-taxonomy.mjs)
//   5. owner-authorization gate check (fails closed; unset by default)
//   6. fresh blocker re-evaluation AT AUTHORIZATION TIME -> AUTHORIZATION
//   7. EXECUTION begins
//   8. a THIRD, independent blocker re-evaluation immediately before the
//      mutating call -- the race re-check
//   9. dispatch to the real mutate function; success/failure both persisted
import {
  beginCleanupExecution,
  buildCleanupPlan,
  buildCleanupRecommendation,
  completeCleanupExecution,
  computeCleanupRequestId,
  createCleanupAuthorization,
  failCleanupExecution,
  recordExecutionStep
} from '../domain/cleanup-lifecycle.mjs'
import { createCleanupReceipt } from '../domain/cleanup-receipt-chain.mjs'
import { evaluateCleanupBlockers } from '../domain/cleanup-safety-blockers.mjs'
import { isV0Implemented } from '../domain/cleanup-action-taxonomy.mjs'
import { readOwnerAuthorizationGateState } from './cleanup-owner-authorization-gate.mjs'
import { collectFreshSafetyContext } from './cleanup-revalidation.mjs'
import {
  appendExecution,
  appendReceipts,
  latestExecution,
  putAuthorization,
  putPlan,
  putRecommendation,
  readCleanupRequestRecord
} from './cleanup-request-store.mjs'
import { recoverIncompleteQuarantine } from './cleanup-quarantine-store.mjs'
import { executeRetireSession } from './cleanup-session-retirement-action.mjs'
import {
  executeDeleteBranchWithUniqueUnpushedCommits,
  executeDeleteLocalMergedBranch,
  executeRemoveDisposableWorktree
} from './cleanup-executor-worktree-actions.mjs'
import {
  executeClearSafeGeneratedCache,
  executeQuarantineArtifact,
  executeRemoveStaleTemporaryState,
  executeRestoreQuarantine
} from './cleanup-executor-artifact-actions.mjs'

const ACTION_EXECUTORS = {
  RETIRE_SESSION: executeRetireSession,
  REMOVE_DISPOSABLE_WORKTREE: executeRemoveDisposableWorktree,
  DELETE_LOCAL_MERGED_BRANCH: executeDeleteLocalMergedBranch,
  CLEAR_SAFE_GENERATED_CACHE: executeClearSafeGeneratedCache,
  QUARANTINE_ARTIFACT: executeQuarantineArtifact,
  RESTORE_QUARANTINE: executeRestoreQuarantine,
  REMOVE_STALE_TEMPORARY_STATE: executeRemoveStaleTemporaryState,
  DELETE_BRANCH_WITH_UNIQUE_UNPUSHED_COMMITS: executeDeleteBranchWithUniqueUnpushedCommits
}

// Small in-process receipt-chain helper bound to one request's history:
// tracks the last hash locally (so each new receipt links correctly) and
// persists every receipt it mints to the durable store as it goes.
function receiptChain(requestId, existingReceipts) {
  let previousReceiptHash = existingReceipts.length ? existingReceipts.at(-1).receiptHash : null
  return {
    async mint(kind, { actionClass, stageId, detail }, clock) {
      const receiptEntry = createCleanupReceipt({ kind, requestId, actionClass, stageId, detail }, { previousReceiptHash, clock })
      previousReceiptHash = receiptEntry.receiptHash
      await appendReceipts(requestId, [receiptEntry])
      return receiptEntry
    }
  }
}

// `gateCheck`/`env`/`flagFilePath` default to the REAL owner-authorization
// gate (server/cleanup-owner-authorization-gate.mjs, unset by default).
// Tests inject a fake `gateCheck` returning { open: true } to exercise the
// full pipeline against a disposable fixture WITHOUT ever touching the
// real global env var or flag file -- see that module's own header comment.
export async function runGovernedCleanupAction({
  actionClass,
  targetIdentity,
  rationale,
  basis,
  grantedBy = 'unspecified-caller',
  mutationParams = {},
  safetyOptions = {},
  gateCheck = readOwnerAuthorizationGateState,
  env,
  flagFilePath,
  // Injectable, defaulting to the real collectFreshSafetyContext -- tests
  // use this to prove the race-recheck (step 8 above) is what catches a
  // state change, not the earlier plan/authorization-time checks, by
  // returning different evidence on successive calls. Production code
  // never overrides this.
  revalidate = collectFreshSafetyContext,
  clock
}) {
  const requestId = computeCleanupRequestId(actionClass, targetIdentity)
  const existingRecord = readCleanupRequestRecord(requestId)
  const chain = receiptChain(requestId, existingRecord?.receipts ?? [])

  const recommendation = buildCleanupRecommendation({ actionClass, targetIdentity, rationale, basis }, clock)
  await putRecommendation(requestId, recommendation)
  await chain.mint('RECOMMENDATION_ISSUED', { actionClass, stageId: recommendation.recommendationId }, clock)

  const { context: planContext } = await revalidate({ targetIdentity, ...safetyOptions }, clock)
  const planBlockerEvaluation = evaluateCleanupBlockers(planContext, clock)
  const plan = buildCleanupPlan(
    recommendation,
    {
      steps: describeSteps(actionClass),
      blockerEvaluationAtPlanTime: planBlockerEvaluation,
      reversibilityStrategy: reversibilityStrategyFor(actionClass)
    },
    clock
  )
  await putPlan(requestId, plan)
  await chain.mint(planBlockerEvaluation.blocked ? 'PLAN_BLOCKED' : 'PLAN_BUILT', { actionClass, stageId: plan.planId, detail: planBlockerEvaluation }, clock)

  // Idempotency: an already-terminal (COMPLETED) execution for this exact
  // requestId is replayed, never re-run.
  const previous = latestExecution(readCleanupRequestRecord(requestId))
  if (previous?.status === 'COMPLETED') {
    await chain.mint('IDEMPOTENT_REPLAY', { actionClass, stageId: previous.executionId }, clock)
    return { status: 'IDEMPOTENT_REPLAY', requestId, plan, execution: previous }
  }

  if (!isV0Implemented(actionClass)) {
    return { status: 'NOT_IMPLEMENTED_V0_CLASSIFICATION_ONLY', requestId, plan }
  }

  const gateState = gateCheck(env, flagFilePath)
  if (!gateState.open) {
    await chain.mint('AUTHORIZATION_REFUSED', { actionClass, stageId: plan.planId, detail: { reason: gateState.reason } }, clock)
    return { status: 'AUTHORIZATION_REFUSED', requestId, plan, reason: gateState.reason }
  }

  const { context: authContext } = await revalidate({ targetIdentity, ...safetyOptions }, clock)
  const authBlockerEvaluation = evaluateCleanupBlockers(authContext, clock)
  let authorization
  try {
    authorization = createCleanupAuthorization(
      plan,
      { grantedBy, ownerGateOpen: gateState.open, blockerEvaluationAtAuthorizationTime: authBlockerEvaluation },
      clock
    )
  } catch (error) {
    await chain.mint('AUTHORIZATION_REFUSED', { actionClass, stageId: plan.planId, detail: { reason: error.message, blockers: authBlockerEvaluation.blockers } }, clock)
    return { status: 'AUTHORIZATION_REFUSED', requestId, plan, reason: error.message, blockers: authBlockerEvaluation.blockers }
  }
  await putAuthorization(requestId, authorization)
  await chain.mint('AUTHORIZATION_GRANTED', { actionClass, stageId: authorization.authorizationId }, clock)

  let execution = beginCleanupExecution(authorization, clock)
  await appendExecution(requestId, execution)
  await chain.mint('EXECUTION_STARTED', { actionClass, stageId: execution.executionId }, clock)

  // THE race re-check: a third, fully independent blocker evaluation
  // against freshly re-collected evidence, as close to the actual mutating
  // call below as this environment's async model allows.
  const { context: raceContext, resolvedRealPath } = await revalidate({ targetIdentity, ...safetyOptions }, clock)
  const raceBlockerEvaluation = evaluateCleanupBlockers(raceContext, clock)
  if (raceBlockerEvaluation.blocked) {
    execution = recordExecutionStep(execution, { name: 'RACE_RECHECK', status: 'FAILED', detail: raceBlockerEvaluation }, clock)
    execution = failCleanupExecution(execution, { message: 'race re-check found a new blocker after authorization', code: 'TSF_CLEANUP_RACE_BLOCKED' }, clock)
    await appendExecution(requestId, execution)
    await chain.mint('EXECUTION_FAILED', { actionClass, stageId: execution.executionId, detail: raceBlockerEvaluation }, clock)
    return { status: 'EXECUTION_FAILED', requestId, plan, authorization, execution }
  }
  execution = recordExecutionStep(execution, { name: 'RACE_RECHECK', status: 'PASSED' }, clock)

  const mutate = ACTION_EXECUTORS[actionClass]
  try {
    const { steps, result } = await mutate(resolvedRealPath, { ...mutationParams, requestId }, { clock })
    for (const step of steps) {
      execution = recordExecutionStep(execution, step, clock)
    }
    execution = completeCleanupExecution(execution, result, clock)
    await appendExecution(requestId, execution)
    await chain.mint('EXECUTION_COMPLETED', { actionClass, stageId: execution.executionId, detail: result }, clock)
    return { status: 'COMPLETED', requestId, plan, authorization, execution }
  } catch (error) {
    if (Array.isArray(error.stepsCompleted)) {
      for (const step of error.stepsCompleted) {
        execution = recordExecutionStep(execution, step, clock)
      }
    }
    execution = failCleanupExecution(execution, error, clock)
    await appendExecution(requestId, execution)
    await chain.mint('EXECUTION_FAILED', { actionClass, stageId: execution.executionId, detail: { message: error.message, code: error.code ?? null } }, clock)
    return {
      status: 'EXECUTION_FAILED',
      requestId,
      plan,
      authorization,
      execution,
      error: { message: error.message, code: error.code ?? null }
    }
  }
}

// A crash-recovery entry point separate from the main pipeline (never
// invoked implicitly mid-pipeline, so its own behavior is independently
// testable): inspects the latest execution for `requestId` and, for a
// quarantine-backed action left IN_PROGRESS, reconciles the quarantine
// manifest against real filesystem state.
export function recoverStalledCleanupExecution(requestId) {
  const record = readCleanupRequestRecord(requestId)
  const previous = latestExecution(record)
  if (!previous || previous.status !== 'IN_PROGRESS') {
    return { status: previous?.status ?? 'NO_EXECUTION', requiresOwnerReview: false }
  }
  return recoverIncompleteQuarantine(requestId)
}

function describeSteps(actionClass) {
  const map = {
    RETIRE_SESSION: ['REVALIDATE', 'RACE_RECHECK', 'GRACEFUL_RETIRE'],
    REMOVE_DISPOSABLE_WORKTREE: ['REVALIDATE', 'RACE_RECHECK', 'QUARANTINE_COPY', 'GIT_WORKTREE_REMOVE'],
    DELETE_LOCAL_MERGED_BRANCH: ['REVALIDATE', 'RACE_RECHECK', 'VERIFY_NOT_CHECKED_OUT', 'VERIFY_MERGED', 'GIT_BRANCH_DELETE_SAFE'],
    CLEAR_SAFE_GENERATED_CACHE: ['REVALIDATE', 'RACE_RECHECK', 'CACHE_DELETE'],
    QUARANTINE_ARTIFACT: ['REVALIDATE', 'RACE_RECHECK', 'QUARANTINE_MOVE'],
    RESTORE_QUARANTINE: ['REVALIDATE', 'RACE_RECHECK', 'QUARANTINE_RESTORE'],
    REMOVE_STALE_TEMPORARY_STATE: ['REVALIDATE', 'RACE_RECHECK', 'TEMP_STATE_DELETE'],
    DELETE_BRANCH_WITH_UNIQUE_UNPUSHED_COMMITS: ['REVALIDATE', 'RACE_RECHECK', 'VERIFY_NOT_CHECKED_OUT', 'GIT_BRANCH_DELETE_FORCE']
  }
  return map[actionClass] ?? ['REVALIDATE', 'RACE_RECHECK', 'MUTATE']
}

function reversibilityStrategyFor(actionClass) {
  if (actionClass === 'REMOVE_DISPOSABLE_WORKTREE' || actionClass === 'QUARANTINE_ARTIFACT') {
    return 'QUARANTINE_FIRST'
  }
  if (actionClass === 'RESTORE_QUARANTINE') {
    return 'QUARANTINE_RESTORE'
  }
  return 'NONE'
}

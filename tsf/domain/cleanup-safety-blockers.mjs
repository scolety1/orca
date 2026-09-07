// Fail-closed blocker evaluation for a governed cleanup action. Pure
// function of an already-assembled `SafetyContext` -- no I/O. Mirrors
// resource-auditor.mjs's classifyWorkspaceResource ternary-check discipline
// deliberately (REUSE_PATTERN, not REUSE_DIRECTLY: that classifier answers
// "is this workspace disposable", this one answers "is it currently safe to
// MUTATE this specific target for THIS specific action" -- a materially
// different question with its own field set: mission/session/file-lock
// state the auditor never collects).
//
// STRUCTURAL INDEPENDENCE (Phase 4 spec: "a blocker check cannot be
// bypassed by the same code path that wants to proceed"): this module is
// imported and called from TWO separate places that never share state --
// cleanup-lifecycle.mjs's buildCleanupPlan (informational, at plan time)
// and server/cleanup-executor.mjs's runGovernedCleanupAction (binding, the
// LAST call made before the actual mutating I/O, using freshly re-collected
// evidence from cleanup-revalidation.mjs -- never the plan's own stale
// blockersAtPlanTime). Neither call path can skip calling this function;
// there is no flag or parameter that suppresses it.
const DEFAULT_EVIDENCE_TTL_MS = 60 * 1000

function isStale(observedAtIso, ttlMs, nowIso) {
  if (!observedAtIso) {
    return true
  }
  const observed = Date.parse(observedAtIso)
  if (Number.isNaN(observed)) {
    return true
  }
  return Date.parse(nowIso) - observed > (ttlMs ?? DEFAULT_EVIDENCE_TTL_MS)
}

function ternary(value, trueCode, block, pass, passCode, unknownCode) {
  if (value === true) {
    block(trueCode, 'PROTECTED')
  } else if (value === false) {
    pass(passCode)
  } else {
    block(unknownCode ?? `${trueCode}_UNKNOWN`, 'UNKNOWN')
  }
}

export function evaluateCleanupBlockers(context, clock) {
  const now = (clock ? clock() : new Date()).toISOString()
  const blockers = []
  const passedChecks = []
  const block = (code, tier, detail) => blockers.push({ code, tier, detail: detail ?? null })
  const pass = (code) => passedChecks.push(code)

  if (isStale(context.evidenceObservedAt, context.evidenceTtlMs, now)) {
    block('SAFETY_EVIDENCE_STALE', 'UNKNOWN', { evidenceObservedAt: context.evidenceObservedAt ?? null })
  } else {
    pass('SAFETY_EVIDENCE_FRESH')
  }

  // Protected registry -- checked first, always present (never optional):
  // an evaluator that forgot to compute these would fail closed to UNKNOWN
  // rather than silently pass.
  ternary(context.protectedPath, 'PROTECTED_PATH', block, pass, 'NOT_PROTECTED_PATH')
  ternary(context.protectedBranch, 'PROTECTED_BRANCH', block, pass, 'NOT_PROTECTED_BRANCH')

  if (context.isMainWorktree !== undefined) {
    ternary(context.isMainWorktree, 'CANONICAL_MAIN_WORKTREE', block, pass, 'NOT_MAIN_WORKTREE')
  }

  // `clean` is positive-polarity (true = safe), the opposite of every other
  // field here (true = hazard) -- handled explicitly rather than forcing it
  // through the hazard-polarity `ternary` helper, mirroring resource-
  // auditor.mjs's own explicit (not ternaryCheck-routed) handling of this
  // exact field for the same reason.
  if (context.git !== undefined) {
    if (context.git.clean === true) {
      pass('GIT_CLEAN_CONFIRMED')
    } else if (context.git.clean === false) {
      block('DIRTY_WORKTREE', 'PROTECTED')
    } else {
      block('GIT_CLEAN_UNKNOWN', 'UNKNOWN')
    }
  }

  // Active-mission protection is always resolvable from the durable
  // planner-mission store (server/cleanup-active-mission-check.mjs), so it
  // is REQUIRED, not optional like git/session -- a caller that omits it
  // fails closed to UNKNOWN rather than the check being silently skipped.
  ternary(
    context.activeMissionReferenced,
    'ACTIVE_MISSION_REFERENCE',
    block,
    pass,
    'NO_ACTIVE_MISSION_REFERENCE',
    'ACTIVE_MISSION_REFERENCE_UNKNOWN'
  )

  if (context.sessionLive !== undefined) {
    ternary(context.sessionLive, 'ACTIVE_SESSION_LIVE', block, pass, 'NO_ACTIVE_SESSION', 'SESSION_LIVENESS_UNKNOWN')
  }

  if (context.fileLocked !== undefined) {
    ternary(context.fileLocked, 'FILE_HANDLE_LOCKED', block, pass, 'NO_FILE_LOCK', 'FILE_LOCK_UNKNOWN')
  }

  const hasProtected = blockers.some((b) => b.tier === 'PROTECTED')
  const hasUnknown = blockers.some((b) => b.tier === 'UNKNOWN')

  return {
    blocked: hasProtected || hasUnknown,
    tier: hasProtected ? 'PROTECTED' : hasUnknown ? 'UNKNOWN' : 'CLEAR',
    blockers,
    passedChecks,
    evaluatedAt: now
  }
}

// Native Self-Improvement Loop V1, Phase 4: bounded correction-attempt
// budget for a repair mission. Mirrors research-autonomy-policy.mjs's
// decideRetryOrEscalate exactly (REUSE_PATTERN, same shape as the F5/F27/
// F29 fixes: a fixed small budget, escalate once genuinely exhausted,
// never retry forever) -- same { maxX: N } budget shape, same
// attempts-so-far-vs-budget comparison, same RETRY-or-ESCALATE result
// type. Not a call into research-autonomy-policy.mjs itself: that module's
// decision function reads ResearchNode-shaped fields (retryCount,
// requestedFields, ...) that don't exist on a repair mission's checkpoint.
export const DEFAULT_SELF_IMPROVEMENT_RETRY_BUDGET = Object.freeze({ maxAttemptsPerMission: 2 })

// `attemptsSoFar` is derived by the caller from the mission checkpoint's
// own durable state (count of dispatched workers, or of VERIFIED_FAIL
// verifier results) -- this function holds no state of its own, exactly
// like decideRetryOrEscalate.
export function decideRepairRetryOrEscalate(attemptsSoFar, budget = DEFAULT_SELF_IMPROVEMENT_RETRY_BUDGET, reason) {
  if (attemptsSoFar >= budget.maxAttemptsPerMission) {
    return {
      type: 'ESCALATE',
      category: 'REPAIR_ATTEMPT_BUDGET_EXCEEDED',
      question: `Repair mission: ${reason}, exceeding the auto-retry budget of ${budget.maxAttemptsPerMission} attempt(s) -- a human decision is required before further dispatch.`
    }
  }
  return { type: 'RETRY_ATTEMPT', attemptNumber: attemptsSoFar + 1 }
}

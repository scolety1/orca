// Governs TSF adopting its own new candidate version into accepted
// tsf/main (spec Phase 3). Every real git operation (ancestry check,
// clean-tree check, the ff-only merge itself) lives in
// adapters/git-identity.mjs -- this module only decides, from
// already-gathered real facts, whether adoption may proceed, and produces
// the receipt the governance docs (TSF_DAILY_DRIVER_AUTONOMY_PROGRAM_V1's
// Section H) already require but never had code for. Mirrors
// tsf/domain/adoption.mjs's own "authorizedBy !== 'TIM' throws" convention
// rather than inventing a new authorization shape.
export function assessAdoptionReadiness({
  candidateIsFastForward,
  candidateWorktreeClean,
  liveMainClean,
  independentReviewGreen,
  requiredTestsGreen,
  orcaCoreDeltaZero
}) {
  const blockers = []
  if (!candidateIsFastForward) {
    blockers.push(
      'the candidate is not a real fast-forward descendant of accepted tsf/main -- refusing rather than forcing/resetting through drift'
    )
  }
  if (!candidateWorktreeClean) {
    blockers.push('the candidate worktree is not clean')
  }
  if (!liveMainClean) {
    blockers.push('live tsf/main is not clean')
  }
  if (!independentReviewGreen) {
    blockers.push('independent review evidence is missing or not GREEN')
  }
  if (!requiredTestsGreen) {
    blockers.push('required tests/build evidence is missing or not GREEN')
  }
  if (!orcaCoreDeltaZero) {
    blockers.push('Orca core delta is not zero')
  }
  return blockers.length === 0 ? { ready: true, blockers: [] } : { ready: false, blockers }
}

// The one real authority gate: only Tim can authorize TSF adopting a new
// version of itself into the runtime it is currently supervising active
// project work from -- same shape as adoption.mjs's replaceGoal, refused
// outright for anyone/anything else.
export function createAdoptionReceipt({ previousHead, adoptedHead, decidedBy, reason }, clock) {
  if (decidedBy !== 'TIM') {
    const error = new Error('TSF self-adoption can only be authorized by Tim')
    error.code = 'TSF_ADOPTION_REQUIRES_TIM'
    throw error
  }
  if (!previousHead || !adoptedHead) {
    throw new Error('a real previousHead and adoptedHead are both required to record a receipt')
  }
  return {
    schemaVersion: 'TSF_SELF_ADOPTION_RECEIPT_V1',
    previousHead,
    adoptedHead,
    decidedBy,
    reason: reason ?? null,
    decidedAt: clock().toISOString(),
    rollbackAvailable: true
  }
}

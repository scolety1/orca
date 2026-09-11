// Native Self-Improvement Loop V1, Phase 5: pure adoption-readiness
// assessment -- mirrors self-update-adoption.mjs's assessAdoptionReadiness
// shape exactly (REUSE_PATTERN: same blockers[] accumulation, same
// ready-iff-empty rule), a different, additive set of blockers (a
// candidate fix's readiness gates differ from TSF's own self-adoption
// gates -- no independentReviewGreen/orcaCoreDeltaZero concept here,
// VERIFIED_PASS from OUR OWN verifier is the equivalent evidence).
// `holdActive` (Pre-UI Productization V1, Priority 3 -- lock/hold parity
// with the main adoption path, command-adoption-execution.mjs): defaults
// to `false` (backward compatible with any existing caller that doesn't
// pass it) -- a real, active project execution hold blocks repair
// adoption readiness the exact same way it blocks the main path's own
// revalidation, never silently ignored.
export function assessRepairAdoptionReadiness({ findingStatus, verifierVerdict, candidateIsFastForward, candidateWorktreeClean, canonicalClean, gateOpen, holdActive = false }) {
  const blockers = []
  if (findingStatus !== 'READY_FOR_ADOPTION') { blockers.push(`finding is not READY_FOR_ADOPTION (status: ${findingStatus})`) }
  if (verifierVerdict !== 'VERIFIED_PASS') { blockers.push(`verifier verdict is not VERIFIED_PASS (${verifierVerdict})`) }
  if (!candidateIsFastForward) { blockers.push('the candidate branch is not a real fast-forward descendant of canonical HEAD') }
  if (!candidateWorktreeClean) { blockers.push('the candidate worktree is not clean') }
  if (!canonicalClean) { blockers.push('canonical tsf/main is not clean') }
  if (!gateOpen) { blockers.push('the owner adoption-authorization gate is closed') }
  if (holdActive) { blockers.push('a project execution hold is active') }
  return blockers.length === 0 ? { ready: true, blockers: [] } : { ready: false, blockers }
}

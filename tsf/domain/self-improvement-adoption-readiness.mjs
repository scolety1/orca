// Native Self-Improvement Loop V1, Phase 5: pure adoption-readiness
// assessment -- mirrors self-update-adoption.mjs's assessAdoptionReadiness
// shape exactly (REUSE_PATTERN: same blockers[] accumulation, same
// ready-iff-empty rule), a different, additive set of blockers (a
// candidate fix's readiness gates differ from TSF's own self-adoption
// gates -- no independentReviewGreen/orcaCoreDeltaZero concept here,
// VERIFIED_PASS from OUR OWN verifier is the equivalent evidence).
export function assessRepairAdoptionReadiness({ findingStatus, verifierVerdict, candidateIsFastForward, candidateWorktreeClean, canonicalClean, gateOpen }) {
  const blockers = []
  if (findingStatus !== 'READY_FOR_ADOPTION') { blockers.push(`finding is not READY_FOR_ADOPTION (status: ${findingStatus})`) }
  if (verifierVerdict !== 'VERIFIED_PASS') { blockers.push(`verifier verdict is not VERIFIED_PASS (${verifierVerdict})`) }
  if (!candidateIsFastForward) { blockers.push('the candidate branch is not a real fast-forward descendant of canonical HEAD') }
  if (!candidateWorktreeClean) { blockers.push('the candidate worktree is not clean') }
  if (!canonicalClean) { blockers.push('canonical tsf/main is not clean') }
  if (!gateOpen) { blockers.push('the owner adoption-authorization gate is closed') }
  return blockers.length === 0 ? { ready: true, blockers: [] } : { ready: false, blockers }
}

// M3's Live Work Feed state mapping -- projects a real Keep Going run
// (tsf/domain/keep-going.mjs) into one of the 9 states Tim specified
// (PLANNING/WORKING/WAITING/VERIFYING/STALLED/NEEDS_YOU/REVISION/
// READY_FOR_ADOPTION/COMPLETED). Every branch is derived from an
// already-persisted, real field -- never fabricated. See
// docs/tsf/M3_CHAT_DISPATCH_LIVE_WORK_FEED_V1.md's state-mapping table.
//
// `gap` (compareStateToGoal's own output shape, or null) is optional and
// only refines the ACTIVE-with-settled-waves case (VERIFYING vs REVISION
// vs WORKING) -- without it, that case honestly falls back to WORKING
// rather than guessing at verification/revision status it cannot back
// with real evidence.
export function projectLiveWorkFeedState(run, gap = null) {
  if (!run) {
    return { state: 'PLANNING', reason: 'no Keep Going run exists yet for this project' }
  }

  const hasOpenNeedsYou = run.needsYou.some((entry) => !entry.resolvedAt)
  if (run.state === 'NEEDS_YOU' || hasOpenNeedsYou) {
    return {
      state: 'NEEDS_YOU',
      reason:
        run.state === 'NEEDS_YOU'
          ? 'run state is NEEDS_YOU'
          : 'an open Needs You question exists on this run'
    }
  }
  if (run.state === 'STALLED') {
    return { state: 'STALLED', reason: 'run state is STALLED' }
  }
  if (run.state === 'BLOCKED') {
    return { state: 'NEEDS_YOU', reason: 'run state is BLOCKED -- needs an operator decision' }
  }
  if (run.state === 'PAUSED') {
    return { state: 'WAITING', reason: 'run state is PAUSED' }
  }
  if (run.state === 'COMPLETE') {
    return {
      state: 'READY_FOR_ADOPTION',
      reason: 'run reached COMPLETE via independently-verified acceptance criteria'
    }
  }

  // run.state === 'ACTIVE' from here.
  if (run.inFlightWave) {
    const lastPhase = run.checkpoints.at(-1)?.phase
    if (lastPhase === 'WAVE_STALLED') {
      return { state: 'STALLED', reason: 'in-flight wave last checkpointed WAVE_STALLED' }
    }
    return { state: 'WORKING', reason: 'a wave is in flight' }
  }
  if (run.tickLock?.kind === 'DISPATCH') {
    return { state: 'WAITING', reason: 'a dispatch tick currently holds the run lock' }
  }
  if (run.waves.length === 0) {
    return { state: 'PLANNING', reason: 'run started, no wave dispatched yet' }
  }
  if (gap && gap.remainingGaps.length > 0) {
    return {
      state: gap.satisfiedCriteria.length > 0 ? 'REVISION' : 'VERIFYING',
      reason:
        gap.satisfiedCriteria.length > 0
          ? 'a prior wave satisfied some criteria; a further wave is pending for the rest'
          : 'a wave settled; independent verification against the goal is pending'
    }
  }
  return { state: 'WORKING', reason: 'run is ACTIVE with settled waves' }
}

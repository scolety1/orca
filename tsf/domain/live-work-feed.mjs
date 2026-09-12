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
//
// Governed-adoption-review finding: VERIFYING/REVISION and the PAUSED
// flavor of WAITING are only ever reachable below when neither
// inFlightWave nor tickLock is set (the inFlightWave/tickLock branches
// return WORKING/WAITING(DISPATCH) first) -- so by construction they never
// describe a live, currently-executing worker, only a settled run with no
// current owner. `isRunExecuting` is the one real, unambiguous fact
// ("would restarting the backend interrupt something") and must be used
// for that decision instead of pattern-matching this label -- see
// update-safety.mjs, which keys off it directly rather than off state.
export function isRunExecuting(run) {
  return !!(run?.inFlightWave || run?.tickLock)
}

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
  const lastCheckpoint = run.checkpoints.at(-1)
  if (lastCheckpoint?.phase === 'DISPATCH_WAITING_FOR_RESOURCES') {
    const detail = lastCheckpoint.note ?? lastCheckpoint.reason ?? 'resource pressure'
    return { state: 'WAITING', reason: `waiting for host resources: ${detail}` }
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

// BUG-13 (bug-ledger.json): a single, real-fact-grounded one-line status
// description, reused by both Planner Chat's deterministic fallback
// (chat-responder.mjs) and the live conversational planner's context
// capsule (live-planner.mjs) -- so however a question about the run is
// answered, it can never disagree with what Keep Going/Flight Recorder
// themselves show, and both call sites stop independently reinventing
// this same sentence.
export function describeLiveRunStatus(run, gap = null) {
  if (!run) {
    return null
  }
  const feed = projectLiveWorkFeedState(run, gap)
  return `Keep Going run ${run.id} is ${feed.state}: ${feed.reason}.`
}

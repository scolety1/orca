// Classifies whether it is currently safe to update TSF's live runtime,
// grounded in real, already-computed fleet activity (fleet-work-status.mjs
// -- the same aggregator Work/Command/GET /api/fleet/status already
// share). Never restarts the live TSF runtime underneath active project
// workers unless there is genuinely nothing in flight (spec Phase 2).
export const UPDATE_SAFETY_STATES = Object.freeze([
  'SAFE_NOW',
  'WAIT_FOR_ACTIVE_WORK',
  'TIM_REQUIRED'
])

// Governed-adoption-review finding (real production evidence, not a
// hypothetical): the original version of this function gated on
// live-work-feed.mjs's state LABEL (VERIFYING/REVISION/WAITING all treated
// as "active"). But those three labels are only ever reachable when
// *neither* inFlightWave nor tickLock is set -- projectLiveWorkFeedState's
// inFlightWave/tickLock(DISPATCH) branches return WORKING/WAITING first,
// before the label-based branches are ever reached. So a run sitting at
// VERIFYING/REVISION for days with nothing executing it (confirmed live:
// three real fleet projects, no live process, clean worktrees, ~2 days
// idle) was wrongly treated as "real work in progress" forever, and would
// have blocked every future update indefinitely. WAITING has the mirror
// problem the other way: it's returned both for a genuinely held dispatch
// lock (should block) AND for a deliberately human-PAUSED run (should
// not). `feed.executing` (fleet-work-status.mjs, backed by
// live-work-feed.mjs's isRunExecuting) is the one real, unambiguous fact
// that answers "would restarting the backend interrupt this run right
// now" -- gate on that instead of the label.
export function classifyUpdateSafety(fleetStatuses) {
  if (!Array.isArray(fleetStatuses)) {
    // Can't determine fleet state at all -- escalate rather than guess
    // it's safe to proceed.
    return {
      state: 'TIM_REQUIRED',
      reason: 'fleet activity could not be determined',
      blockingProjectIds: []
    }
  }
  const needsDecision = fleetStatuses.filter((s) => s.hasRun && s.feed?.state === 'NEEDS_YOU')
  if (needsDecision.length > 0) {
    return {
      state: 'TIM_REQUIRED',
      reason: `${needsDecision.length} project(s) have an open Needs You question -- resolve those before updating`,
      blockingProjectIds: needsDecision.map((s) => s.projectId)
    }
  }
  const active = fleetStatuses.filter((s) => s.hasRun && s.executing)
  if (active.length > 0) {
    return {
      state: 'WAIT_FOR_ACTIVE_WORK',
      reason: `${active.length} project(s) have real work in progress (${active.map((s) => s.feed.state).join(', ')})`,
      blockingProjectIds: active.map((s) => s.projectId)
    }
  }
  return {
    state: 'SAFE_NOW',
    reason: 'no project currently has real work in progress',
    blockingProjectIds: []
  }
}

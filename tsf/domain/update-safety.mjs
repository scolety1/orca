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

// A run in any of these live-work-feed states means an Orca worker or
// verifier is genuinely doing something right now -- restarting the
// backend underneath it would interrupt real work, not just an idle run
// sitting at PLANNING with nothing dispatched yet. Adversarial-review
// finding: REVISION (a prior wave partially satisfied criteria, a further
// wave pending -- live-work-feed.mjs's own mid-cycle state, alongside
// VERIFYING) was missing here and would have wrongly classified that as
// safe to restart through.
const ACTIVE_STATES = new Set(['WORKING', 'VERIFYING', 'REVISION', 'WAITING'])

// fleetStatuses: real domain/fleet-work-status.mjs output (never
// re-derived here) -- this function only classifies, it does not inspect
// runs itself.
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
  const active = fleetStatuses.filter((s) => s.hasRun && ACTIVE_STATES.has(s.feed?.state))
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

// TSF_COMPLETION_WATCH_V1 -- a durable, target-agnostic record of "notify
// Tim once this specific thing reaches a terminal outcome." Round 4
// (Research Completion Notification Continuity): TSF has no push channel
// to Tim at all (no OS notification API, no SSE/websocket, no webhook --
// confirmed by direct investigation of the real Orca host surface and
// every server/ui module before writing this). The only honest way to
// "notify" him is to detect the transition durably, then surface it
// unprompted on his very next real interaction with TSF, exactly once.
//
// `kind` is deliberately generic (not RESEARCH_MISSION-only) so this same
// primitive can later cover Keep Going/Health Repair/verification/
// Ready-for-Adoption completions without a second mechanism -- only
// RESEARCH_MISSION is wired up in this pass (smallest correct scope; see
// server/completion-watch-reconciler.mjs's resolver table for where a
// future kind would be added).
export function createCompletionWatch({ id, kind, targetId, requestedByText = null }, clock) {
  const now = clock().toISOString()
  return {
    schemaVersion: 'TSF_COMPLETION_WATCH_V1',
    id,
    kind,
    targetId,
    requestedByText,
    state: 'PENDING',
    outcome: null, // set only once FIRED_UNSEEN/DELIVERED -- e.g. 'COMPLETE' | 'CANCELLED'
    createdAt: now,
    updatedAt: now,
    firedAt: null,
    deliveredAt: null
  }
}

// PENDING -> FIRED_UNSEEN exactly once. Idempotent: calling this again on
// an already-fired/delivered watch is a true no-op -- never re-fires,
// never overwrites an already-recorded outcome.
export function markCompletionWatchFired(watch, outcome, clock) {
  if (watch.state !== 'PENDING') {
    return watch
  }
  const now = clock().toISOString()
  return { ...watch, state: 'FIRED_UNSEEN', outcome, firedAt: now, updatedAt: now }
}

// FIRED_UNSEEN -> DELIVERED exactly once, for the same reason.
export function markCompletionWatchDelivered(watch, clock) {
  if (watch.state !== 'FIRED_UNSEEN') {
    return watch
  }
  const now = clock().toISOString()
  return { ...watch, state: 'DELIVERED', deliveredAt: now, updatedAt: now }
}

export const COMPLETION_WATCH_STATES = ['PENDING', 'FIRED_UNSEEN', 'DELIVERED']

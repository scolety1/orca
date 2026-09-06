// TSF_COMPLETION_WATCH_V1 -- durable "notify Tim once X reaches a terminal
// outcome." TSF has no push channel (no OS/SSE/webhook) -- see
// server/completion-watch-reconciler.mjs for how this gets surfaced.
// `kind` is generic on purpose (not RESEARCH_MISSION-only) so this covers
// future target types with one new resolver entry, never a second store.
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

// Single-writer planner-mission ownership lease (PLANNER_CONTEXT_LIFECYCLE_V0
// 2B). Deliberately NOT built on resource-pressure-governor.mjs's
// requestHeavyTaskLease/releaseHeavyTaskLease: that lease's `kind` +
// `missionId` fields, its tier-gated admission (buildAdmissionPolicy), and
// its "several HQs must never run the same HEAVY HOST OPERATION at once"
// semantics all belong to host-resource exclusion, a different concern from
// "exactly one planner session directs THIS mission." Reusing it directly
// would mean overloading kind=missionId / missionId=plannerSessionId, which
// is a worse reuse than a small sibling using the SAME proven algorithm
// shape: TTL-expiry liveness + a holder identity, the same pattern
// requestHeavyTaskLease already validated. What genuinely IS reused: the
// cross-process atomic read-modify-write primitive (cross-process-file-
// lock.mjs, via server/planner-mission-store.mjs) -- this module has no I/O
// of its own, exactly like resource-pressure-governor.mjs.
export const DEFAULT_PLANNER_MISSION_LEASE_TTL_MS = 10 * 60 * 1000 // 10min: renewed by an explicit heartbeat call, not a timer this module owns

export function isPlannerMissionLeaseLive(lease, now) {
  return Boolean(lease) && typeof lease.expiresAt === 'string' && new Date(lease.expiresAt) > now
}

// Grants when unheld, stale (crash recovery), or already held by the SAME
// session (idempotent re-acquire = renew). Refuses when live and held by a
// DIFFERENT session. The caller (planner-mission-store.mjs) runs this inside
// a cross-process file lock, so of two concurrent acquire calls only the one
// that wins the file lock's serialization order observes `existing` as
// granted -- real race handling, not an in-memory illusion of one.
export function acquirePlannerMissionLease(existingLease, { plannerSessionId, boundary = 'ACQUIRE', ttlMs = DEFAULT_PLANNER_MISSION_LEASE_TTL_MS }, clock) {
  if (!plannerSessionId) { throw new Error('acquirePlannerMissionLease requires plannerSessionId') }
  const now = clock()
  const expiresAt = new Date(now.getTime() + ttlMs).toISOString()
  if (isPlannerMissionLeaseLive(existingLease, now) && existingLease.holderPlannerSessionId !== plannerSessionId) {
    return {
      granted: false,
      lease: existingLease,
      reason: `mission is already directed by planner session ${existingLease.holderPlannerSessionId}`
    }
  }
  const acquiredAt = isPlannerMissionLeaseLive(existingLease, now) ? existingLease.acquiredAt : now.toISOString()
  const lease = { holderPlannerSessionId: plannerSessionId, acquiredAt, expiresAt, boundary }
  return { granted: true, lease, reason: isPlannerMissionLeaseLive(existingLease, now) ? 'renewed' : 'acquired' }
}

// Must be the live current holder -- a preempted/stale session finding out
// its renew was refused is the "continuity verification" signal it lost
// authority, not something it can silently ignore.
export function renewPlannerMissionLease(existingLease, { plannerSessionId, ttlMs = DEFAULT_PLANNER_MISSION_LEASE_TTL_MS }, clock) {
  const now = clock()
  if (!isPlannerMissionLeaseLive(existingLease, now) || existingLease.holderPlannerSessionId !== plannerSessionId) {
    const error = new Error(`cannot renew: ${plannerSessionId} does not currently hold this lease`)
    error.code = 'TSF_PLANNER_LEASE_NOT_HELD'
    throw error
  }
  return { holderPlannerSessionId: plannerSessionId, acquiredAt: existingLease.acquiredAt, expiresAt: new Date(now.getTime() + ttlMs).toISOString(), boundary: 'RENEW' }
}

export function relinquishPlannerMissionLease(existingLease, { plannerSessionId }, clock) {
  const now = clock()
  if (!existingLease) {
    return { released: false, reason: 'no lease is currently held', lease: null }
  }
  if (isPlannerMissionLeaseLive(existingLease, now) && existingLease.holderPlannerSessionId !== plannerSessionId) {
    return { released: false, reason: `lease is held by ${existingLease.holderPlannerSessionId}, not ${plannerSessionId}`, lease: existingLease }
  }
  return { released: true, reason: 'relinquished', lease: null }
}

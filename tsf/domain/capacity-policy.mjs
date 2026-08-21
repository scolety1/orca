// M5: pure decision layer over a real capacity snapshot (tsf/adapters/
// orca-capacity-bridge.mjs's fetchCapacitySnapshot -- never called from
// here, this module does no I/O). Decides how a dispatch should degrade
// as a specific provider's real usage rises, rather than starting work
// that capacity can't finish. Never fabricates a signal it wasn't given:
// a missing/unknown snapshot always reports assurance 'UNKNOWN' and
// defaults to PROCEED (an absent signal is not evidence of exhaustion --
// treating it as one would itself be a kind of fabrication, just a
// pessimistic one instead of an optimistic one).
export const CAPACITY_ACTIONS = Object.freeze([
  'PROCEED',
  'DOWNGRADE_WORKER',
  'REDUCE_CONCURRENCY',
  'PAUSE_AND_CHECKPOINT'
])

// Percent-used thresholds, deliberately conservative and adjustable in one
// place. Real Orca account-list status strings that signal an explicit
// safety reserve (e.g. 'AT_EXPIRING_CAPACITY_SAFETY_RESERVE', the exact
// value this program has observed live in M2/M3/M4's own dogfood proofs)
// override the raw percentage -- Orca's own computed status is more
// authoritative than a threshold this module guesses at.
const DOWNGRADE_WORKER_AT_PERCENT = 70
const REDUCE_CONCURRENCY_AT_PERCENT = 85
const PAUSE_AT_PERCENT = 95
const SAFETY_RESERVE_STATUSES = new Set(['AT_EXPIRING_CAPACITY_SAFETY_RESERVE'])

export function decideCapacityAction(snapshot, providerId) {
  const providerSnapshot = snapshot?.[providerId]
  const weeklyUsedPercent = providerSnapshot?.weeklyUsedPercent ?? null
  const sessionUsedPercent = providerSnapshot?.sessionUsedPercent ?? null
  if (weeklyUsedPercent === null && sessionUsedPercent === null) {
    return {
      action: 'PROCEED',
      assurance: 'UNKNOWN',
      reason: `no real capacity signal available for ${providerId} -- proceeding without capacity-based restriction rather than fabricating a healthy (or unhealthy) reading`
    }
  }
  const usedPercent = Math.max(weeklyUsedPercent ?? 0, sessionUsedPercent ?? 0)
  const status = providerSnapshot.status
  if (SAFETY_RESERVE_STATUSES.has(status) || usedPercent >= PAUSE_AT_PERCENT) {
    return {
      action: 'PAUSE_AND_CHECKPOINT',
      assurance: 'OBSERVED',
      reason: `${providerId} usage at ${usedPercent}% (status: ${status ?? 'unknown'}) -- pausing and checkpointing rather than starting work that capacity can't finish`
    }
  }
  if (usedPercent >= REDUCE_CONCURRENCY_AT_PERCENT) {
    return {
      action: 'REDUCE_CONCURRENCY',
      assurance: 'OBSERVED',
      reason: `${providerId} usage at ${usedPercent}% -- reducing concurrency near the limit`
    }
  }
  if (usedPercent >= DOWNGRADE_WORKER_AT_PERCENT) {
    return {
      action: 'DOWNGRADE_WORKER',
      assurance: 'OBSERVED',
      reason: `${providerId} usage at ${usedPercent}% -- preferring a cheaper worker tier for mechanical work`
    }
  }
  return {
    action: 'PROCEED',
    assurance: 'OBSERVED',
    reason: `${providerId} usage at ${usedPercent}%, within normal operating range`
  }
}

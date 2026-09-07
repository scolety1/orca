// Rollover triggers (2E) -- observable signals only. No fake token-count/
// turn-count thresholds: nothing in this codebase's server layer observes a
// planner's own context length today, so inventing that precision here
// would be fabricated state, not a real signal.
import { classifyResourcePressureTier } from './resource-pressure-governor.mjs'

export const PLANNER_HANDOFF_TRIGGERS = Object.freeze([
  'EXPLICIT_RETIREMENT', // the planner session itself called retire()
  'RESOURCE_PRESSURE', // Resource Pressure Governor observed CRITICAL/EMERGENCY
  'TRANSPORT_TERMINATED', // the chat/session transport reported termination
  'STALE_LEASE_DETECTED' // this session's own lease heartbeat found it no longer holds the lease (preempted or expired)
])

// First true signal wins, checked in a fixed, most-authoritative-first order:
// an explicit call always means "hand off now" regardless of anything else;
// losing the lease is next most urgent (this session is no longer
// authoritative regardless of what it wants); then transport loss; then
// resource pressure (a signal to hand off gracefully, not to abandon).
export function decidePlannerHandoffTrigger({ explicitRetirement = false, staleLeaseDetected = false, transportTerminated = false, hostMemoryAvailableBytes = null } = {}) {
  if (explicitRetirement) { return { shouldHandoff: true, trigger: 'EXPLICIT_RETIREMENT' } }
  if (staleLeaseDetected) { return { shouldHandoff: true, trigger: 'STALE_LEASE_DETECTED' } }
  if (transportTerminated) { return { shouldHandoff: true, trigger: 'TRANSPORT_TERMINATED' } }
  if (hostMemoryAvailableBytes !== null) {
    const tier = classifyResourcePressureTier(hostMemoryAvailableBytes)
    if (tier === 'CRITICAL' || tier === 'EMERGENCY') {
      return { shouldHandoff: true, trigger: 'RESOURCE_PRESSURE', tier }
    }
  }
  return { shouldHandoff: false, trigger: null }
}

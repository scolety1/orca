// Resource Pressure Governor gate for keep-going-dispatch-loop.mjs's real
// heavyweight-worker dispatch step. Extracted to its own file (Main TSF
// integration review, admission-coverage inventory) rather than inlined --
// keep-going-dispatch-loop.mjs was already near its own max-lines cap;
// this keeps the gate a single, focused, independently-testable unit and
// avoids growing that file for a concern that isn't really about wave
// dispatch mechanics. The caller commits the actual skip via its own
// existing commitReleaseOnly helper (a plain releaseTick, no checkpoint --
// this is a lightweight, expected-to-clear-soon condition, not a real
// dispatch failure worth a durable checkpoint trail) labeled
// 'DISPATCH_WAITING_FOR_RESOURCES', deliberately never 'DISPATCH_FAILED'
// -- the governing requirement explicitly says a resource wait must never
// look like a failure.
import { collectHostMemoryEvidence } from './resource-pressure-collector.mjs'
import { classifyResourcePressureTier, buildAdmissionPolicy } from '../domain/resource-pressure-governor.mjs'

export const DEFAULT_RESOURCE_PRESSURE = Object.freeze({ collectHostMemoryEvidence })

export function classifyDispatchAdmission(resourcePressure) {
  const tier = classifyResourcePressureTier(resourcePressure.collectHostMemoryEvidence().availableBytes)
  return {
    tier,
    admitted: buildAdmissionPolicy(tier).newHeavyweightWorkerDispatch !== 'REFUSE',
    reason: `host memory tier is ${tier} -- no new heavyweight dispatch until it clears`
  }
}

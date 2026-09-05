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
import { classifyDispatchAdmission as classifyAdmission } from '../domain/resource-pressure-governor.mjs'

export const DEFAULT_RESOURCE_PRESSURE = Object.freeze({ collectHostMemoryEvidence })

// Independent-review finding: this "read host memory -> classify tier ->
// check one admission category" pattern was independently re-implemented
// three times across this codebase (here, chat-dispatch-bridge.mjs,
// research-mission-fleet-driver.mjs) -- delegates to the one shared
// domain-level implementation now, so a future change to tier semantics
// or refusal wording can't silently drift between the three.
export function classifyDispatchAdmission(resourcePressure) {
  return classifyAdmission(resourcePressure.collectHostMemoryEvidence(), 'newHeavyweightWorkerDispatch')
}

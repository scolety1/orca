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
import { checkpointRun, recordPendingDispatch } from '../domain/keep-going.mjs'

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

// Resource-Wait Auto-Resume V1: the real, durable side effect of a refused
// dispatchStep call in keep-going-dispatch-loop.mjs -- extracted here for
// the same reason this whole file already exists (that module was already
// near its own max-lines cap). Phase 12 (category 8)'s own checkpoint
// (durably records the refusal, was: vanished with zero trace) and this
// program's pendingDispatch record (the exact candidateWorkItems this
// refused attempt tried to place as the run's FIRST wave -- waves.length
// === 0 only; a run with an existing wave already has a real, working
// continuation path via reconcileSettledRun/buildContinuationWorkItem in
// keep-going-fleet-driver.mjs, which needs no help from this field) are
// written together here. pendingDispatch is written on every refusal, not
// just the first (a later, corrected candidateWorkItems is always what a
// resume replays), independent of the checkpoint dedup (a separate,
// log-spam concern) -- this is what lets the fleet driver retry the SAME
// originally-intended dispatch automatically once resources allow, with no
// human re-supplying it.
export async function recordResourceRefusal(store, projectId, candidateWorkItems, admission, clock) {
  const current = store.readRun(projectId)
  if (!current) {
    return
  }
  const alreadyCheckpointed = current.checkpoints.at(-1)?.phase === 'DISPATCH_WAITING_FOR_RESOURCES'
  if (current.waves.length !== 0 && alreadyCheckpointed) {
    return
  }
  await store.withRun(projectId, (r) => {
    if (!r) {
      return r
    }
    let n = r
    if (r.waves.length === 0) {
      n = recordPendingDispatch(n, candidateWorkItems, clock, n.revision)
    }
    if (n.checkpoints.at(-1)?.phase !== 'DISPATCH_WAITING_FOR_RESOURCES') {
      n = checkpointRun(
        n,
        { phase: 'DISPATCH_WAITING_FOR_RESOURCES', note: admission.reason ?? admission.tier ?? null, evidence: [] },
        clock,
        n.revision
      )
    }
    return n
  })
}

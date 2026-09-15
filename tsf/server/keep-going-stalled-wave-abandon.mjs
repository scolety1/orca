// Extracted from keep-going-dispatch-loop.mjs (TSF_DOGFOOD_FINDING_1_
// EXECUTION_HOLD_SAFETY_V1, to stay under that file's own max-lines cap
// after adding its execution-hold gate) -- unchanged logic, same real
// compare-and-swap store primitive, same orchestration bridge.
//
// Recovers a run whose in-flight wave stalled AND releases the real Orca
// resource(s) that wave held. abandonKeepGoingStalledWave (keep-going-
// controller.mjs) only fences TSF's own bookkeeping -- without also
// telling Orca the dispatch is done, its worktree resource stays marked
// owned there, which can silently block a later worker-start into the
// same worktree (a real, live-confirmed gap: a manual UI acceptance
// retest hit exactly this after using the abandon button -- the retry's
// task was created but never dispatched, with zero trace in Orca's own
// worker-list). Captures dispatchRecords from the SAME `current` value
// the atomic mutate below observes, INSIDE the store.withRun closure --
// not a separate, unlocked pre-read (an independent review finding: this
// module's own expectedRevision check is a documented no-op when the
// caller omits it, so a prior version's "nothing could have raced the
// read" claim was only true for callers that always supply it, not as a
// module-level guarantee; reading from the exact object the CAS itself
// observes closes the gap unconditionally instead).
// Best-effort past the commit: a failure reconciling one dispatch with
// Orca does not undo or block the TSF-side fencing that already
// succeeded -- TSF's own state consistency must not depend on Orca's
// cooperation, matching this module's existing dispatch-failure handling.
//
// Then auto-resumes the run so it's usable again -- unless the project is
// under an execution hold, in which case keep-going-controller.mjs's own
// abandonKeepGoingStalledWave refuses (this function's own hold check
// below is what lets it see that).
import { abandonOrchestrationWorker } from '../adapters/orca-orchestration-bridge.mjs'
import { abandonKeepGoingStalledWave } from './keep-going-controller.mjs'
import { readKeepGoingRun, withKeepGoingRun } from './keep-going-run-store.mjs'
import { readProjectExecutionHold } from './project-execution-hold-store.mjs'

const DEFAULT_ORCHESTRATION = Object.freeze({ abandonOrchestrationWorker })
const DEFAULT_STORE = Object.freeze({ readRun: readKeepGoingRun, withRun: withKeepGoingRun })

export async function abandonAndReconcileStalledWave(
  projectId,
  reason,
  clock,
  expectedRevision,
  deps = {}
) {
  const orchestration = deps.orchestration ?? DEFAULT_ORCHESTRATION
  const store = deps.store ?? DEFAULT_STORE

  let abandonedDispatchIds = []
  const next = await store.withRun(projectId, (current) => {
    abandonedDispatchIds = (current?.inFlightWave?.dispatchRecords ?? [])
      .map((record) => record.dispatchId)
      .filter(Boolean)
    // TSF_DOGFOOD_FINDING_1_EXECUTION_HOLD_SAFETY_V1: same fake-opState gap
    // as keep-going-http-routes.mjs's mutateThroughStore -- without a real
    // projectExecutionHolds entry, abandonKeepGoingStalledWave's own hold
    // gate (it auto-resumes the run) would silently never fire here.
    const hold = (deps.readProjectExecutionHold ?? readProjectExecutionHold)(projectId)
    const { run } = abandonKeepGoingStalledWave(
      { keepGoingRuns: { [projectId]: current }, projectExecutionHolds: { [projectId]: hold } },
      projectId,
      reason,
      clock,
      expectedRevision
    )
    return run
  })

  const orchestrationReconciliation = []
  for (const dispatchId of abandonedDispatchIds) {
    try {
      const result = await orchestration.abandonOrchestrationWorker({ dispatch: dispatchId })
      orchestrationReconciliation.push({
        dispatchId,
        ok: result.ok,
        reason: result.ok ? null : (result.reason ?? null)
      })
    } catch (error) {
      orchestrationReconciliation.push({ dispatchId, ok: false, reason: error.message })
    }
  }

  return { run: next, orchestrationReconciliation }
}

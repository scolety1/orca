// Synchronous compare-and-swap over exactly one project's keepGoingRun.
// loadState()/saveState() (data-store.mjs) are both synchronous fs calls
// (readFileSync/writeFileSync), so a function with no `await` between them
// cannot be interleaved by any other request's code -- Node's single-
// threaded event loop only yields control at an await. This is the
// concurrency primitive the autonomous wave-dispatch loop's claim/commit
// steps are built on (tsf/server/keep-going-dispatch-loop.mjs), instead of
// a caller capturing opState once and writing it back later across an
// await boundary (the still-open document-level race in data-store.mjs's
// OTHER routes -- deliberately not rewritten here; see program state.json
// M2 gaps for that separate, larger, out-of-scope item).
import { loadState, saveState } from './data-store.mjs'
import { keepGoingRunFor } from './keep-going-controller.mjs'

// Read-only snapshot -- safe to call freely, never mutates. Used for the
// cheap upfront checks (no run / not ACTIVE / nothing to do) that don't
// need exclusive ownership.
export function readKeepGoingRun(projectId) {
  return keepGoingRunFor(loadState(), projectId)
}

// mutateFn(current) must be synchronous and pure: given the just-loaded
// run (or null if none exists), return the next run, or throw (e.g.
// TSF_STALE_REVISION, TSF_TICK_IN_PROGRESS, TSF_RUN_NOT_FOUND) to abort --
// nothing is persisted if it throws. No `await` may appear inside mutateFn
// or between the load and save below, or the atomicity guarantee this
// module exists for is lost.
export function withKeepGoingRun(projectId, mutateFn) {
  const opState = loadState()
  const current = keepGoingRunFor(opState, projectId)
  const next = mutateFn(current)
  const nextOpState = { ...opState, keepGoingRuns: { ...opState.keepGoingRuns, [projectId]: next } }
  saveState(nextOpState)
  return next
}

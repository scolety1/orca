// Compare-and-swap over exactly one project's keepGoingRun. withKeepGoingRun
// is async (it awaits the cross-process lock acquire below), but the actual
// read-mutate-write critical section stays synchronous once the lock is
// held. loadState()/saveState() (data-store.mjs) are both synchronous fs
// calls
// (readFileSync/writeFileSync), so a function with no `await` between them
// cannot be interleaved by any other request's code WITHIN one OS process
// -- Node's single-threaded event loop only yields control at an await.
// That alone does NOT protect against a second, separate OS process (a
// cron-triggered tick, once that automation is authorized) reading/
// writing the same state file concurrently -- a real, independently
// verified gap -- so the critical section below is also wrapped in
// cross-process-file-lock.mjs's OS-level exclusive-file-creation lock.
// This is the concurrency primitive the autonomous wave-dispatch loop's
// claim/commit steps are built on (tsf/server/keep-going-dispatch-loop.mjs),
// instead of a caller capturing opState once and writing it back later
// across an await boundary (the still-open document-level race in
// data-store.mjs's OTHER routes -- deliberately not rewritten here; see
// program state.json M2 gaps for that separate, larger, out-of-scope item).
import { withFileLock } from './cross-process-file-lock.mjs'
import { assertSupportedKeepGoingRunSchemaVersion } from '../domain/research-schema-versioning.mjs'
import { getStateFilePath, loadState, saveState } from './data-store.mjs'
import { keepGoingRunFor } from './keep-going-controller.mjs'

// Every read boundary asserts schema-version compatibility BEFORE the run
// reaches any caller -- mirrors research-mission-store.mjs's
// researchMissionFor. Fails closed on a version this running code was never
// verified against, rather than silently operating on an unfamiliar shape.
function versionCheckedRun(run) {
  if (run) { assertSupportedKeepGoingRunSchemaVersion(run) }
  return run
}

// Sibling to the real state file, not the file itself -- readers never
// take this lock (see readKeepGoingRun below), so a lock file distinct
// from operator-state.json avoids any risk of it being mistaken for real
// state content by another consumer of that file.
function lockPath() {
  return `${getStateFilePath()}.lock`
}

// Read-only snapshot -- safe to call freely, never mutates, never takes
// the lock. Used for the cheap upfront checks (no run / not ACTIVE /
// nothing to do) that don't need exclusive ownership; a torn read here in
// the rare case another process is mid-write is no worse than today's
// existing behavior, and every real mutation still goes through the CAS
// below regardless of what an earlier readKeepGoingRun saw.
export function readKeepGoingRun(projectId) {
  return versionCheckedRun(keepGoingRunFor(loadState(), projectId))
}

// mutateFn(current) must be synchronous and pure: given the just-loaded
// run (or null if none exists), return the next run, or throw (e.g.
// TSF_STALE_REVISION, TSF_TICK_IN_PROGRESS, TSF_RUN_NOT_FOUND) to abort --
// nothing is persisted if it throws. No `await` may appear inside mutateFn
// or between the load and save below, or the atomicity guarantee this
// module exists for is lost. Async now (awaits the cross-process lock
// acquire) -- every caller must await this.
export async function withKeepGoingRun(projectId, mutateFn) {
  return withFileLock(lockPath(), undefined, () => {
    const opState = loadState()
    const current = versionCheckedRun(keepGoingRunFor(opState, projectId))
    const next = mutateFn(current)
    const nextOpState = {
      ...opState,
      keepGoingRuns: { ...opState.keepGoingRuns, [projectId]: next }
    }
    saveState(nextOpState)
    return next
  })
}

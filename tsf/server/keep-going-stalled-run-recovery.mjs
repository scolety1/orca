// Fleet Dispatch Readiness Overnight V1, Part H: closes a real, observed
// gap -- a Keep Going run (tsf-orca) sat STALLED for ~5 real days with no
// automatic recovery, because the autonomous fleet driver
// (keep-going-fleet-driver-bootstrap.mjs) is opt-in by design (matches
// this codebase's own "autonomy stays off unless explicitly enabled"
// convention) AND its own eligibility filter only ever considers ACTIVE
// runs -- STALLED is structurally never picked up by it, with or without
// the opt-in flag. The real, deeper cause: nothing reconciles durable
// state at all while no server process is running, and this server's own
// existing recovery scans (recoverInterruptedPrepareForWorkOperations,
// recoverInterruptedHealthRepairOperations) already establish the correct
// pattern for exactly this shape of problem -- this is the third one,
// mirrored exactly, not a new mechanism. Reuses the real, existing,
// retry-budget-aware recovery function (abandonAndReconcileStalledWave)
// verbatim -- never a second recovery mechanism, never an unbounded retry
// loop (that function's own domain logic already escalates to NEEDS_YOU
// once the retry budget is exhausted).
import { loadState } from './data-store.mjs'
import { abandonAndReconcileStalledWave } from './keep-going-dispatch-loop.mjs'

// A run that just transitioned to STALLED moments before this scan runs
// should be left to the normal flow (a real chat tick, or the opt-in
// driver if enabled) -- only a run that's been sitting STALLED for at
// least its OWN configured stall threshold again is unambiguously stale,
// reusing that real per-run budget concept rather than inventing a second
// "how long is too long" constant.
function isStaleStalledRun(run, now) {
  if (run?.state !== 'STALLED') { return false }
  const stalledAt = run.transitions?.findLast((t) => t.to === 'STALLED')?.at
  if (!stalledAt) { return false }
  const thresholdMs = run.budget?.stallThresholdMs ?? 30 * 60 * 1000
  return now - Date.parse(stalledAt) > thresholdMs
}

// Fire-and-forget, called once at server startup -- same convention as
// recoverInterruptedPrepareForWorkOperations/recoverInterruptedHealthRepairOperations
// (http-server.mjs's own startStandaloneServer). Returns the real project
// ids it acted on, for logging/testing -- never throws (a single project's
// recovery failure must not prevent scanning the rest, or block startup).
// deps.abandon/deps.readState let a test inject a fixed store/spy, same
// convention as every other real-side-effect call in this codebase.
export async function recoverStaleStalledKeepGoingRuns(clock = () => new Date(), deps = {}) {
  const readState = deps.readState ?? loadState
  const abandon = deps.abandonAndReconcileStalledWave ?? abandonAndReconcileStalledWave
  const opState = readState()
  const now = clock().getTime()
  const staleProjectIds = Object.entries(opState.keepGoingRuns ?? {})
    .filter(([, run]) => isStaleStalledRun(run, now))
    .map(([projectId]) => projectId)

  const recovered = []
  for (const projectId of staleProjectIds) {
    try {
      const run = opState.keepGoingRuns[projectId]
      // eslint-disable-next-line no-await-in-loop -- bounded by real stale-run count, mirrors this codebase's own sequential-recovery-scan precedent
      await abandon(
        projectId,
        'STARTUP_RECONCILIATION: run was still STALLED at server startup, past its own stall threshold -- no mission silently rots',
        clock,
        run.revision
      )
      recovered.push(projectId)
    } catch (error) {
      console.error(`stalled-run startup recovery failed for ${projectId}:`, error)
    }
  }
  return recovered
}

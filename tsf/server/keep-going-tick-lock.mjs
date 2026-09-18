// The shared CAS tick-lock primitives keep-going-dispatch-loop.mjs's own
// dispatchStep and keep-going-settle-step.mjs's settleStep both build on --
// extracted so neither file has to duplicate this exact-once-per-tick
// claim/commit contract (see keep-going-dispatch-loop.mjs's own module
// header for the full concurrency model this implements).
import { claimTick, releaseTick, TICK_LOCK_TIMEOUT_MS } from '../domain/keep-going.mjs'

function runNotFoundError() {
  const error = new Error('no Keep Going run for this project')
  error.code = 'TSF_RUN_NOT_FOUND'
  return error
}

// Claims the tick lock via one CAS (async only in the cross-process lock
// acquire -- the actual read-mutate-write stays synchronous once held).
// Throws (never silently no-ops) on any conflict -- the caller turns that
// into a clean, no-CLI-work-attempted result.
//
// `kind` was decided by tickKeepGoingRun's own routing check
// (inFlightWave ? SETTLE : DISPATCH) against a read taken BEFORE this
// lock was ever acquired -- with the lock's acquire phase now async (the
// cross-process fix), real wall-clock time can pass between that stale
// read and this claim actually running, wide enough for another tick to
// fully claim+dispatch+commit in between. Re-validating kind against the
// FRESH, lock-protected read here -- rather than trusting the caller's
// now-possibly-stale routing decision -- is what closes that window: a
// real, confirmed review finding (two near-simultaneous ticks could each
// create a genuine duplicate Orca task before either reached its own
// commit, defeating this module's core "reject before touching
// orchestration" guarantee, which held only by coincidence when the old
// claim path was fully synchronous with no real await before it).
export async function claim(projectId, kind, clock, store, timeoutMs = TICK_LOCK_TIMEOUT_MS) {
  return store.withRun(projectId, (current) => {
    if (!current) {
      throw runNotFoundError()
    }
    const actuallyInFlight = !!current.inFlightWave
    const expectedInFlight = kind === 'SETTLE'
    if (actuallyInFlight !== expectedInFlight) {
      const error = new Error(
        `stale routing decision: this ${kind} claim expected inFlightWave=${expectedInFlight}, but the current run has inFlightWave=${actuallyInFlight} -- another tick changed it first`
      )
      error.code = 'TSF_STALE_ROUTING_DECISION'
      throw error
    }
    return claimTick(current, kind, clock, current.revision, timeoutMs)
  })
}

// Commits the tick's real mutation via a second synchronous CAS. mutateFn
// is always handed `expectedRevision` (the exact revision the claim
// produced) explicitly, alongside the freshly-read current run, and MUST
// use it for its FIRST real domain mutation -- never a mutation's own
// self-consistent revision, which is a tautology (current.revision always
// equals current.revision) and can never detect that the lock was
// recovered by another tick since the claim (a real, confirmed review
// finding: two commit paths omitted this and used self-checks instead).
// Threading it through this one wrapper, rather than each call site
// improvising its own commit, makes that omission structurally harder to
// repeat. Subsequent mutations within the SAME closure may use the
// just-produced value's own revision safely (nothing else can run between
// them -- this whole closure is one synchronous unit).
export async function commitClaimed(projectId, store, claimed, mutateFn) {
  return store.withRun(projectId, (current) => mutateFn(current, claimed.revision))
}

// A commit lost the CAS race (lock timed out and was recovered by another
// tick, or some other conflict) -- report it honestly rather than retrying
// unboundedly or silently discarding real Orca side effects already made.
// Known, disclosed limitation: an orchestrationRunId/dispatchRecords
// created by the losing tick are not automatically merged onto whatever
// the winning tick produced (that would risk clobbering the winner's own,
// already-persisted reference) -- they are surfaced here for an operator
// or a future reconciliation pass, not silently lost from observability.
export function lostLockResult(action, error, orphaned) {
  return {
    action: `${action}_LOST_LOCK`,
    reason: error.code ?? 'CONCURRENT_MODIFICATION',
    detail: error.message,
    ...orphaned
  }
}

// The common "nothing to record beyond releasing the lock" commit shape --
// used by every settle-side early exit that has no real domain mutation
// besides giving up ownership.
export async function commitReleaseOnly(
  projectId,
  store,
  claimed,
  clock,
  action,
  outcomes,
  extra = {}
) {
  try {
    const next = await commitClaimed(projectId, store, claimed, (current, expectedRevision) =>
      releaseTick(current, clock, expectedRevision)
    )
    return { action, run: next, ...(outcomes ? { outcomes } : {}), ...extra }
  } catch (error) {
    return lostLockResult(action, error, {})
  }
}

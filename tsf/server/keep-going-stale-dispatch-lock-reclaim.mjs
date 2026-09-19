// A DISPATCH tick lock left behind by a crashed/interrupted attempt, past
// its own TICK_LOCK_TIMEOUT_MS, is safely reclaimable -- claimTick already
// knows how to treat it as such (and to refuse an ambiguous crash via
// TSF_KEEP_GOING_DISPATCH_AMBIGUOUS, when a prior dispatchAttempt never
// resolved). This exists only so keep-going-dispatch-loop.mjs's dispatchStep
// can reach that same, already-correct reclaim logic on a tick with no NEW
// work to plan, without duplicating claimTick/releaseTick's own real rules.
//
// Real, live-discovered bug (RDD V1 refinement pilot): dispatchStep's own
// empty-candidates NOOP used to fire unconditionally, before claim() ever
// ran -- so an expired lock could never be reclaimed by a tick with nothing
// new to dispatch, permanently wedging the run with no operator signal.
//
// Real adversarial-review finding (round 1): claim and release used to be
// two SEPARATE, sequential `store.withRun` commits. A process crash (or a
// storage failure -- the second call sat outside any try/catch) between
// them left a FRESH tickLock/dispatchAttempt durably persisted with nothing
// to ever release it -- the exact permanent wedge this module exists to
// fix, now self-inflicted by its own recovery path. Claim and release now
// happen inside the SAME synchronous `withRun` mutation, so there is no
// window where a crash can observe one without the other.
import { claimTick, releaseTick } from '../domain/keep-going.mjs'

export async function reclaimExpiredDispatchLock(projectId, clock, store) {
  try {
    const run = await store.withRun(projectId, (current) => {
      if (!current) {
        const error = new Error('no Keep Going run for this project')
        error.code = 'TSF_RUN_NOT_FOUND'
        throw error
      }
      if (current.inFlightWave) {
        // A real wave started between this reclaim attempt and its own
        // read -- no longer a DISPATCH claim's job; mirrors claim()'s own
        // stale-routing-decision guard in keep-going-dispatch-loop.mjs.
        const error = new Error('a real wave is now in flight -- not a stale DISPATCH lock')
        error.code = 'TSF_STALE_ROUTING_DECISION'
        throw error
      }
      const claimed = claimTick(current, 'DISPATCH', clock, current.revision)
      return releaseTick(claimed, clock, claimed.revision)
    })
    return { reclaimed: true, run }
  } catch (error) {
    // TSF_TICK_IN_PROGRESS (still genuinely active) or
    // TSF_KEEP_GOING_DISPATCH_AMBIGUOUS (a crash with possibly real,
    // undiscoverable Orca side effects) are both honest, expected outcomes,
    // never silently swallowed -- the caller surfaces `code`.
    return { reclaimed: false, code: error.code ?? 'CLAIM_FAILED' }
  }
}

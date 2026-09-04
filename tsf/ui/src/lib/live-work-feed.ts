// M3: client-side mirror of tsf/domain/live-work-feed.mjs's state mapping,
// adapted to the fields KeepGoingRunView (the server's own projection)
// actually exposes -- no raw domain internals (inFlightWave, tickLock) are
// sent to the client, so this reads state/phase/gap/openNeedsYou/
// dispatchTickActive instead. Every branch is derived from a real,
// already-fetched field -- no fabricated status.
//
// An independent review finding: an earlier version had no analog for the
// domain function's own ACTIVE-with-no-wave-yet-but-a-dispatch-tick-
// currently-claimed-the-lock case (WAITING) -- a real, reachable window
// (claim() persists the tick lock in its own write, before the real Orca
// CLI round-trips and the eventual WAVE_DISPATCHED commit), not merely
// theoretical: any concurrent load of this panel (a second tab, a
// refresh) while a dispatch is mid-flight would show a stale PLANNING/
// WORKING guess instead. dispatchTickActive (added to the server's view
// model specifically for this) closes that gap.
import type { KeepGoingActiveRunView } from './keep-going-types'

export type LiveWorkFeedState =
  | 'PLANNING'
  | 'WORKING'
  | 'WAITING'
  | 'VERIFYING'
  | 'STALLED'
  | 'NEEDS_YOU'
  | 'REVISION'
  | 'READY_FOR_ADOPTION'
  | 'COMPLETED'

export type LiveWorkFeedProjection = { state: LiveWorkFeedState; reason: string }

const DISPATCHED_PHASES = new Set(['WAVE_DISPATCHED', 'WAVE_DISPATCHED_PARTIAL'])

export function projectLiveWorkFeedState(
  run: KeepGoingActiveRunView | null
): LiveWorkFeedProjection {
  if (!run) {
    return { state: 'PLANNING', reason: 'no Keep Going run exists yet for this project' }
  }
  if (run.state === 'NEEDS_YOU' || run.openNeedsYou.length > 0) {
    return {
      state: 'NEEDS_YOU',
      reason:
        run.state === 'NEEDS_YOU'
          ? 'run state is NEEDS_YOU'
          : 'an open Needs You question exists on this run'
    }
  }
  if (run.state === 'STALLED') {
    return { state: 'STALLED', reason: 'run state is STALLED' }
  }
  if (run.state === 'BLOCKED') {
    return { state: 'NEEDS_YOU', reason: 'run state is BLOCKED -- needs an operator decision' }
  }
  if (run.state === 'PAUSED') {
    return { state: 'WAITING', reason: 'run state is PAUSED' }
  }
  if (run.state === 'COMPLETE') {
    // The server's own projection has no separate "adopted" field yet
    // (readyForAdoption is simply run.state === 'COMPLETE') -- COMPLETED
    // as a state distinct from READY_FOR_ADOPTION isn't derivable from
    // what's fetched today, so this honestly reports what IS knowable
    // rather than fabricating an adoption fact the server hasn't recorded.
    return {
      state: 'READY_FOR_ADOPTION',
      reason: 'run reached COMPLETE via independently-verified acceptance criteria'
    }
  }
  // run.state === 'ACTIVE' from here.
  // BUG-14 (bug-ledger.json): real drift found -- the domain projection
  // (tsf/domain/live-work-feed.mjs) checks inFlightWave-with-last-
  // checkpoint-WAVE_STALLED BEFORE its dispatched-phase check; this mirror
  // had no equivalent at all, so it could fall through to a guessed
  // WORKING/VERIFYING/REVISION instead of the real STALLED. Checked first,
  // matching the domain function's own ordering.
  if (run.inFlightWaveStalled) {
    return { state: 'STALLED', reason: 'in-flight wave last checkpointed WAVE_STALLED' }
  }
  if (DISPATCHED_PHASES.has(run.phase)) {
    return { state: 'WORKING', reason: 'a wave is in flight' }
  }
  if (run.dispatchTickActive) {
    return { state: 'WAITING', reason: 'a dispatch tick currently holds the run lock' }
  }
  if (run.wavesCompleted === 0) {
    return { state: 'PLANNING', reason: 'run started, no wave dispatched yet' }
  }
  if (run.gap.remainingGaps.length > 0) {
    return run.gap.satisfiedCriteria.length > 0
      ? {
          state: 'REVISION',
          reason: 'a prior wave satisfied some criteria; a further wave is pending for the rest'
        }
      : {
          state: 'VERIFYING',
          reason: 'a wave settled; independent verification against the goal is pending'
        }
  }
  return { state: 'WORKING', reason: 'run is ACTIVE with settled waves' }
}

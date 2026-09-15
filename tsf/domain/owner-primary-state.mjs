// TSF UI FINDINGS #2-#16 RECONCILE & UPGRADE, Finding #5/#6/#7: the ONE
// canonical mapping from owner-work-model.mjs's own already-reconciled
// 9-value vocabulary (OWNER_WORK_STATES) down to the settled 4-word
// primary owner-facing state model: WORKING / WAITING / NEEDS_YOU / DONE.
// Every surface that needs a single top-level status word for a project
// (HQ's bucket membership, Command's fleet-status text/panel, Project
// Overview's status banner) must derive it from HERE, never re-derive its
// own reading of the richer state -- same "one place, every surface reads
// the same answer" principle owner-work-model.mjs's own header already
// states for the layer below this one.
//
// Does NOT replace owner-work-model.mjs's own OWNER_WORK_STATES -- that
// richer vocabulary remains real, internal detail (HQ's own more granular
// sections -- Needs You / Active Work / Ready for Adoption / Waiting for
// Resources / Recently Completed -- stay driven by it, unchanged). This
// module only adds the FINAL collapse for contexts that need one word.
import { isProjectExecutionHoldActive } from './project-execution-hold.mjs'

export const OWNER_PRIMARY_STATES = Object.freeze(['WORKING', 'WAITING', 'NEEDS_YOU', 'DONE'])

// ownerState is one of owner-work-model.mjs's OWNER_WORK_STATES. A hold
// takes priority over whatever the underlying run/mission state would
// otherwise say -- "TSF must not begin or resume execution for this
// project" is true regardless of what the run itself is doing.
const OWNER_STATE_TO_PRIMARY = Object.freeze({
  PLANNING: { primary: 'WAITING', reasonLabel: 'Preparing' },
  WORKING: { primary: 'WORKING', reasonLabel: null },
  WAITING: { primary: 'WAITING', reasonLabel: 'Resources' },
  VERIFYING: { primary: 'WAITING', reasonLabel: 'Verifying' },
  NEEDS_YOU: { primary: 'NEEDS_YOU', reasonLabel: null },
  READY: { primary: 'NEEDS_YOU', reasonLabel: 'Ready for adoption' },
  DONE: { primary: 'DONE', reasonLabel: null },
  // owner-work-model.mjs's own comment: "something needs an operator
  // decision because it stopped making progress" -- the literal definition
  // of NEEDS_YOU in the new primary model, not a 5th primary word.
  FAILED: { primary: 'NEEDS_YOU', reasonLabel: 'Stalled' },
  PAUSED: { primary: 'WAITING', reasonLabel: 'Paused' }
})

// `hold` is the real project-execution-hold.mjs record for this project (or
// null/undefined) -- read live by the caller, never re-derived here.
// `reason` is the OwnerWorkItem's own real reason string, preserved
// verbatim as the detail sentence; `reasonLabel` is the short secondary
// word the mission's spec calls for (e.g. "WAITING -- Paused").
//
// DONE is the one exception to "a hold always wins": a hold blocks
// beginning/resuming execution, but a DONE work item has nothing left to
// execute -- an owner-set hold that outlives the run it was about (a real,
// possible case; nothing automatically clears a hold when a run completes)
// must never make an already-finished/adopted item read as still waiting.
export function ownerPrimaryState(ownerState, { hold = null, reason = null } = {}) {
  if (ownerState !== 'DONE' && isProjectExecutionHoldActive(hold)) {
    return {
      primary: 'WAITING',
      reasonLabel: 'Execution hold',
      reason: hold.note ?? `execution held -- ${hold.reason}`
    }
  }
  const mapped = OWNER_STATE_TO_PRIMARY[ownerState]
  if (!mapped) {
    // Never silently invent a primary state for an owner-work-model value
    // this mapping doesn't know about -- an unmapped state is a real gap to
    // fix here, not something to guess at with a fabricated default.
    throw new Error(`ownerPrimaryState: no primary-state mapping for owner state "${ownerState}"`)
  }
  return { primary: mapped.primary, reasonLabel: mapped.reasonLabel, reason }
}

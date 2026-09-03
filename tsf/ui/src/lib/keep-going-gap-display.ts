import type { KeepGoingRunState } from './keep-going-types'

// BUG-11 (bug-ledger.json): gap.decision (CONTINUE/STOP_COMPLETE/STOP_BLOCKED/
// STOP_BUDGET_EXHAUSTED) is computed by compareStateToGoal the same way
// regardless of run.state -- so a STALLED/PAUSED/NEEDS_YOU/BLOCKED run still
// says "CONTINUE", rendered as a Badge right next to the panel's real
// recovery controls. An operator reads that as an actionable command; it
// isn't one (no onClick, and the real recovery action -- Abandon stalled
// wave / Resume -- lives in a separate button below). Only meaningful while
// a run is actually being actively driven.
export function shouldShowGapDecisionBadge(state: KeepGoingRunState): boolean {
  return state === 'ACTIVE'
}

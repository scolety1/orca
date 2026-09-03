// BUG-03 (bug-ledger.json): the real three-tier membership model (Known
// Projects >= Active Fleet >= Work Set) was only ever explained in prose
// on MembershipPanel.tsx (the single-project detail page) -- BulkActionBar.
// tsx, the primary place an operator actually discovers and acts on
// membership from the Projects list, showed only the bare words "Active
// Fleet"/"Work Set" with no explanation. Single source of truth for this
// copy, reused by both, so it can never read differently on one surface
// than the other.
export const ACTIVE_FLEET_EXPLANATION = 'TSF actively manages/monitors this project.'
export const WORK_SET_EXPLANATION = 'TSF may dispatch new work for this project.'
// The real cascade domain/portfolio.mjs's setActiveFleet enforces
// (removing Active Fleet membership also removes Work Set membership,
// since Work Set is a subset of Active Fleet) -- previously never
// surfaced anywhere a bulk removal actually happens.
export const ACTIVE_FLEET_REMOVAL_CASCADE_NOTE =
  'Removing from Active Fleet also removes from the Work Set (Work Set requires Active Fleet membership).'

// Pure so it's actually testable -- which of the projects a bulk
// Remove-from-Active-Fleet action actually applied to were also in the
// Work Set beforehand, and therefore silently lost that membership too as
// a real side effect (domain/portfolio.mjs's setActiveFleet invariant).
export function cascadedFromWorkSet(applied: string[], workSetBefore: string[]): string[] {
  return applied.filter((id) => workSetBefore.includes(id))
}

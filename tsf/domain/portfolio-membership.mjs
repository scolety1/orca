// Bulk-safe Active Fleet / Work Set membership changes (Operator UX pass,
// project multi-select). Pure planning logic -- no I/O, no state mutation;
// the caller (server/portfolio-membership-http-routes.mjs) applies the
// plan via the existing, unchanged domain/portfolio.mjs setActiveFleet/
// setWorkSet. Selecting multiple projects must never raise anyone's
// authority: each project's own classification-based gating
// (portfolioGatingForClassification) is checked independently, and an
// ineligible project is skipped with an explained reason rather than
// blocking -- or silently widening the rule for -- the rest of the batch.
import { portfolioGatingForClassification } from './onboarding.mjs'

const FIELD_LABEL = { activeFleet: 'Active Fleet', workSet: 'Work Set' }

// `classificationsById` and `portfolio` are read-only snapshots the caller
// already has (the live project map, and opState.portfolio). Returns
// { nextIds, applied, skipped } -- `nextIds` is the full desired
// membership list ready to hand to setActiveFleet/setWorkSet unchanged;
// `skipped` entries always carry a human-readable reason.
export function planBulkMembershipChange({
  portfolio,
  classificationsById,
  projectIds,
  field,
  add
}) {
  const currentIds = field === 'activeFleet' ? portfolio.activeFleet : portfolio.workSet
  const applied = []
  const skipped = []

  for (const projectId of projectIds) {
    if (!portfolio.projects[projectId]) {
      skipped.push({
        projectId,
        reason: 'Not a known (onboarded) project -- nothing to change.'
      })
      continue
    }
    if (!add) {
      // Removal never needs classification gating -- reducing membership
      // never raises authority. Removing from Active Fleet also removes
      // from Work Set (setActiveFleet's own existing invariant handles
      // that automatically).
      applied.push(projectId)
      continue
    }
    const classification = classificationsById[projectId] ?? null
    const gating = classification ? portfolioGatingForClassification(classification) : null
    if (!gating || !gating[field].allowed) {
      skipped.push({
        projectId,
        reason: classification
          ? `${FIELD_LABEL[field]} is not allowed for a ${classification.replace(/_/g, ' ')} project.`
          : `${FIELD_LABEL[field]} needs a completed onboarding analysis first.`
      })
      continue
    }
    // Work Set add is single-field: it never implicitly adds to Active
    // Fleet too, even in the same bulk request -- the bulk action bar
    // exposes these as two separate buttons, and Work Set must be added
    // second, deliberately, to an already-Active-Fleet project.
    if (field === 'workSet' && !portfolio.activeFleet.includes(projectId)) {
      skipped.push({
        projectId,
        reason:
          'Work Set requires Active Fleet membership first -- add to Active Fleet, then Work Set.'
      })
      continue
    }
    applied.push(projectId)
  }

  const nextIds = add
    ? [...new Set([...currentIds, ...applied])]
    : currentIds.filter((id) => !applied.includes(id))

  return { nextIds, applied, skipped }
}

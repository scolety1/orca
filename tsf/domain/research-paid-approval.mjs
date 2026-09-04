// Mission-scoped, explicit-owner-granted authority to spend on ONE named
// paid research provider, up to ONE named ceiling. Built for the Command
// <-> Research bridge (Phase 3): Command may create/inspect/continue
// ResearchMissions and dispatch free-path work under normal mission
// authority, but must never itself decide a paid provider call is
// authorized -- that authority is granted here, explicitly, by an owner's
// own chat instruction ("use Exa for this up to $50"), never inferred.
//
// REUSE_DIRECTLY, not a parallel mechanism: a grant is simply a
// ResearchMission needsYou entry (research-mission.mjs's existing,
// already-durable, already-revisioned Needs You array) created ALREADY
// RESOLVED with category PAID_PROVIDER_APPROVAL_REQUIRED. A Command-
// initiated *request* for paid research (the owner never asked, but
// Command judges it would help) is an ordinary OPEN entry in the same
// category. Both read through the exact one array, so "what's still open"
// and "what was granted" can never silently disagree.
//
// Scoping is structural, not policy: a grant lives inside ONE mission's
// own needsYou array (never a global/env-level flag) and is matched by
// providerId at read time (activeResearchPaidApproval), so it can never
// leak to a different mission or a different provider than the one named
// at grant time. There is no "remaining budget" counter to keep in sync --
// dispatchResearchNodeDurable's own costGovernance gate
// (authorizeMeteredExecution) already projects cost against the REAL
// cumulative request count for that provider on that mission every time
// it's called, so passing the SAME originally-granted maxSpendUsd on every
// dispatch attempt already self-limits total spend under one grant without
// this module tracking spend separately.
import { deepClone } from './canonical.mjs'
import { raiseResearchNeedsYou, resolveResearchNeedsYou } from './research-mission.mjs'

export const PAID_APPROVAL_CATEGORY = 'PAID_PROVIDER_APPROVAL_REQUIRED'

function isPositiveFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

// Explicit owner action ONLY. Callers must never invoke this from an
// inference/heuristic path ("Command guesses the owner would want this") --
// only from a chat message that itself names a provider and a spend
// ceiling, i.e. the owner's own words. requestResearchPaidApproval below is
// the correct call when Command is the one proposing paid research.
export function grantResearchPaidApproval(
  mission,
  { providerId, maxSpendUsd, scope = null, expiresAt = null, grantedBy },
  clock,
  expectedRevision
) {
  if (!providerId) throw new Error('a providerId is required to grant a paid research approval')
  if (!isPositiveFiniteNumber(maxSpendUsd)) {
    throw new Error('a positive maxSpendUsd is required to grant a paid research approval')
  }
  if (!grantedBy) throw new Error('grantedBy is required to grant a paid research approval')
  let next = raiseResearchNeedsYou(
    mission,
    {
      question: `Paid research approved: ${providerId}, up to $${maxSpendUsd}${scope ? ` for ${scope}` : ''}.`,
      category: PAID_APPROVAL_CATEGORY
    },
    clock,
    expectedRevision
  )
  const entryId = next.needsYou.at(-1).id
  // A GRANT is never left open -- resolved in the same logical action that
  // raised it, reusing resolveResearchNeedsYou's own real "close it out,
  // return to ACTIVE if nothing else is open" transition rather than a
  // second, hand-rolled close path.
  next = resolveResearchNeedsYou(
    next,
    entryId,
    { approved: true, providerId, maxSpendUsd, scope, expiresAt, grantedBy, grantedAt: next.updatedAt },
    clock,
    next.revision
  )
  return next
}

// Command's OWN initiative -- "paid research could help" -- surfaces a
// scoped, unresolved ask for the owner to see (per the Needs You surface
// every other escalation in this codebase already uses), never a grant.
export function requestResearchPaidApproval(
  mission,
  { providerId, scope = null, estimatedSpendUsd = null, recommendedCeilingUsd = null, expectedBenefit = null },
  clock,
  expectedRevision
) {
  if (!providerId) throw new Error('a providerId is required to request a paid research approval')
  const estimate = estimatedSpendUsd == null ? 'unknown' : `$${estimatedSpendUsd}`
  const ceiling = recommendedCeilingUsd == null ? '' : `, recommend a ceiling of $${recommendedCeilingUsd}`
  const benefit = expectedBenefit ?? 'not specified'
  return raiseResearchNeedsYou(
    mission,
    {
      question: `Paid research could help: ${providerId} for ${scope ?? 'this mission'} -- estimated ${estimate}${ceiling}. Expected benefit: ${benefit}. Reply naming a provider and a spend ceiling to approve (e.g. "use ${providerId} up to $N"); left unresolved, no paid dispatch happens.`,
      category: PAID_APPROVAL_CATEGORY
    },
    clock,
    expectedRevision
  )
}

// The read side dispatchResearchNodeDurable's caller must consult before
// ever passing a non-null costGovernance for a paid provider. Returns the
// most recent still-valid grant's resolution (deep-cloned) or null -- null
// means "no dispatch," full stop, never a fallback default ceiling.
export function activeResearchPaidApproval(mission, providerId, clock) {
  const now = clock ? clock() : new Date()
  const grants = mission.needsYou.filter(
    (n) =>
      n.category === PAID_APPROVAL_CATEGORY &&
      n.resolution?.approved === true &&
      n.resolution?.providerId === providerId
  )
  const usable = grants.filter((n) => !n.resolution.expiresAt || new Date(n.resolution.expiresAt) > now)
  if (usable.length === 0) return null
  // Most recent grant wins -- a re-approval with a new ceiling supersedes
  // an older one for the same provider rather than the two being summed.
  return deepClone(usable.at(-1).resolution)
}

// POST /api/portfolio/active-fleet, POST /api/portfolio/work-set -- bulk
// Active Fleet / Work Set membership toggles for the Operator UX pass's
// project multi-select. Pure route glue over domain/portfolio-
// membership.mjs's planBulkMembershipChange (the actual gating logic) and
// the existing, unchanged domain/portfolio.mjs setActiveFleet/setWorkSet
// (the actual mutation) -- no new authority model.
import { planBulkMembershipChange } from '../domain/portfolio-membership.mjs'
import { setActiveFleet, setWorkSet } from '../domain/portfolio.mjs'

const FIELD_BY_ROUTE = { 'active-fleet': 'activeFleet', 'work-set': 'workSet' }

export async function handlePortfolioMembershipRoute(
  parts,
  req,
  res,
  { map, opState },
  { json, notFound, readBody, saveState }
) {
  if (parts[1] !== 'portfolio' || !(parts[2] in FIELD_BY_ROUTE)) {
    return false
  }
  if (parts.length !== 3 || req.method !== 'POST') {
    notFound(res)
    return true
  }
  const field = FIELD_BY_ROUTE[parts[2]]
  const body = await readBody(req)
  const projectIds = body.projectIds
  if (!Array.isArray(projectIds) || projectIds.length === 0) {
    json(res, 400, { ok: false, error: 'projectIds is required and must be non-empty' })
    return true
  }
  const add = body.add !== false

  const classificationsById = {}
  for (const projectId of projectIds) {
    classificationsById[projectId] =
      map.get(projectId)?.evidence?.onboarding?.migrationClassification?.classification ?? null
  }

  const { nextIds, applied, skipped } = planBulkMembershipChange({
    portfolio: opState.portfolio,
    classificationsById,
    projectIds,
    field,
    add
  })

  let nextPortfolio = opState.portfolio
  const clock = () => new Date()
  try {
    nextPortfolio =
      field === 'activeFleet'
        ? setActiveFleet(nextPortfolio, nextIds, clock)
        : setWorkSet(nextPortfolio, nextIds, clock)
  } catch (error) {
    // Defense in depth: planBulkMembershipChange's gating should already
    // prevent this, but if some other real invariant setActiveFleet/
    // setWorkSet enforces (project.eligible, INTERNAL sourceClass) still
    // rejects the plan, fail honestly rather than partially apply.
    json(res, 422, { ok: false, error: error.message })
    return true
  }

  saveState({ ...opState, portfolio: nextPortfolio })
  json(res, 200, { ok: true, field, applied, skipped, [field]: nextIds })
  return true
}

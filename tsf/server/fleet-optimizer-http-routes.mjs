// POST /api/fleet/schedule -- pure route glue over fleet-optimizer.mjs.
// Reuses each project's REAL, already-generated estimate (M8's
// projectEstimates, wbs field) rather than inventing new project data --
// a project with no estimate on file is an honest 422, never a
// fabricated WBS.
import { buildFleetSchedule } from '../domain/fleet-optimizer.mjs'
import { fetchCapacitySnapshot } from '../adapters/orca-capacity-bridge.mjs'

export async function handleFleetOptimizerRoute(
  parts,
  req,
  res,
  url,
  { opState },
  { json, notFound, readBody }
) {
  if (parts[1] !== 'fleet' || parts[2] !== 'schedule') {
    return false
  }
  if (parts.length !== 3 || req.method !== 'POST') {
    notFound(res)
    return true
  }
  const body = await readBody(req)
  const projectIds = body.projectIds
  if (!Array.isArray(projectIds) || projectIds.length === 0) {
    json(res, 400, { ok: false, error: 'projectIds is required and must be non-empty' })
    return true
  }
  const projects = []
  for (const projectId of projectIds) {
    const estimate = opState.projectEstimates?.[projectId]
    if (!estimate) {
      json(res, 422, { ok: false, error: 'NO_ESTIMATE_ON_FILE_FOR_PROJECT', detail: projectId })
      return true
    }
    projects.push({
      projectId,
      priority: body.priorities?.[projectId] ?? 1,
      wbs: estimate.wbs,
      deadlineHours: body.deadlineHours?.[projectId] ?? null
    })
  }
  const capacityResult = await fetchCapacitySnapshot()
  const capacitySnapshot = capacityResult.ok ? capacityResult.result : null
  let schedule
  try {
    schedule = buildFleetSchedule({
      projects,
      maxConcurrentWorkers: body.maxConcurrentWorkers ?? 2,
      capacitySnapshot,
      providerId: body.providerId ?? 'codex'
    })
  } catch (error) {
    json(res, 422, { ok: false, error: error.message })
    return true
  }
  json(res, 200, { ok: true, schedule })
  return true
}

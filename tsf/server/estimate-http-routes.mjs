// GET/POST /api/projects/:id/estimate route handlers, split out
// alongside project-memory-http-routes.mjs -- same reasoning (keeps
// http-server.mjs under the max-lines cap). Pure route glue over
// tsf/server/wbs-generation.mjs and tsf/domain/delivery-plan.mjs -- no
// domain logic here. Follows onboarding-http-routes.mjs's simpler
// snapshot-read/saveState pattern (a project's estimate isn't racing an
// autonomous dispatch loop).
import { generateWbs } from './wbs-generation.mjs'
import { buildDeliveryPlan } from '../domain/delivery-plan.mjs'

// Bounded, real evidence for an onboarded/known project -- the same
// fields buildProjectContextCapsule (live-planner.mjs) already extracts,
// not the raw onboarding scan (per the established "avoid dumping the
// entire onboarding scan into every planner turn" discipline).
function repoEvidenceFor(project) {
  return {
    projectId: project.id,
    displayName: project.displayName,
    purpose: project.purpose ?? project.displayName,
    missionState: project.mission.state,
    blockedReason: project.mission.blockedReason ?? null,
    healthStatus: project.health.status,
    healthFindings: (project.health.findings ?? []).map((f) => ({
      code: f.code,
      summary: f.summary
    }))
  }
}

export async function handleEstimateRoute(
  parts,
  req,
  res,
  url,
  { map, opState },
  { json, notFound, readBody, saveState }
) {
  if (parts[1] !== 'projects' || parts[3] !== 'estimate') {
    return false
  }
  const projectId = parts[2]
  const project = map.get(projectId)
  if (!project) {
    notFound(res, `unknown project: ${projectId}`)
    return true
  }

  // GET /api/projects/:id/estimate -- the last generated estimate, if
  // any. Never triggers a new live planner call.
  if (parts.length === 4 && req.method === 'GET') {
    const saved = opState.projectEstimates?.[projectId] ?? null
    json(res, 200, { ok: true, projectId, estimate: saved })
    return true
  }

  // POST /api/projects/:id/estimate
  //   { ideaBrief?, startDate, deadlineDate?, maxConcurrent?, calendarOptions? }
  // ideaBrief is optional -- if omitted, this project's own real
  // onboarding evidence grounds the WBS (repo-grounded, not preliminary).
  if (parts.length === 4 && req.method === 'POST') {
    const body = await readBody(req)
    if (!body.startDate) {
      json(res, 400, { ok: false, error: 'startDate is required' })
      return true
    }
    const wbsResult = await generateWbs({
      projectId,
      repoEvidence: body.ideaBrief ? null : repoEvidenceFor(project),
      ideaBrief: body.ideaBrief ?? null
    })
    if (!wbsResult.ok) {
      json(res, 422, { ok: false, error: wbsResult.reason, detail: wbsResult.detail })
      return true
    }
    let plan
    try {
      plan = buildDeliveryPlan({
        wbs: wbsResult.wbs,
        startDate: new Date(body.startDate),
        deadlineDate: body.deadlineDate ? new Date(body.deadlineDate) : null,
        maxConcurrent: body.maxConcurrent ?? 1,
        calendarOptions: body.calendarOptions ?? {},
        seed: body.seed ?? 1
      })
    } catch (error) {
      json(res, 422, { ok: false, error: error.message, code: error.code ?? null })
      return true
    }
    const estimate = {
      schemaVersion: 'TSF_PROJECT_ESTIMATE_RESULT_V1',
      projectId,
      preliminary: wbsResult.preliminary,
      wbs: wbsResult.wbs,
      plan,
      generatedAt: new Date().toISOString()
    }
    saveState({
      ...opState,
      projectEstimates: { ...opState.projectEstimates, [projectId]: estimate }
    })
    json(res, 200, { ok: true, projectId, estimate })
    return true
  }

  notFound(res)
  return true
}

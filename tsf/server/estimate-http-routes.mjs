// GET/POST /api/projects/:id/estimate route handlers, split out
// alongside project-memory-http-routes.mjs -- same reasoning (keeps
// http-server.mjs under the max-lines cap). Pure route glue over
// tsf/server/wbs-generation.mjs and tsf/domain/delivery-plan.mjs -- no
// domain logic here.
import { generateWbs } from './wbs-generation.mjs'
import { buildDeliveryPlan } from '../domain/delivery-plan.mjs'
import {
  applyCalibrationBias,
  buildEstimateActual,
  summarizeCalibration
} from '../domain/estimate-calibration.mjs'
import { forecastMeteredCost, forecastProviderCapacity } from '../domain/provider-forecast.mjs'
import { detectCompetingCommitments } from '../domain/competing-commitments.mjs'
import { buildClientEstimate } from '../domain/client-estimate.mjs'
import { readKeepGoingRun } from './keep-going-run-store.mjs'
import { fetchCapacitySnapshot } from '../adapters/orca-capacity-bridge.mjs'
import { loadState } from './data-store.mjs'

// The 2 real providers this program dispatches work to (keep-going-
// dispatch-loop.mjs's own default worker agent is 'codex'; 'claude' also
// participates as planner/verifier). Forecasting both, rather than
// resolving each WBS task's providerRoleHint through routing.mjs's full
// usage-mode/profile configuration, keeps this wave bounded -- Tim's own
// spec asks for "provider capacity forecast" at the estimate level, not a
// per-task routing decision.
const FORECAST_PROVIDER_IDS = ['claude', 'codex']

// Real, current capacity signal (M5, unchanged) for every known provider.
// Never throws: an unreachable/errored orca CLI degrades to a null
// snapshot, which decideCapacityAction already reports as honest UNKNOWN
// assurance rather than crashing the whole estimate.
async function buildProviderForecasts() {
  const capacityResult = await fetchCapacitySnapshot()
  const capacitySnapshot = capacityResult.ok ? capacityResult.result : null
  const providerForecast = {}
  const costForecast = {}
  for (const providerId of FORECAST_PROVIDER_IDS) {
    providerForecast[providerId] = forecastProviderCapacity({ capacitySnapshot, providerId })
    costForecast[providerId] = forecastMeteredCost({ providerId })
  }
  return { providerForecast, costForecast }
}

// Bounded, real evidence for an onboarded/known project -- the same
// fields buildProjectContextCapsule (live-planner.mjs) already extracts,
// not the raw onboarding scan (per the established "avoid dumping the
// entire onboarding scan into every planner turn" discipline).
export function repoEvidenceFor(project) {
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

  // GET /api/projects/:id/estimate/client -- acceptance item 13: the
  // client-facing quote, kept structurally separate from the internal
  // estimate (buildClientEstimate reads none of the internal-only
  // fields -- providerForecast, costForecast, calibration,
  // competingCommitments -- so there is no field this route could
  // accidentally leak even if the internal estimate object grows more
  // internal-only data later).
  if (parts.length === 5 && parts[4] === 'client' && req.method === 'GET') {
    const estimate = opState.projectEstimates?.[projectId]
    if (!estimate) {
      json(res, 422, { ok: false, error: 'NO_ESTIMATE_ON_FILE_FOR_PROJECT' })
      return true
    }
    json(res, 200, { ok: true, projectId, clientEstimate: buildClientEstimate(estimate) })
    return true
  }

  // GET /api/projects/:id/estimate/calibration -- the real historical
  // TSF_ESTIMATE_ACTUAL_V1 records for this project plus the honest,
  // sample-size-gated calibration verdict (see estimate-calibration.mjs).
  if (parts.length === 5 && parts[4] === 'calibration' && req.method === 'GET') {
    const actuals = opState.estimateActuals?.[projectId] ?? []
    json(res, 200, { ok: true, projectId, actuals, calibration: summarizeCalibration(actuals) })
    return true
  }

  // POST /api/projects/:id/estimate/actuals { runId }
  // Pairs a real, settled (COMPLETE or BLOCKED) Keep Going run against the
  // estimate on file for this project, recording one immutable
  // TSF_ESTIMATE_ACTUAL_V1. Idempotent by runId -- re-posting the same
  // settled run returns the existing record rather than duplicating it
  // (this program never rewrites a past estimate-vs-actual record).
  if (parts.length === 5 && parts[4] === 'actuals' && req.method === 'POST') {
    const body = await readBody(req)
    const run = readKeepGoingRun(projectId)
    if (!run) {
      json(res, 422, { ok: false, error: 'NO_KEEP_GOING_RUN_FOR_PROJECT' })
      return true
    }
    if (body.runId && body.runId !== run.id) {
      json(res, 422, { ok: false, error: 'RUN_ID_DOES_NOT_MATCH_CURRENT_RUN' })
      return true
    }
    if (run.state !== 'COMPLETE' && run.state !== 'BLOCKED') {
      json(res, 422, { ok: false, error: 'RUN_NOT_SETTLED', detail: run.state })
      return true
    }
    const estimate = opState.projectEstimates?.[projectId]
    if (!estimate) {
      json(res, 422, { ok: false, error: 'NO_ESTIMATE_ON_FILE_FOR_PROJECT' })
      return true
    }
    const existingActuals = opState.estimateActuals?.[projectId] ?? []
    const already = existingActuals.find((a) => a.runId === run.id)
    if (already) {
      json(res, 200, { ok: true, projectId, actual: already, alreadyRecorded: true })
      return true
    }
    const actual = buildEstimateActual({ estimate, run })
    // Re-read fresh right before saving -- opState was captured once at
    // the top of this request, before readBody's own await. A blind save
    // from that stale snapshot would silently discard any OTHER field a
    // concurrent request committed in the meantime (the same class of
    // real, live-confirmed bug the chat route above was fixed for).
    const freshState = loadState()
    saveState({
      ...freshState,
      estimateActuals: {
        ...freshState.estimateActuals,
        [projectId]: [...(freshState.estimateActuals?.[projectId] ?? []), actual]
      }
    })
    json(res, 200, { ok: true, projectId, actual, alreadyRecorded: false })
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
    const { providerForecast, costForecast } = await buildProviderForecasts()
    // Real gap closed (M8 final review): calibration.mjs's own bias
    // correction was built and unit-tested in wave 10 but never actually
    // reached a live-generated estimate. Applied here, using this
    // project's own real settled-run history -- calibration stays a
    // disclosed, separate field (not silently baked into wallClockHours
    // with no visibility) precisely because applyCalibrationBias
    // deliberately does NOT recompute plan.status/plan.deadlineProbability
    // from the scaled distribution (see its own doc comment) -- so a
    // calibrated wallClockHours percentile can legitimately sit next to an
    // uncalibrated status/deadlineProbability, and callers need to be able
    // to tell that apart rather than assume full internal consistency.
    const calibration = summarizeCalibration(opState.estimateActuals?.[projectId] ?? [])
    const calibratedMonteCarlo = applyCalibrationBias(plan.estimate, calibration)
    // Acceptance item 12: disclosure-only competing-commitments check,
    // reusing the providerForecast just computed above (never a second
    // capacity read).
    const competingCommitments = detectCompetingCommitments({
      projectId,
      // opState.workSet (not opState.portfolio.workSet, a separate, still-
      // mostly-empty-by-default structure) -- the same flat Work Set field
      // live-planner.mjs's own buildProjectContextCapsule already treats
      // as the real, currently-populated signal.
      workSet: opState.workSet,
      keepGoingRuns: opState.keepGoingRuns,
      providerForecast
    })
    const estimate = {
      schemaVersion: 'TSF_PROJECT_ESTIMATE_RESULT_V1',
      projectId,
      preliminary: wbsResult.preliminary,
      wbs: wbsResult.wbs,
      plan: { ...plan, estimate: calibratedMonteCarlo },
      calibration,
      providerForecast,
      costForecast,
      competingCommitments,
      // Stored so a later GET .../estimate/client can derive the client-
      // facing delivery range without needing the original POST body
      // again -- see buildClientEstimate.
      startDate: body.startDate,
      calendarOptions: body.calendarOptions ?? {},
      generatedAt: new Date().toISOString()
    }
    // Re-read fresh right before saving -- generateWbs and
    // buildProviderForecasts both make real, potentially slow (up to
    // 180s) external calls between this request's initial opState capture
    // and this commit. A blind save from the stale snapshot would
    // silently discard any OTHER field a concurrent request committed
    // during that window (the same class of real, live-confirmed bug the
    // chat route above was fixed for).
    const freshState = loadState()
    saveState({
      ...freshState,
      projectEstimates: { ...freshState.projectEstimates, [projectId]: estimate }
    })
    json(res, 200, { ok: true, projectId, estimate })
    return true
  }

  notFound(res)
  return true
}

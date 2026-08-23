// GET/POST /api/health-repair/* route handlers -- TSF Health Repair Center
// V1. Pure route glue over server/health-repair.mjs and
// domain/health-repair.mjs; see health-repair.mjs's own header for the
// product rule (never cosmetically green) this whole feature exists to
// enforce. "Recheck" deliberately reuses the existing
// POST /api/onboarding/refresh route rather than duplicating it here.
import {
  scanFleetHealth,
  runBaselineVerification,
  repairProject,
  prepareRepairMission
} from './health-repair.mjs'
import {
  diagnoseProjectHealth,
  overallRepairClass,
  isReadyForWork
} from '../domain/health-repair.mjs'

function recordFor(opState, projectId) {
  return opState.onboardedProjects?.[projectId] ?? null
}

// Merges one repair action's real result back into the stored analysis,
// shaped per action -- never a blind whole-object overwrite, since most
// actions only legitimately touch one sub-tree of the analysis.
function mergeRepairResult(priorAnalysis, repairResult) {
  switch (repairResult.action) {
    case 'REFRESH_ORCA_REGISTRATION':
      return { ...priorAnalysis, orcaRegistration: repairResult.orcaRegistration }
    case 'RESOLVE_HANDOFF_USE_LIVE_REPO':
      if (!repairResult.ok) {
        return priorAnalysis
      }
      return {
        ...priorAnalysis,
        migrationClassification: repairResult.result.migrationClassification,
        portfolioGating: repairResult.result.portfolioGating,
        handoffReconciliation: repairResult.result.handoffReconciliation,
        health: repairResult.result.health
      }
    case 'INSTALL_DEPENDENCIES':
      if (!repairResult.ok) {
        return priorAnalysis
      }
      return {
        ...priorAnalysis,
        discovery: {
          ...priorAnalysis.discovery,
          commandGuidance: {
            ...priorAnalysis.discovery.commandGuidance,
            dependenciesInstalled: true
          }
        }
      }
    case 'REFRESH_ANALYSIS':
      if (!repairResult.ok) {
        return priorAnalysis
      }
      return { ...repairResult.analysis, projectId: priorAnalysis.projectId }
    default:
      return priorAnalysis
  }
}

function diagnoseRecord(opState, projectId, record) {
  const portfolio = opState.portfolio ?? { activeFleet: [], workSet: [] }
  const membership = {
    activeFleet: (portfolio.activeFleet ?? []).includes(projectId),
    workSet: (portfolio.workSet ?? []).includes(projectId)
  }
  const causes = diagnoseProjectHealth({ analysis: record.lastAnalysis, membership })
  return { causes, repairClass: overallRepairClass(causes), readyForWork: isReadyForWork(causes) }
}

// Returns true and writes the response if this request matched a Health
// Repair route; returns false (writes nothing) otherwise.
export async function handleHealthRepairRoute(
  parts,
  req,
  res,
  { opState },
  { json, notFound, readBody, saveState }
) {
  if (parts[1] !== 'health-repair') {
    return false
  }

  // GET /api/health-repair/scan -- read-only fleet-wide diagnosis over
  // already-stored analyses. Never runs a command or touches Orca/a repo.
  if (parts[2] === 'scan' && req.method === 'GET') {
    json(res, 200, { ok: true, projects: scanFleetHealth(opState) })
    return true
  }

  // POST /api/health-repair/:projectId/baseline -- runs the real
  // typecheck/test/build/lint commands this ONE project's own discovery
  // already found, bounded, and re-diagnoses with the result. Not part of
  // /scan (too slow/invasive to run for the whole fleet unprompted).
  if (parts[3] === 'baseline' && req.method === 'POST') {
    const projectId = parts[2]
    const record = recordFor(opState, projectId)
    if (!record) {
      notFound(res, `no onboarded project: ${projectId}`)
      return true
    }
    const baseline = await runBaselineVerification(
      record.repoPath,
      record.lastAnalysis.discovery?.commandGuidance
    )
    const diagnosis = diagnoseRecord(opState, projectId, record)
    const withBaseline = diagnoseProjectHealth({
      analysis: record.lastAnalysis,
      membership: {
        activeFleet: (opState.portfolio?.activeFleet ?? []).includes(projectId),
        workSet: (opState.portfolio?.workSet ?? []).includes(projectId)
      },
      baseline
    })
    json(res, 200, {
      ok: true,
      baseline,
      causes: withBaseline,
      repairClass: overallRepairClass(withBaseline),
      readyForWork: isReadyForWork(withBaseline),
      priorCauses: diagnosis.causes
    })
    return true
  }

  // POST /api/health-repair/:projectId/repair { cause } -- carries out ONE
  // real AUTO_REPAIR_SAFE action and persists the outcome. Refuses (422)
  // for any cause not classified AUTO_REPAIR_SAFE -- this route is never
  // the path a GOVERNED_REPAIR_MISSION or TIM_REQUIRED cause goes through.
  if (parts[3] === 'repair' && req.method === 'POST') {
    const projectId = parts[2]
    const record = recordFor(opState, projectId)
    if (!record) {
      notFound(res, `no onboarded project: ${projectId}`)
      return true
    }
    const body = await readBody(req)
    const causeCode = String(body.cause ?? '')
    const diagnosis = diagnoseRecord(opState, projectId, record)
    const target = diagnosis.causes.find((c) => c.cause === causeCode)
    if (!target) {
      json(res, 422, {
        ok: false,
        error: `${causeCode} is not a real cause currently diagnosed for this project`
      })
      return true
    }
    if (target.repairClass !== 'AUTO_REPAIR_SAFE') {
      json(res, 422, {
        ok: false,
        error: `${causeCode} is classified ${target.repairClass}, not AUTO_REPAIR_SAFE`
      })
      return true
    }
    const repairResult = await repairProject({
      repoPath: record.repoPath,
      cause: causeCode,
      packageManager: record.lastAnalysis.discovery?.commandGuidance?.packageManager,
      handoffTextExcerpt: record.lastAnalysis.handoffTextExcerpt
    })
    const mergedAnalysis = mergeRepairResult(record.lastAnalysis, repairResult)
    const onboardedProjects = {
      ...opState.onboardedProjects,
      [projectId]: {
        ...record,
        lastAnalysis: mergedAnalysis,
        refreshedAt: new Date().toISOString()
      }
    }
    saveState({ ...opState, onboardedProjects })
    const after = diagnoseProjectHealth({
      analysis: mergedAnalysis,
      membership: {
        activeFleet: (opState.portfolio?.activeFleet ?? []).includes(projectId),
        workSet: (opState.portfolio?.workSet ?? []).includes(projectId)
      }
    })
    json(res, 200, {
      ok: repairResult.ok,
      repairResult,
      causesBefore: diagnosis.causes,
      causesAfter: after,
      readyForWork: isReadyForWork(after)
    })
    return true
  }

  // POST /api/health-repair/:projectId/prepare-mission { cause } -- builds
  // a real mission spec for a GOVERNED_REPAIR_MISSION cause. Read-only:
  // returns the spec, does not dispatch a worker or create a worktree.
  if (parts[3] === 'prepare-mission' && req.method === 'POST') {
    const projectId = parts[2]
    const record = recordFor(opState, projectId)
    if (!record) {
      notFound(res, `no onboarded project: ${projectId}`)
      return true
    }
    const body = await readBody(req)
    const causeCode = String(body.cause ?? '')
    const diagnosis = diagnoseRecord(opState, projectId, record)
    const target = diagnosis.causes.find((c) => c.cause === causeCode)
    if (!target) {
      json(res, 422, {
        ok: false,
        error: `${causeCode} is not a real cause currently diagnosed for this project`
      })
      return true
    }
    if (target.repairClass !== 'GOVERNED_REPAIR_MISSION') {
      json(res, 422, {
        ok: false,
        error: `${causeCode} is classified ${target.repairClass}, not GOVERNED_REPAIR_MISSION`
      })
      return true
    }
    const spec = prepareRepairMission({
      displayName: record.lastAnalysis.displayName,
      repoPath: record.repoPath,
      cause: target
    })
    json(res, 200, { ok: true, spec })
    return true
  }

  // POST /api/health-repair/repair-selected { projectIds: [...] } -- the
  // fleet-level "Prepare Projects for Work" action: applies every
  // AUTO_REPAIR_SAFE cause found for each selected project, in sequence.
  // One project's failure never stops another's -- each result is
  // reported independently.
  if (parts[2] === 'repair-selected' && req.method === 'POST') {
    const body = await readBody(req)
    const projectIds = Array.isArray(body.projectIds) ? body.projectIds : []
    const results = []
    let currentState = opState
    for (const projectId of projectIds) {
      const record = recordFor(currentState, projectId)
      if (!record) {
        results.push({ projectId, ok: false, error: 'not an onboarded project' })
        continue
      }
      const diagnosis = diagnoseRecord(currentState, projectId, record)
      const autoRepairable = diagnosis.causes.filter((c) => c.repairClass === 'AUTO_REPAIR_SAFE')
      let analysis = record.lastAnalysis
      const actionsTaken = []
      // Sequential by design, not parallel: one repair action at a time
      // across the fleet, matching the same "one heavy worker at a time"
      // posture already used for real dispatch.
      for (const cause of autoRepairable) {
        const repairResult = await repairProject({
          repoPath: record.repoPath,
          cause: cause.cause,
          packageManager: analysis.discovery?.commandGuidance?.packageManager,
          handoffTextExcerpt: analysis.handoffTextExcerpt
        })
        analysis = mergeRepairResult(analysis, repairResult)
        actionsTaken.push({ cause: cause.cause, ok: repairResult.ok, action: repairResult.action })
      }
      const onboardedProjects = {
        ...currentState.onboardedProjects,
        [projectId]: { ...record, lastAnalysis: analysis, refreshedAt: new Date().toISOString() }
      }
      currentState = { ...currentState, onboardedProjects }
      const after = diagnoseProjectHealth({
        analysis,
        membership: {
          activeFleet: (currentState.portfolio?.activeFleet ?? []).includes(projectId),
          workSet: (currentState.portfolio?.workSet ?? []).includes(projectId)
        }
      })
      results.push({
        projectId,
        ok: true,
        actionsTaken,
        readyForWork: isReadyForWork(after),
        remainingCauses: after
      })
    }
    if (projectIds.length) {
      saveState(currentState)
    }
    json(res, 200, { ok: true, results })
    return true
  }

  return false
}

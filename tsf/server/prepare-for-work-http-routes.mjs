// POST /api/projects/prepare-for-work { projectIds } -- the Operator UX
// pass's composed "Prepare Projects for Work" action (spec section 4).
// Pure route glue composing already-adopted, already-tested primitives in
// sequence, per project: live repo re-scan/reconciliation refresh
// (onboarding.mjs's analyzeRepository, the same one POST
// /api/onboarding/refresh already uses) -> Health diagnosis -> baseline
// discovery (health-repair.mjs's runBaselineVerification, the same one
// POST /:projectId/baseline already uses) -> re-diagnosis -> safe Health
// repair for every AUTO_REPAIR_SAFE cause (health-repair.mjs's
// repairProject, the same one POST /repair-selected already uses) -> final
// re-diagnosis -> recomputed work eligibility. No new orchestration logic
// beyond sequencing -- everything it calls already exists, is already
// independently reviewed, and keeps its own existing tests.
//
// Same bulk-safety posture as /repair-selected: one project's failure
// never stops another's, each project's real progress is persisted
// incrementally (not batched), and a project with any TIM_REQUIRED cause
// on record gets no autonomous action at all -- diagnosed and reported
// honestly, never silently skipped without explanation.
import { analyzeRepository } from './onboarding.mjs'
import { runBaselineVerification, repairProject } from './health-repair.mjs'
import {
  diagnoseProjectHealth,
  overallRepairClass,
  isReadyForWork
} from '../domain/health-repair.mjs'

function membershipFor(opState, projectId) {
  const portfolio = opState.portfolio ?? { activeFleet: [], workSet: [] }
  return {
    activeFleet: (portfolio.activeFleet ?? []).includes(projectId),
    workSet: (portfolio.workSet ?? []).includes(projectId)
  }
}

function mergeAfterAutoRepair(priorAnalysis, repairResult) {
  switch (repairResult.action) {
    case 'REFRESH_ORCA_REGISTRATION':
      return { ...priorAnalysis, orcaRegistration: repairResult.orcaRegistration }
    case 'RESOLVE_HANDOFF_USE_LIVE_REPO':
      return repairResult.ok
        ? {
            ...priorAnalysis,
            migrationClassification: repairResult.result.migrationClassification,
            portfolioGating: repairResult.result.portfolioGating,
            handoffReconciliation: repairResult.result.handoffReconciliation,
            health: repairResult.result.health
          }
        : priorAnalysis
    case 'INSTALL_DEPENDENCIES':
      return repairResult.ok
        ? {
            ...priorAnalysis,
            discovery: {
              ...priorAnalysis.discovery,
              commandGuidance: {
                ...priorAnalysis.discovery.commandGuidance,
                dependenciesInstalled: true
              }
            }
          }
        : priorAnalysis
    case 'REFRESH_ANALYSIS':
      return repairResult.ok
        ? { ...repairResult.analysis, projectId: priorAnalysis.projectId }
        : priorAnalysis
    default:
      return priorAnalysis
  }
}

export async function handlePrepareForWorkRoute(
  parts,
  req,
  res,
  { opState },
  { json, notFound, readBody, saveState }
) {
  if (parts[1] !== 'projects' || parts[2] !== 'prepare-for-work') {
    return false
  }
  if (parts.length !== 3 || req.method !== 'POST') {
    notFound(res)
    return true
  }
  const body = await readBody(req)
  const projectIds = Array.isArray(body.projectIds) ? body.projectIds : []
  if (projectIds.length === 0) {
    json(res, 400, { ok: false, error: 'projectIds is required and must be non-empty' })
    return true
  }

  const results = []
  let currentState = opState

  for (const projectId of projectIds) {
    const stages = []
    try {
      const record = currentState.onboardedProjects?.[projectId]
      if (!record) {
        results.push({ projectId, ok: false, error: 'not an onboarded project', stages })
        continue
      }

      // Stage 1: live repo re-scan / reconciliation refresh -- the same
      // real call POST /api/onboarding/refresh already makes.
      const fresh = await analyzeRepository({ repoPath: record.repoPath, handoffText: '' })
      let analysis = fresh.ok
        ? { ...fresh, projectId: record.lastAnalysis.projectId }
        : record.lastAnalysis
      stages.push({ stage: 'REFRESH', ok: fresh.ok, detail: fresh.ok ? undefined : fresh.reason })
      if (fresh.ok) {
        currentState = {
          ...currentState,
          onboardedProjects: {
            ...currentState.onboardedProjects,
            [projectId]: {
              ...record,
              lastAnalysis: analysis,
              refreshedAt: new Date().toISOString()
            }
          }
        }
        saveState(currentState)
      }

      let diagnosis = diagnoseProjectHealth({
        analysis,
        membership: membershipFor(currentState, projectId)
      })
      let repairClass = overallRepairClass(diagnosis)
      if (repairClass === 'TIM_REQUIRED') {
        results.push({
          projectId,
          ok: false,
          error: 'TIM_REQUIRED cause on record -- skipped, no autonomous action taken',
          stages,
          causes: diagnosis,
          readyForWork: false
        })
        continue
      }

      // Stage 2: baseline discovery -- the same real call POST
      // /:projectId/baseline already makes. Skipped only if the record
      // still doesn't have discovery/commandGuidance (an honestly earlier
      // stage failure), never silently faked.
      if (analysis.discovery?.commandGuidance) {
        const baseline = await runBaselineVerification(
          record.repoPath,
          analysis.discovery.commandGuidance
        )
        stages.push({ stage: 'BASELINE', ok: true, baseline })
        diagnosis = diagnoseProjectHealth({
          analysis,
          membership: membershipFor(currentState, projectId),
          baseline
        })
        repairClass = overallRepairClass(diagnosis)
        if (repairClass === 'TIM_REQUIRED') {
          results.push({
            projectId,
            ok: false,
            error: 'TIM_REQUIRED cause found from real baseline evidence -- skipped',
            stages,
            causes: diagnosis,
            readyForWork: false
          })
          continue
        }
      } else {
        stages.push({ stage: 'BASELINE', ok: false, detail: 'no command guidance on record yet' })
      }

      // Stage 3: safe Health repair -- every AUTO_REPAIR_SAFE cause found,
      // the same real action POST /repair-selected already makes.
      const autoRepairable = diagnosis.filter((c) => c.repairClass === 'AUTO_REPAIR_SAFE')
      const actionsTaken = []
      for (const cause of autoRepairable) {
        const repairResult = await repairProject({
          repoPath: record.repoPath,
          cause: cause.cause,
          packageManager: analysis.discovery?.commandGuidance?.packageManager,
          handoffTextExcerpt: analysis.handoffTextExcerpt
        })
        analysis = mergeAfterAutoRepair(analysis, repairResult)
        actionsTaken.push({ cause: cause.cause, ok: repairResult.ok, action: repairResult.action })
      }
      stages.push({ stage: 'AUTO_REPAIR', ok: true, actionsTaken })
      currentState = {
        ...currentState,
        onboardedProjects: {
          ...currentState.onboardedProjects,
          [projectId]: {
            ...currentState.onboardedProjects[projectId],
            lastAnalysis: analysis,
            refreshedAt: new Date().toISOString()
          }
        }
      }
      saveState(currentState)

      // Stage 4: recompute work eligibility, honestly, from everything
      // just gathered -- never cosmetically green (Governed missions still
      // need Tim's explicit authorization elsewhere; this never invents one).
      const after = diagnoseProjectHealth({
        analysis,
        membership: membershipFor(currentState, projectId)
      })
      results.push({
        projectId,
        ok: true,
        stages,
        causesAfter: after,
        repairClass: overallRepairClass(after),
        readyForWork: isReadyForWork(after)
      })
    } catch (error) {
      results.push({ projectId, ok: false, error: error.message, stages })
    }
  }

  json(res, 200, { ok: true, results })
  return true
}

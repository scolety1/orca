// POST /api/projects/prepare-for-work { projectIds } -- the Operator UX
// pass's composed "Prepare Projects for Work" action (spec section 4).
//
// URGENT V1 LIVE-USE DEFECT FIX: this used to run the entire pipeline
// below synchronously inside one HTTP request/response, for every selected
// project in a single loop, with no operation identity and no overall
// bound. A real bulk attempt (WorldForge + NWR) ran ~9m45s and outlived
// the TSF desktop host's own process lifetime; the host restarted, the
// browser's one long-lived fetch died with "Failed to fetch," and every
// bit of progress past each project's first stage -- which existed only
// in that request handler's local variables -- was silently lost, with no
// way to tell what had actually happened or resume it.
//
// Fix: POST now creates a durable TSF_PREPARE_FOR_WORK_OPERATION_V1 record
// (domain/prepare-for-work-operation.mjs), persists it, and returns the
// operation ID immediately -- the real pipeline work (still the exact same
// steps, same order, same per-project bulk-safety posture: one project's
// failure never stops another's) then runs detached from that request,
// updating the operation's per-project phase as it goes via
// prepare-for-work-store.mjs's locked compare-and-swap. GET .../:id polls
// it. On server startup, any operation still RUNNING belongs to a previous
// process instance that died mid-operation -- it's marked INTERRUPTED and
// automatically reacquired under the same operation ID, redoing only the
// unsettled projects (every stage here -- a live re-scan, a registration
// check, baseline verification, AUTO_REPAIR_SAFE actions -- is independently
// idempotent by its own classification, so redoing an unsettled project
// from the top duplicates no real, already-settled work). No new
// scheduler: this is the same status-enum-plus-incremental-persistence
// pattern keep-going.mjs already uses, sized to Prepare for Work's own
// simpler linear pipeline.
import { analyzeRepository } from './onboarding.mjs'
import { runBaselineVerification, repairProject } from './health-repair.mjs'
import {
  diagnoseProjectHealth,
  overallRepairClass,
  isReadyForWork
} from '../domain/health-repair.mjs'
import { getStateFilePath, loadState, saveState } from './data-store.mjs'
import { withFileLock } from './cross-process-file-lock.mjs'
import {
  newOperationId,
  readPrepareForWorkOperation,
  listPrepareForWorkOperations,
  withPrepareForWorkOperation
} from './prepare-for-work-store.mjs'
import {
  createPrepareForWorkOperation,
  withProjectPhase,
  withProjectResult,
  isOperationSettled,
  finalizeOperation,
  markInterrupted,
  unsettledProjectIds
} from '../domain/prepare-for-work-operation.mjs'

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

// Independent review finding (real, confirmed): this used to be an
// unlocked loadState()/saveState() read-modify-write, same as most other
// routes in this codebase -- fine while Prepare for Work was one blocking
// request per operator action, but this fix makes overlapping prepare-
// for-work operations for DIFFERENT projects routine (POST returns
// instantly; a startup recovery scan can also fire several reacquired
// pipelines at once), and prepare-for-work-store.mjs's own locked writes
// carry forward whatever onboardedProjects snapshot THEY last read -- an
// unlocked write racing between two locked ones could get silently
// reverted. Sharing prepare-for-work-store.mjs's exact lock path here
// serializes every write this fix's own pipeline makes (operation-
// tracking AND onboardedProjects) against each other; it does not close
// the same pre-existing unlocked-write gap in OTHER routes (onboarding,
// health-repair, etc.) -- documented, out of scope, same posture keep-
// going-run-store.mjs's own header already takes for that broader gap.
async function saveAnalysis(projectId, analysis) {
  await withFileLock(`${getStateFilePath()}.lock`, undefined, () => {
    const state = loadState()
    const record = state.onboardedProjects?.[projectId]
    if (!record) {
      return
    }
    saveState({
      ...state,
      onboardedProjects: {
        ...state.onboardedProjects,
        [projectId]: { ...record, lastAnalysis: analysis, refreshedAt: new Date().toISOString() }
      }
    })
  })
}

function registeringOrcaCause(cause) {
  return cause === 'ORCA_NOT_REGISTERED' || cause === 'ORCA_TEMPORARILY_UNAVAILABLE'
}

async function setPhase(operationId, projectId, phase) {
  await withPrepareForWorkOperation(operationId, (op) => withProjectPhase(op, projectId, phase))
}

// Runs the exact same steps the original synchronous handler ran for one
// project -- unchanged behavior, now interleaved with durable phase
// updates instead of living only in this function's local variables.
async function runOneProject(operationId, projectId) {
  const stages = []
  // Real V1 stabilization finding, reproduced against WorldForge and NWR's
  // real repos: the final diagnose below used to omit `baseline` entirely,
  // so a real, currently-observed TESTS_FAILING/LINT_FAILING/etc. cause
  // never reached the operation's own causesAfter/readyForWork -- a
  // project with real, known-failing tests could still read
  // READY_FOR_WORK. Hoisted so Stage 4's final diagnose can honestly
  // reflect the same real evidence Stage 2 gathered (baseline verification
  // itself is not re-run after AUTO_REPAIR -- there is no baseline-re-run
  // action in this pipeline -- so this is the last real evidence there is).
  let baseline = null
  try {
    const record = loadState().onboardedProjects?.[projectId]
    if (!record) {
      return { projectId, ok: false, error: 'not an onboarded project', stages }
    }

    // Stage 1: live repo re-scan / reconciliation refresh.
    await setPhase(operationId, projectId, 'RECONCILING')
    const fresh = await analyzeRepository({ repoPath: record.repoPath, handoffText: '' })
    let analysis = fresh.ok
      ? { ...fresh, projectId: record.lastAnalysis.projectId }
      : record.lastAnalysis
    stages.push({ stage: 'REFRESH', ok: fresh.ok, detail: fresh.ok ? undefined : fresh.reason })
    if (fresh.ok) {
      await saveAnalysis(projectId, analysis)
    }

    await setPhase(operationId, projectId, 'DIAGNOSING_HEALTH')
    let diagnosis = diagnoseProjectHealth({
      analysis,
      membership: membershipFor(loadState(), projectId)
    })
    let repairClass = overallRepairClass(diagnosis)
    if (repairClass === 'TIM_REQUIRED') {
      return {
        projectId,
        ok: false,
        error: 'TIM_REQUIRED cause on record -- skipped, no autonomous action taken',
        stages,
        causes: diagnosis,
        readyForWork: false
      }
    }

    // Stage 2: baseline discovery.
    if (analysis.discovery?.commandGuidance) {
      await setPhase(operationId, projectId, 'RUNNING_BASELINE')
      baseline = await runBaselineVerification(record.repoPath, analysis.discovery.commandGuidance)
      stages.push({ stage: 'BASELINE', ok: true, baseline })
      await setPhase(operationId, projectId, 'DIAGNOSING_HEALTH')
      diagnosis = diagnoseProjectHealth({
        analysis,
        membership: membershipFor(loadState(), projectId),
        baseline
      })
      repairClass = overallRepairClass(diagnosis)
      if (repairClass === 'TIM_REQUIRED') {
        return {
          projectId,
          ok: false,
          error: 'TIM_REQUIRED cause found from real baseline evidence -- skipped',
          stages,
          causes: diagnosis,
          readyForWork: false
        }
      }
    } else {
      stages.push({ stage: 'BASELINE', ok: false, detail: 'no command guidance on record yet' })
    }

    // Stage 3: safe Health repair, one AUTO_REPAIR_SAFE cause at a time.
    const autoRepairable = diagnosis.filter((c) => c.repairClass === 'AUTO_REPAIR_SAFE')
    const actionsTaken = []
    for (const cause of autoRepairable) {
      await setPhase(
        operationId,
        projectId,
        registeringOrcaCause(cause.cause) ? 'REGISTERING_ORCA' : 'REPAIRING_SAFE_CAUSES'
      )
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
    await saveAnalysis(projectId, analysis)

    // Stage 4: recompute work eligibility, honestly -- baseline included,
    // so a real, still-unresolved test/build/lint/typecheck failure is
    // never silently dropped from the final result (see the comment at
    // this function's top for the real incident this closes).
    await setPhase(operationId, projectId, 'VERIFYING')
    const after = diagnoseProjectHealth({
      analysis,
      membership: membershipFor(loadState(), projectId),
      baseline
    })
    return {
      projectId,
      ok: true,
      stages,
      causesAfter: after,
      repairClass: overallRepairClass(after),
      readyForWork: isReadyForWork(after)
    }
  } catch (error) {
    return { projectId, ok: false, error: error.message, stages }
  }
}

// Best-effort duplicate-work guard: if another still-RUNNING operation
// already owns this project (an overlapping bulk request, not caught by
// the exact-set dedup at POST time below), skip running the pipeline again
// for it here rather than racing two live-planner/repair invocations
// against the same repo. This check-then-act has a small race window (two
// operations could both pass it before either marks the project settled),
// accepted as best-effort layered on top of the POST-time exact-match
// short-circuit, which is the fully deterministic guarantee.
function findOtherRunningOwner(operationId, projectId) {
  const other = listPrepareForWorkOperations().find(
    (op) =>
      op.operationId !== operationId &&
      op.status === 'RUNNING' &&
      op.results[projectId] &&
      !op.results[projectId].settled
  )
  return other?.operationId ?? null
}

// The durable job's actual body -- runs detached from any one HTTP
// request. Processes unsettled projects sequentially (same order/bulk-
// safety semantics as the original synchronous loop); each project's
// result is persisted the instant it settles, so a crash partway through
// only ever loses the ONE project currently mid-pipeline, not the whole
// operation, and that project is exactly what recovery redoes.
export async function runPrepareForWorkOperation(operationId) {
  const operation = readPrepareForWorkOperation(operationId)
  if (!operation) {
    return
  }
  for (const projectId of unsettledProjectIds(operation)) {
    const owner = findOtherRunningOwner(operationId, projectId)
    const result = owner
      ? { projectId, ok: false, error: `already in progress under operation ${owner}`, stages: [] }
      : await runOneProject(operationId, projectId)
    await withPrepareForWorkOperation(operationId, (op) => withProjectResult(op, projectId, result))
  }
  await withPrepareForWorkOperation(operationId, (op) =>
    isOperationSettled(op) ? finalizeOperation(op) : op
  )
}

// Fire-and-forget entry point: never lets the background pipeline's own
// rejection become an unhandled rejection that could crash the process --
// a failure belongs in the operation's own per-project error field, not in
// a process-level crash.
export function runPrepareForWorkOperationSafely(operationId) {
  runPrepareForWorkOperation(operationId).catch((error) => {
    console.error(`prepare-for-work operation ${operationId} crashed:`, error)
  })
}

// Startup recovery: call once, early, from the real server's own startup
// path (see startStandaloneServer in http-server.mjs). Any operation still
// RUNNING when this process starts belongs to a previous instance that
// died mid-operation -- a synchronous-per-project, single-process pipeline
// has no other way to leave one RUNNING across a restart. Reacquires each
// one under its own original operation ID; no new operation, no duplicate
// ID, no lost operator-visible history.
export async function recoverInterruptedPrepareForWorkOperations() {
  const running = listPrepareForWorkOperations().filter((op) => op.status === 'RUNNING')
  for (const operation of running) {
    await withPrepareForWorkOperation(operation.operationId, (op) => markInterrupted(op))
    await withPrepareForWorkOperation(operation.operationId, (op) => ({ ...op, status: 'RUNNING' }))
    runPrepareForWorkOperationSafely(operation.operationId)
  }
  return running.map((op) => op.operationId)
}

export async function handlePrepareForWorkRoute(
  parts,
  req,
  res,
  _ctx,
  { json, notFound, readBody }
) {
  // GET /api/prepare-for-work-operations -- list recent operations, so a UI
  // reconnecting after a desktop restart can rediscover what's still
  // running without having remembered an operation ID itself. Deliberately
  // its own top-level path rather than nested under /projects/* -- the
  // existing GET /api/projects/:id route unconditionally claims any other
  // 3-segment /api/projects/* GET (a real collision found while testing
  // this fix: /api/projects/prepare-for-work with no ID was silently
  // swallowed by that route as a 404 "unknown project" lookup).
  if (parts[1] === 'prepare-for-work-operations' && parts.length === 2 && req.method === 'GET') {
    const operations = listPrepareForWorkOperations()
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 20)
    json(res, 200, { ok: true, operations })
    return true
  }

  if (parts[1] !== 'projects' || parts[2] !== 'prepare-for-work') {
    return false
  }

  // GET /api/projects/prepare-for-work/:operationId -- poll one operation.
  if (parts.length === 4 && req.method === 'GET') {
    const operation = readPrepareForWorkOperation(parts[3])
    if (!operation) {
      notFound(res, `unknown operation: ${parts[3]}`)
      return true
    }
    json(res, 200, { ok: true, operation })
    return true
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

  // Idempotent retry: an exact repeat of a still-running bulk request (the
  // real-world case -- the operator retries after the UI appeared to lose
  // track of it) reattaches to the same operation instead of starting a
  // second pipeline over the same projects.
  const exactMatch = listPrepareForWorkOperations().find(
    (op) =>
      op.status === 'RUNNING' &&
      op.projectIds.length === projectIds.length &&
      op.projectIds.every((id) => projectIds.includes(id))
  )
  if (exactMatch) {
    json(res, 200, {
      ok: true,
      operationId: exactMatch.operationId,
      operation: exactMatch,
      reused: true
    })
    return true
  }

  const operationId = newOperationId()
  const operation = createPrepareForWorkOperation(operationId, projectIds)
  await withPrepareForWorkOperation(operationId, () => operation)
  // Not awaited: the pipeline continues independently of this response --
  // the entire point of this fix. See runPrepareForWorkOperationSafely.
  runPrepareForWorkOperationSafely(operationId)
  json(res, 202, { ok: true, operationId, operation })
  return true
}

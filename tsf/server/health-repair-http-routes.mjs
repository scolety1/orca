// GET/POST /api/health-repair/* route handlers -- TSF Health Repair Center
// V1. Pure route glue over server/health-repair.mjs and
// domain/health-repair.mjs; see health-repair.mjs's own header for the
// product rule (never cosmetically green) this whole feature exists to
// enforce. "Recheck" deliberately reuses the existing
// POST /api/onboarding/refresh route rather than duplicating it here.
//
// BUG-05 (bug-ledger.json): baseline/repair/repair-selected used to run
// entirely inside one synchronous HTTP request -- real, individually-
// bounded-but-collectively-unbounded work (baseline alone can run ~2min
// per test/build/lint/typecheck category; repair-selected loops every
// AUTO_REPAIR_SAFE cause for every selected project, sequentially) tracked
// only in the calling React component's own useState. Navigating away
// mid-operation didn't cancel the real server-side work, but it did lose
// every way for the operator to see it: the response was delivered to an
// already-unmounted component and silently dropped. Same real defect
// class Prepare for Work was rebuilt to fix (domain/prepare-for-work-
// operation.mjs's own header) -- these three routes now create a durable
// TSF_HEALTH_REPAIR_OPERATION_V1 record (domain/health-repair-
// operation.mjs) and return the operation id immediately (202); the real
// work (unchanged: same functions, same order, same bulk-safety posture)
// runs detached, persisting phase/result as it goes via health-repair-
// store.mjs's locked compare-and-swap. GET routes below poll/list.
// /scan (already fast, read-only) and /prepare-mission (fast, synchronous
// -- prepareRepairMission does no I/O) are deliberately left as direct
// synchronous responses; only the genuinely slow, async actions
// (runBaselineVerification/repairProject) get the durable treatment.
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
import { getStateFilePath, loadState, saveState } from './data-store.mjs'
import { withFileLock } from './cross-process-file-lock.mjs'
import {
  newHealthRepairOperationId,
  readHealthRepairOperation,
  listHealthRepairOperations,
  withHealthRepairOperation
} from './health-repair-store.mjs'
import {
  createHealthRepairOperation,
  withProjectPhase,
  withProjectResult,
  isOperationSettled,
  finalizeOperation,
  markInterrupted,
  unsettledProjectIds
} from '../domain/health-repair-operation.mjs'

function recordFor(opState, projectId) {
  return opState.onboardedProjects?.[projectId] ?? null
}

function membershipFor(opState, projectId) {
  const portfolio = opState.portfolio ?? { activeFleet: [], workSet: [] }
  return {
    activeFleet: (portfolio.activeFleet ?? []).includes(projectId),
    workSet: (portfolio.workSet ?? []).includes(projectId)
  }
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

// Same locked-write posture, and the exact same shared lock file, as
// prepare-for-work-http-routes.mjs's own saveAnalysis -- now that these
// operations run detached and can genuinely overlap (two operations for
// different projects, or a startup recovery scan firing alongside a fresh
// operator action), an unlocked read-modify-write here could silently
// revert a concurrent locked write, same reasoning as that file's own
// comment. Uses withFileLock directly (not withHealthRepairOperation,
// which is scoped to one real operation record, not a general-purpose
// onboardedProjects write) -- mirrors prepare-for-work-http-routes.mjs's
// own saveAnalysis exactly.
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

function diagnoseRecord(opState, projectId, record) {
  const causes = diagnoseProjectHealth({ analysis: record.lastAnalysis, membership: membershipFor(opState, projectId) })
  return { causes, repairClass: overallRepairClass(causes), readyForWork: isReadyForWork(causes) }
}

async function setPhase(operationId, projectId, phase) {
  await withHealthRepairOperation(operationId, (op) => withProjectPhase(op, projectId, phase))
}

// The real background work for one BASELINE operation's one project --
// exactly the prior synchronous route body, now interleaved with durable
// phase updates.
async function runBaselineForProject(operationId, projectId) {
  await setPhase(operationId, projectId, 'RUNNING')
  const state = loadState()
  const record = recordFor(state, projectId)
  if (!record) {
    return { ok: false, error: 'not an onboarded project' }
  }
  const diagnosis = diagnoseRecord(state, projectId, record)
  if (diagnosis.repairClass === 'TIM_REQUIRED') {
    return {
      ok: false,
      error: 'This project has a TIM_REQUIRED cause on record -- no commands are run against it without Tim.'
    }
  }
  const baseline = await runBaselineVerification(record.repoPath, record.lastAnalysis.discovery?.commandGuidance)
  const withBaseline = diagnoseProjectHealth({
    analysis: record.lastAnalysis,
    membership: membershipFor(state, projectId),
    baseline
  })
  return {
    ok: true,
    baseline,
    causes: withBaseline,
    repairClass: overallRepairClass(withBaseline),
    readyForWork: isReadyForWork(withBaseline),
    priorCauses: diagnosis.causes
  }
}

// The real background work for one REPAIR operation's one project --
// exactly the prior synchronous route body's post-validation half (the
// TIM_REQUIRED/cause/repairClass checks already ran synchronously before
// the operation was even created, at POST time -- see the route below).
async function runRepairForProject(operationId, projectId, causeCode) {
  await setPhase(operationId, projectId, 'RUNNING')
  const state = loadState()
  const record = recordFor(state, projectId)
  // causesBefore was part of the original synchronous response -- preserved
  // here rather than silently dropped.
  const causesBefore = diagnoseRecord(state, projectId, record).causes
  const repairResult = await repairProject({
    repoPath: record.repoPath,
    cause: causeCode,
    packageManager: record.lastAnalysis.discovery?.commandGuidance?.packageManager,
    handoffTextExcerpt: record.lastAnalysis.handoffTextExcerpt
  })
  const mergedAnalysis = mergeRepairResult(record.lastAnalysis, repairResult)
  await saveAnalysis(projectId, mergedAnalysis)
  const after = diagnoseProjectHealth({ analysis: mergedAnalysis, membership: membershipFor(loadState(), projectId) })
  return {
    ok: repairResult.ok,
    repairResult,
    causesBefore,
    causesAfter: after,
    readyForWork: isReadyForWork(after)
  }
}

// The real background work for one REPAIR_SELECTED operation's one
// project -- exactly the prior synchronous route body's per-project loop
// iteration, unchanged bulk-safety posture (one project's failure never
// stops another's; each project's completed repairs are persisted before
// the operation moves on).
async function runRepairSelectedForProject(operationId, projectId) {
  await setPhase(operationId, projectId, 'RUNNING')
  const state = loadState()
  const record = recordFor(state, projectId)
  if (!record) {
    return { ok: false, error: 'not an onboarded project' }
  }
  const diagnosis = diagnoseRecord(state, projectId, record)
  if (diagnosis.repairClass === 'TIM_REQUIRED') {
    return { ok: false, error: 'TIM_REQUIRED cause on record -- skipped, no autonomous repair taken' }
  }
  const autoRepairable = diagnosis.causes.filter((c) => c.repairClass === 'AUTO_REPAIR_SAFE')
  let analysis = record.lastAnalysis
  const actionsTaken = []
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
  await saveAnalysis(projectId, analysis)
  const after = diagnoseProjectHealth({ analysis, membership: membershipFor(loadState(), projectId) })
  return { ok: true, actionsTaken, readyForWork: isReadyForWork(after), remainingCauses: after }
}

const RUNNERS = {
  BASELINE: (operationId, projectId, meta) => runBaselineForProject(operationId, projectId, meta),
  REPAIR: (operationId, projectId, meta) => runRepairForProject(operationId, projectId, meta.cause),
  REPAIR_SELECTED: (operationId, projectId) => runRepairSelectedForProject(operationId, projectId)
}

// Runs the durable job's actual body, detached from any one HTTP request.
// Same "persist the instant each project settles" posture as Prepare for
// Work's own runPrepareForWorkOperation -- a crash partway through only
// ever loses the ONE project currently mid-run, not the whole operation,
// and that project is exactly what recovery redoes (every real health-
// repair action is independently safe to re-run from the top).
export async function runHealthRepairOperation(operationId) {
  const operation = readHealthRepairOperation(operationId)
  if (!operation) {
    return
  }
  const runOne = RUNNERS[operation.kind]
  for (const projectId of unsettledProjectIds(operation)) {
    // Independent-review finding, preserved from the original synchronous
    // /repair-selected route: a real exception on one project (a malformed
    // repoPath, a real crash deep in the repair call chain) must neither
    // discard an earlier project's already-persisted repair nor skip a
    // later project -- each project is wrapped independently, same
    // bulk-safety posture as before, now generalized to every operation
    // kind rather than re-implemented per route.
    let result
    try {
      result = await runOne(operationId, projectId, operation.meta)
    } catch (error) {
      result = { ok: false, error: error.message }
    }
    await withHealthRepairOperation(operationId, (op) => withProjectResult(op, projectId, result))
  }
  await withHealthRepairOperation(operationId, (op) => (isOperationSettled(op) ? finalizeOperation(op) : op))
}

export function runHealthRepairOperationSafely(operationId) {
  runHealthRepairOperation(operationId).catch((error) => {
    console.error(`health repair operation ${operationId} crashed:`, error)
  })
}

// Startup recovery: same reasoning as recoverInterruptedPrepareForWorkOperations
// -- any operation still RUNNING when this process starts belongs to a
// previous instance that died mid-operation; reacquire it under its own
// original id.
export async function recoverInterruptedHealthRepairOperations() {
  const running = listHealthRepairOperations().filter((op) => op.status === 'RUNNING')
  for (const operation of running) {
    await withHealthRepairOperation(operation.operationId, (op) => markInterrupted(op))
    await withHealthRepairOperation(operation.operationId, (op) => ({ ...op, status: 'RUNNING' }))
    runHealthRepairOperationSafely(operation.operationId)
  }
  return running.map((op) => op.operationId)
}

// Returns true and writes the response if this request matched a Health
// Repair route; returns false (writes nothing) otherwise. `saveState` is
// accepted (matching every other route handler's injected-dependency
// signature, for call-site consistency in http-server.mjs) but unused here
// -- saveAnalysis above uses data-store.mjs's own saveState directly under
// its own file lock, same as prepare-for-work-http-routes.mjs's identical
// saveAnalysis.
export async function handleHealthRepairRoute(
  parts,
  req,
  res,
  { opState },
  { json, notFound, readBody }
) {
  // GET /api/health-repair-operations -- list recent operations (top-level
  // sibling path, not nested under /api/health-repair/*, matching Prepare
  // for Work's own /api/prepare-for-work-operations -- a project id could
  // otherwise collide with a reserved path segment nested one level in).
  if (parts[1] === 'health-repair-operations' && parts.length === 2 && req.method === 'GET') {
    const operations = listHealthRepairOperations()
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 20)
    json(res, 200, { ok: true, operations })
    return true
  }
  if (parts[1] === 'health-repair-operations' && parts.length === 3 && req.method === 'GET') {
    const operation = readHealthRepairOperation(parts[2])
    if (!operation) {
      notFound(res, `unknown operation: ${parts[2]}`)
      return true
    }
    json(res, 200, { ok: true, operation })
    return true
  }

  if (parts[1] !== 'health-repair') {
    return false
  }

  // GET /api/health-repair/scan -- read-only fleet-wide diagnosis over
  // already-stored analyses. Never runs a command or touches Orca/a repo.
  if (parts[2] === 'scan' && req.method === 'GET') {
    json(res, 200, { ok: true, projects: scanFleetHealth(opState) })
    return true
  }

  // POST /api/health-repair/:projectId/baseline -- validates synchronously
  // (the TIM_REQUIRED gate must reject before anything is ever spawned,
  // same as before), then creates a durable operation and returns
  // immediately instead of blocking on the real command run.
  if (parts[3] === 'baseline' && req.method === 'POST') {
    const projectId = parts[2]
    const record = recordFor(opState, projectId)
    if (!record) {
      notFound(res, `no onboarded project: ${projectId}`)
      return true
    }
    const diagnosis = diagnoseRecord(opState, projectId, record)
    if (diagnosis.repairClass === 'TIM_REQUIRED') {
      json(res, 422, {
        ok: false,
        error: 'This project has a TIM_REQUIRED cause on record -- no commands are run against it without Tim.'
      })
      return true
    }
    const operationId = newHealthRepairOperationId()
    const operation = createHealthRepairOperation(operationId, 'BASELINE', [projectId])
    await withHealthRepairOperation(operationId, () => operation)
    runHealthRepairOperationSafely(operationId)
    json(res, 202, { ok: true, operationId, operation })
    return true
  }

  // POST /api/health-repair/:projectId/repair { cause } -- same synchronous
  // gates as before (TIM_REQUIRED, real cause, AUTO_REPAIR_SAFE only),
  // then a durable operation for the real repair action.
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
    if (diagnosis.repairClass === 'TIM_REQUIRED') {
      json(res, 422, {
        ok: false,
        error: 'This project has a TIM_REQUIRED cause on record -- no autonomous repair action is taken on it, even for an otherwise-safe cause.'
      })
      return true
    }
    const target = diagnosis.causes.find((c) => c.cause === causeCode)
    if (!target) {
      json(res, 422, { ok: false, error: `${causeCode} is not a real cause currently diagnosed for this project` })
      return true
    }
    if (target.repairClass !== 'AUTO_REPAIR_SAFE') {
      json(res, 422, { ok: false, error: `${causeCode} is classified ${target.repairClass}, not AUTO_REPAIR_SAFE` })
      return true
    }
    const operationId = newHealthRepairOperationId()
    const operation = createHealthRepairOperation(operationId, 'REPAIR', [projectId], { cause: causeCode })
    await withHealthRepairOperation(operationId, () => operation)
    runHealthRepairOperationSafely(operationId)
    json(res, 202, { ok: true, operationId, operation })
    return true
  }

  // POST /api/health-repair/:projectId/prepare-mission { cause } -- left
  // synchronous: prepareRepairMission does no I/O (confirmed: not async,
  // no await) -- it cannot outlive a request, so wrapping it in a durable
  // operation would add ceremony with no real benefit.
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
      json(res, 422, { ok: false, error: `${causeCode} is not a real cause currently diagnosed for this project` })
      return true
    }
    if (target.repairClass !== 'GOVERNED_REPAIR_MISSION') {
      json(res, 422, { ok: false, error: `${causeCode} is classified ${target.repairClass}, not GOVERNED_REPAIR_MISSION` })
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
  // fleet-level "Prepare Projects for Work" action. Same idempotent-retry
  // reattachment as Prepare for Work's own POST handler: an exact repeat
  // of a still-running request reattaches instead of starting a second
  // pipeline over the same projects.
  if (parts[2] === 'repair-selected' && req.method === 'POST') {
    const body = await readBody(req)
    const projectIds = Array.isArray(body.projectIds) ? body.projectIds : []
    if (projectIds.length === 0) {
      json(res, 400, { ok: false, error: 'projectIds is required and must be non-empty' })
      return true
    }
    const exactMatch = listHealthRepairOperations().find(
      (op) =>
        op.kind === 'REPAIR_SELECTED' &&
        op.status === 'RUNNING' &&
        op.projectIds.length === projectIds.length &&
        op.projectIds.every((id) => projectIds.includes(id))
    )
    if (exactMatch) {
      json(res, 200, { ok: true, operationId: exactMatch.operationId, operation: exactMatch, reused: true })
      return true
    }
    const operationId = newHealthRepairOperationId()
    const operation = createHealthRepairOperation(operationId, 'REPAIR_SELECTED', projectIds)
    await withHealthRepairOperation(operationId, () => operation)
    runHealthRepairOperationSafely(operationId)
    json(res, 202, { ok: true, operationId, operation })
    return true
  }

  return false
}

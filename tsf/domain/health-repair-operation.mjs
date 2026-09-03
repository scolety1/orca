// BUG-05 (bug-ledger.json): Health Repair Center's own actions (baseline
// check, one repair, prepare-mission, repair-selected) had NO durable
// operation concept at all -- each was one long-lived synchronous HTTP
// request tracked only in the calling React component's own useState, lost
// the instant the operator navigated away before it resolved. This is the
// same real defect class Prepare for Work was rebuilt to fix (see
// domain/prepare-for-work-operation.mjs's own header for that incident) --
// same pattern, deliberately a SEPARATE, structurally-mirrored module
// rather than a shared/generalized one: Prepare for Work is already a
// real, live, independently-reviewed feature, and this mission's own
// "smallest correct mechanism, no new scheduler" discipline favors zero
// blast radius on that working code over DRY-ing the two together.
//
// Health Repair's real actions are simpler than Prepare for Work's own
// multi-stage pipeline (RECONCILING -> ... -> READY_FOR_WORK) -- each is
// closer to "one real action, per project, that either succeeds, fails, or
// needs Tim" -- so the phase set is smaller. `kind` distinguishes which of
// the 4 real actions this operation represents; `meta` carries the one
// extra input some kinds need (the cause code for REPAIR/PREPARE_MISSION)
// so the background runner doesn't need it re-supplied.
export const HEALTH_REPAIR_OPERATION_KINDS = Object.freeze([
  'BASELINE',
  'REPAIR',
  'PREPARE_MISSION',
  'REPAIR_SELECTED'
])

// No real "CANCELLED" primitive exists anywhere in health-repair.mjs
// (confirmed: no cancel/abort code path) -- NEEDS_YOU substitutes for it
// in the sense the mission driver's own suggested vocabulary intended
// ("queued/running/succeeded/failed/cancelled or the closest existing
// TSF-compatible model"): a real, already-established TSF outcome
// (TIM_REQUIRED-driven halt) that this codebase already uses identically
// in prepare-for-work-operation.mjs, never a fabricated CANCELLED state
// with no real trigger behind it.
export const HEALTH_REPAIR_PHASES = Object.freeze(['QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'NEEDS_YOU'])
const TERMINAL_PHASES = new Set(['SUCCEEDED', 'FAILED', 'NEEDS_YOU'])

export function isTerminalPhase(phase) {
  return TERMINAL_PHASES.has(phase)
}

export function createHealthRepairOperation(
  operationId,
  kind,
  projectIds,
  meta = {},
  clock = () => new Date()
) {
  if (!HEALTH_REPAIR_OPERATION_KINDS.includes(kind)) {
    throw new Error(`unknown health repair operation kind: ${kind}`)
  }
  const now = clock().toISOString()
  const results = {}
  for (const projectId of projectIds) {
    results[projectId] = { phase: 'QUEUED', settled: false }
  }
  return {
    schemaVersion: 'TSF_HEALTH_REPAIR_OPERATION_V1',
    operationId,
    kind,
    projectIds,
    meta,
    status: 'RUNNING',
    createdAt: now,
    updatedAt: now,
    results
  }
}

// Advances one project's phase without settling it -- lets a poller (or a
// reacquiring restarted server) see exactly where a still-running project
// is, same reasoning as prepare-for-work-operation.mjs's own
// withProjectPhase.
export function withProjectPhase(operation, projectId, phase, clock = () => new Date()) {
  return {
    ...operation,
    updatedAt: clock().toISOString(),
    results: {
      ...operation.results,
      [projectId]: { ...operation.results[projectId], phase, settled: false }
    }
  }
}

// Derives the terminal phase from a real health-repair.mjs/domain/
// health-repair.mjs result -- every one of the 4 real actions already
// returns an { ok, error? } (or ok-implied) shape; never fabricates a
// success phase for a result that didn't actually report one.
function terminalPhaseFor(result) {
  if (result.ok === false) {
    return String(result.error ?? '').includes('TIM_REQUIRED') ? 'NEEDS_YOU' : 'FAILED'
  }
  return 'SUCCEEDED'
}

export function withProjectResult(operation, projectId, result, clock = () => new Date()) {
  const phase = terminalPhaseFor(result)
  return {
    ...operation,
    updatedAt: clock().toISOString(),
    results: {
      ...operation.results,
      [projectId]: { ...result, phase, settled: true }
    }
  }
}

export function isOperationSettled(operation) {
  return operation.projectIds.every((id) => operation.results[id]?.settled)
}

export function finalizeOperation(operation, clock = () => new Date()) {
  return { ...operation, status: 'COMPLETED', updatedAt: clock().toISOString() }
}

// Startup recovery: any operation still RUNNING when this process starts
// belongs to a previous process instance that died -- a synchronous,
// single-process runner has nothing else that could leave it RUNNING
// across a restart. Same reasoning as prepare-for-work-operation.mjs's own
// markInterrupted.
export function markInterrupted(operation, clock = () => new Date()) {
  return { ...operation, status: 'INTERRUPTED', updatedAt: clock().toISOString() }
}

// Every real health-repair action (baseline check, one AUTO_REPAIR_SAFE
// cause, a mission-spec prepare) is independently safe to re-run from the
// top -- none of them have a partial-completion state of their own to
// resume from mid-way -- so, like Prepare for Work, resumption just redoes
// the unsettled project(s) rather than tracking a second, finer-grained
// checkpoint.
export function unsettledProjectIds(operation) {
  return operation.projectIds.filter((id) => !operation.results[id]?.settled)
}

// V1 live-use defect fix: Prepare for Work used to be one synchronous HTTP
// request chaining multiple real, individually-bounded-but-collectively-
// unbounded operations (a live-planner re-scan, baseline verification, and
// N health repairs, per project, for every selected project) with no
// operation identity and no request-level bound. A real ~9m45s attempt
// outlived the TSF desktop host's own process lifetime; when the host
// restarted, the in-flight work -- which existed only in that request
// handler's local variables -- was silently lost, and the operator had to
// start over with no record of what had already happened.
//
// This is the pure, persisted record of one Prepare-for-Work operation --
// the same pattern keep-going.mjs already uses for overnight runs (a
// status enum + incremental progress persisted independently of any one
// request), sized down for Prepare for Work's own simpler, linear,
// per-project pipeline. No new scheduler: the server still runs the exact
// same pipeline steps in the exact same order, just persists which phase
// each project is in as it goes, under an operation ID the UI can poll and
// the server can reacquire after its own restart.
export const PREPARE_FOR_WORK_PHASES = Object.freeze([
  'RECONCILING',
  'REGISTERING_ORCA',
  'DISCOVERING_BASELINE',
  'RUNNING_BASELINE',
  'DIAGNOSING_HEALTH',
  'REPAIRING_SAFE_CAUSES',
  'VERIFYING',
  'READY_FOR_WORK',
  'NEEDS_YOU',
  'BLOCKED',
  'FAILED'
])

const TERMINAL_PHASES = new Set(['READY_FOR_WORK', 'NEEDS_YOU', 'BLOCKED', 'FAILED'])

export function isTerminalPhase(phase) {
  return TERMINAL_PHASES.has(phase)
}

export function createPrepareForWorkOperation(operationId, projectIds, clock = () => new Date()) {
  const now = clock().toISOString()
  const results = {}
  for (const projectId of projectIds) {
    results[projectId] = { phase: 'RECONCILING', settled: false }
  }
  return {
    schemaVersion: 'TSF_PREPARE_FOR_WORK_OPERATION_V1',
    operationId,
    projectIds,
    status: 'RUNNING',
    createdAt: now,
    updatedAt: now,
    results
  }
}

// Advances one project's phase without settling it -- called before each
// pipeline stage so a poller (or a reacquiring restarted server) can see
// exactly where a still-running project is.
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

// Records a project's final outcome (the same per-project result shape the
// route already produced pre-fix: ok/stages/causesAfter/repairClass/
// readyForWork/error) and derives its terminal phase from it, honestly --
// never a cosmetic READY_FOR_WORK.
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

// Real acceptance-matrix finding (a genuine DIRTY_PRESERVE project, real
// uncommitted work on record), generalized per independent review: the
// health taxonomy has THREE distinct NOT_A_DEFECT causes (DIRTY_PRESERVE,
// PAUSED_BY_DESIGN, UNKNOWN -- domain/health-repair.mjs), not just one --
// isReadyForWork/overallRepairClass treat all of them as "not a defect to
// repair" from a pure health standpoint, so result.readyForWork can be
// honestly true even though an operator should look before acting. The
// UI's own classifyProjectLifecycle (ui/src/lib/project-lifecycle.ts) has
// this same class of override for its own paused/dirty buckets; this phase
// field is a new, more prominent surface for the same underlying
// readyForWork signal, so it needs the same correction -- checked
// generically (every remaining cause is NOT_A_DEFECT, and there is at
// least one) rather than by name, so a future NOT_A_DEFECT cause added to
// the taxonomy is covered without this file needing to change too. A
// genuinely empty causesAfter (zero issues at all) is vacuously "every"
// and must still legitimately be READY_FOR_WORK -- the length check
// guards that.
function terminalPhaseFor(result) {
  if (!result.ok) {
    return result.error?.includes('TIM_REQUIRED') ? 'NEEDS_YOU' : 'FAILED'
  }
  if (
    result.causesAfter?.length > 0 &&
    result.causesAfter.every((c) => c.repairClass === 'NOT_A_DEFECT')
  ) {
    return 'NEEDS_YOU'
  }
  return result.readyForWork ? 'READY_FOR_WORK' : 'BLOCKED'
}

export function isOperationSettled(operation) {
  return operation.projectIds.every((id) => operation.results[id]?.settled)
}

// Called once every project has settled -- flips the operation itself to
// COMPLETED so a poller/reacquiring server can stop treating it as live.
export function finalizeOperation(operation, clock = () => new Date()) {
  return { ...operation, status: 'COMPLETED', updatedAt: clock().toISOString() }
}

// Startup recovery: any operation still RUNNING when this process starts
// belongs to a previous process instance that died (a synchronous,
// single-process pipeline has nothing else that could leave it RUNNING
// across a restart) -- mark it INTERRUPTED so a caller can decide to
// re-acquire it, and honestly distinguish "genuinely still going" from
// "orphaned by a crash" for anything that reads it before recovery kicks
// in.
export function markInterrupted(operation, clock = () => new Date()) {
  return { ...operation, status: 'INTERRUPTED', updatedAt: clock().toISOString() }
}

// True once a project has a persisted, unsettled phase from a previous
// process instance -- the exact set of work a resumed run needs to redo.
// Every stage in the real pipeline is safe to repeat (a live re-scan, a
// registration check, baseline verification, and AUTO_REPAIR_SAFE actions
// are each independently idempotent by their own classification), so
// resumption re-runs the unsettled project from the top rather than
// tracking per-stage checkpoints -- the smallest correct model, not a
// second scheduler.
export function unsettledProjectIds(operation) {
  return operation.projectIds.filter((id) => !operation.results[id]?.settled)
}

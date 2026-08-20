// Keep Going / Overnight V1 governance layer (Milestone 2). Pure domain
// logic only — no process/CLI/filesystem calls here. Execution itself is
// Orca's native orchestration graph (`orchestration run/task/dispatch/
// worker/gate`, `automations`); this module holds the immutable goal, gap
// analysis, conflict-aware wave planning, retry/stall budgets, and the
// run-level pause/resume/Needs-You/checkpoint state machine that governs
// it. See docs/tsf/M2_KEEP_GOING_DESIGN_V1.md for the mapping to Orca CLI
// primitives. This is a distinct state machine at the overnight-Run level
// (ACTIVE/NEEDS_YOU/PAUSED/STALLED/COMPLETE/BLOCKED), one level above
// tsf/domain/mission-state.mjs + coordinator.mjs's per-wave Mission
// lifecycle (DRAFT/PLANNING/READY/ACTIVE/REVIEW/...) -- it does not import
// or literally compose that module today; the design doc's "one Mission
// per wave" language describes the intended future wiring for the
// autonomous wave-dispatch loop (not yet built), not code that exists now.
import { assertExpectedRevision, deepClone, isoNow, sha256 } from './canonical.mjs'

export const OVERNIGHT_RUN_STATES = Object.freeze([
  'ACTIVE',
  'NEEDS_YOU',
  'PAUSED', // doubles as "Ready to Resume" — a run only ever pauses at a safe boundary
  'STALLED',
  'COMPLETE',
  'BLOCKED'
])

const RUN_ALLOWED = Object.freeze({
  ACTIVE: ['NEEDS_YOU', 'PAUSED', 'STALLED', 'COMPLETE', 'BLOCKED'],
  NEEDS_YOU: ['ACTIVE', 'PAUSED', 'BLOCKED'],
  PAUSED: ['ACTIVE', 'BLOCKED'],
  STALLED: ['ACTIVE', 'NEEDS_YOU', 'PAUSED', 'BLOCKED'],
  COMPLETE: [],
  BLOCKED: ['ACTIVE', 'PAUSED']
})

const DEFAULT_BUDGET = Object.freeze({
  maxWaves: 20,
  maxRetriesPerTask: 2,
  maxConcurrentWorkers: 2,
  stallThresholdMs: 30 * 60 * 1000
})

function freezeGoal(statement, acceptanceCriteria) {
  if (!statement?.trim()) {
    throw new Error('goal statement is required')
  }
  if (!Array.isArray(acceptanceCriteria) || acceptanceCriteria.length === 0) {
    throw new Error('at least one acceptance criterion is required')
  }
  return Object.freeze({ statement, acceptanceCriteria: Object.freeze([...acceptanceCriteria]) })
}

export function createOvernightRun(
  {
    id,
    projectId,
    originalGoal,
    acceptanceCriteria,
    usageMode,
    constraints = [],
    stopConditions = [],
    budget = {}
  },
  clock
) {
  if (!id || !projectId) {
    throw new Error('overnight run requires id and projectId')
  }
  const createdAt = isoNow(clock)
  return {
    schemaVersion: 'TSF_OVERNIGHT_RUN_V1',
    id,
    projectId,
    originalGoal: freezeGoal(originalGoal, acceptanceCriteria),
    goalHistory: [],
    usageMode,
    constraints: [...constraints],
    stopConditions: [...stopConditions],
    budget: { ...DEFAULT_BUDGET, ...budget },
    state: 'ACTIVE',
    revision: 0,
    waves: [],
    retryCounts: {},
    needsYou: [],
    checkpoints: [],
    transitions: [{ from: null, to: 'ACTIVE', reason: 'OVERNIGHT_RUN_CREATED', at: createdAt }],
    createdAt,
    updatedAt: createdAt
  }
}

// The original goal is immutable unless Tim explicitly changes it (program
// charter Section C). Any other caller is rejected outright.
export function replaceGoal(
  run,
  { statement, acceptanceCriteria },
  { authorizedBy, reason },
  clock
) {
  if (authorizedBy !== 'TIM') {
    const error = new Error('original goal can only be replaced by explicit Tim authorization')
    error.code = 'TSF_GOAL_IMMUTABLE'
    throw error
  }
  if (!reason?.trim()) {
    throw new Error('a reason is required to replace the original goal')
  }
  const next = deepClone(run)
  next.goalHistory.push({ previous: run.originalGoal, reason, at: isoNow(clock) })
  next.originalGoal = freezeGoal(statement, acceptanceCriteria)
  next.revision += 1
  next.updatedAt = isoNow(clock)
  return next
}

export function transitionRun(run, to, { reason, evidence = [], expectedRevision } = {}, clock) {
  if (!OVERNIGHT_RUN_STATES.includes(to)) {
    throw new Error(`unknown overnight run state: ${to}`)
  }
  assertExpectedRevision(run, expectedRevision)
  if (!RUN_ALLOWED[run.state]?.includes(to)) {
    const error = new Error(`invalid overnight run transition: ${run.state} -> ${to}`)
    error.code = 'TSF_INVALID_RUN_TRANSITION'
    throw error
  }
  const next = deepClone(run)
  const at = isoNow(clock)
  next.transitions.push({ from: next.state, to, reason: reason ?? 'UNSPECIFIED', evidence, at })
  next.state = to
  next.revision += 1
  next.updatedAt = at
  return next
}

// expectedRevision is optional -- omitting it (existing callers, fixtures)
// skips the check exactly like assertExpectedRevision does elsewhere in
// this codebase (mission-state.mjs, adoption.mjs). Server callers pass it
// to catch a stale read-modify-write race on the persisted run (e.g. two
// concurrent pause/resume requests for the same project).
export const pauseRun = (run, reason, clock, expectedRevision) =>
  transitionRun(run, 'PAUSED', { reason: reason ?? 'OPERATOR_PAUSE', expectedRevision }, clock)
export const resumeRun = (run, clock, expectedRevision) =>
  transitionRun(run, 'ACTIVE', { reason: 'OPERATOR_RESUME', expectedRevision }, clock)
export const completeRun = (run, clock) =>
  transitionRun(run, 'COMPLETE', { reason: 'ORIGINAL_GOAL_SATISFIED' }, clock)
export const blockRun = (run, reason, evidence, clock) =>
  transitionRun(run, 'BLOCKED', { reason, evidence }, clock)
export const markStalled = (run, stalledWorkers, clock) =>
  transitionRun(
    run,
    'STALLED',
    { reason: 'STALL_WATCHDOG_TRIGGERED', evidence: stalledWorkers.map((w) => w.dispatchId) },
    clock
  )

// A worker claiming "done" is never sufficient — verifiedSatisfied/blockers
// must come from independently-verified evidence (VERIFIER_INDEPENDENT
// results), never from a worker's own result capsule. Callers are
// responsible for that separation; this function only compares against the
// immutable goal.
export function compareStateToGoal(run, { verifiedSatisfied = [], blockers = [] } = {}, clock) {
  const allCriteria = run.originalGoal.acceptanceCriteria
  for (const criterion of verifiedSatisfied) {
    if (!allCriteria.includes(criterion)) {
      throw new Error(`criterion is not part of the original goal: ${criterion}`)
    }
  }
  const covered = new Set(verifiedSatisfied)
  const remainingGaps = allCriteria.filter((criterion) => !covered.has(criterion))
  let decision
  if (blockers.length > 0) {
    decision = 'STOP_BLOCKED'
  } else if (remainingGaps.length === 0) {
    decision = 'STOP_COMPLETE'
  } else if (run.waves.length >= run.budget.maxWaves) {
    decision = 'STOP_BUDGET_EXHAUSTED'
  } else {
    decision = 'CONTINUE'
  }
  return {
    schemaVersion: 'TSF_GAP_ANALYSIS_V1',
    runId: run.id,
    waveNumber: run.waves.length,
    satisfiedCriteria: [...covered],
    remainingGaps,
    blockers,
    decision,
    comparedAt: isoNow(clock)
  }
}

function normalizeScopePath(p) {
  return String(p).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
}

function scopeOverlaps(a, b) {
  return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`)
}

function scopesConflict(scopeA, scopeB) {
  return scopeA.some((a) =>
    scopeB.some((b) => scopeOverlaps(normalizeScopePath(a), normalizeScopePath(b)))
  )
}

// Conflict-aware wave scheduling: greedily bins candidate work items into
// parallel-safe batches capped at maxConcurrentWorkers, deferring anything
// whose declared scope overlaps an item already in the batch to a later,
// sequential batch. Two independent workers beats five workers on one
// subsystem (program charter Section F).
export function planWave(run, candidateWorkItems, clock) {
  if (!Array.isArray(candidateWorkItems) || candidateWorkItems.length === 0) {
    throw new Error('at least one candidate work item is required to plan a wave')
  }
  for (const item of candidateWorkItems) {
    if (!item.id || !Array.isArray(item.scope) || item.scope.length === 0) {
      throw new Error(`work item ${item.id ?? '(unknown)'} requires id and a non-empty scope`)
    }
  }
  const cap = Math.max(1, run.budget.maxConcurrentWorkers)
  const batches = []
  for (const item of candidateWorkItems) {
    const target = batches.find(
      (batch) =>
        batch.length < cap && !batch.some((existing) => scopesConflict(existing.scope, item.scope))
    )
    if (target) {
      target.push(item)
    } else {
      batches.push([item])
    }
  }
  const conflictNotes = []
  for (let i = 0; i < batches.length; i += 1) {
    for (const item of batches[i]) {
      for (let j = i + 1; j < batches.length; j += 1) {
        for (const later of batches[j]) {
          if (scopesConflict(item.scope, later.scope)) {
            conflictNotes.push({
              a: item.id,
              b: later.id,
              reason: 'overlapping scope — scheduled in sequential batches'
            })
          }
        }
      }
    }
  }
  return {
    schemaVersion: 'TSF_KEEP_GOING_WAVE_PLAN_V1',
    runId: run.id,
    waveNumber: run.waves.length + 1,
    batches,
    conflictNotes,
    maxConcurrentWorkers: cap,
    plannedAt: isoNow(clock)
  }
}

// Idempotent by (plan, result) digest — replaying the same settled wave
// never appends a duplicate, matching coordinator.mjs's registerWorkerResult
// pattern and the "no duplicate settled work" acceptance criterion.
export function recordWave(run, wavePlan, waveResult, clock) {
  const digest = sha256({ wavePlan, waveResult })
  if (run.waves.some((wave) => wave.digest === digest)) {
    return deepClone(run)
  }
  const next = deepClone(run)
  next.waves.push({ digest, wavePlan, waveResult, recordedAt: isoNow(clock) })
  next.updatedAt = isoNow(clock)
  return next
}

export function recordTaskAttempt(run, taskId, outcome, clock) {
  const next = deepClone(run)
  const priorCount = next.retryCounts[taskId] ?? 0
  const count = outcome === 'RETRY' ? priorCount + 1 : priorCount
  if (outcome === 'RETRY' && count > next.budget.maxRetriesPerTask) {
    const error = new Error(
      `retry budget exceeded for task ${taskId}: ${count} > ${next.budget.maxRetriesPerTask}`
    )
    error.code = 'TSF_RETRY_BUDGET_EXCEEDED'
    throw error
  }
  next.retryCounts[taskId] = count
  next.updatedAt = isoNow(clock)
  return next
}

// workerHeartbeats: [{ dispatchId, taskId, lastHeartbeatAt }] — sourced from
// `orca orchestration worker-list`/`task-list` facts, not invented here.
export function detectStall(run, workerHeartbeats, clock) {
  const now = Date.parse(isoNow(clock))
  return workerHeartbeats
    .filter((worker) => now - Date.parse(worker.lastHeartbeatAt) > run.budget.stallThresholdMs)
    .map((worker) => ({
      dispatchId: worker.dispatchId,
      taskId: worker.taskId,
      silentForMs: now - Date.parse(worker.lastHeartbeatAt)
    }))
}

export function raiseNeedsYou(run, { question, options = [], taskId = null }, clock) {
  if (!question?.trim()) {
    throw new Error('a question is required to raise Needs You')
  }
  const at = isoNow(clock)
  const next = deepClone(run)
  // Includes the insertion ordinal so two questions with identical
  // question/taskId text raised in the same clock tick (guaranteed under a
  // fixed/mocked clock, possible in production at millisecond granularity)
  // never collide into the same id -- a collision would leave the older
  // entry permanently unresolvable and the run stuck in NEEDS_YOU forever.
  next.needsYou.push({
    id: sha256({ question, taskId, at, ordinal: next.needsYou.length }),
    question,
    options,
    taskId,
    raisedAt: at,
    resolvedAt: null,
    resolution: null
  })
  // A run can already be NEEDS_YOU with other open questions — only
  // transition on the first one; RUN_ALLOWED has no NEEDS_YOU -> NEEDS_YOU
  // self-loop, and piling up questions shouldn't need one.
  if (next.state === 'NEEDS_YOU') {
    next.updatedAt = at
    return next
  }
  return transitionRun(
    next,
    'NEEDS_YOU',
    { reason: 'HUMAN_DECISION_REQUIRED', evidence: taskId ? [taskId] : [] },
    clock
  )
}

export function resolveNeedsYou(run, needsYouId, resolution, clock) {
  const index = run.needsYou.findIndex((entry) => entry.id === needsYouId)
  if (index === -1) {
    throw new Error(`unknown Needs You question: ${needsYouId}`)
  }
  const next = deepClone(run)
  next.needsYou[index] = { ...next.needsYou[index], resolvedAt: isoNow(clock), resolution }
  next.updatedAt = isoNow(clock)
  const stillOpen = next.needsYou.some((entry) => !entry.resolvedAt)
  return stillOpen
    ? next
    : transitionRun(next, 'ACTIVE', { reason: 'ALL_NEEDS_YOU_RESOLVED' }, clock)
}

// Durable, hash-chained checkpoint after each meaningful phase — the
// anti-drift anchor a resumed/rehydrated run reads before continuing.
export function checkpointRun(run, { phase, note = null, evidence = [] } = {}, clock) {
  if (!phase?.trim()) {
    throw new Error('a phase label is required to checkpoint')
  }
  const at = isoNow(clock)
  const record = { phase, note, evidence, waveCount: run.waves.length, state: run.state, at }
  const previousHash = run.checkpoints.at(-1)?.hash ?? null
  const hash = sha256({ previousHash, record })
  const next = deepClone(run)
  next.checkpoints.push({ ...record, previousHash, hash })
  next.updatedAt = at
  return next
}

export function summarizeRun(run, clock) {
  const lastCheckpoint = run.checkpoints.at(-1) ?? null
  return {
    schemaVersion: 'TSF_KEEP_GOING_SUMMARY_V1',
    runId: run.id,
    projectId: run.projectId,
    state: run.state,
    goal: run.originalGoal.statement,
    wavesCompleted: run.waves.length,
    openNeedsYou: run.needsYou
      .filter((entry) => !entry.resolvedAt)
      .map(({ id, question }) => ({ id, question })),
    lastCheckpoint,
    generatedAt: isoNow(clock)
  }
}

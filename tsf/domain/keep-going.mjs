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

// How long a claimed tick lock is honored before it is treated as
// abandoned (a crashed/hung tick that never released). Generous relative
// to the orchestration bridge's own 15s CLI timeout so a normal tick
// (a few sequential CLI round-trips) never trips it; small enough that a
// genuinely stuck tick doesn't permanently wedge the run.
export const TICK_LOCK_TIMEOUT_MS = 2 * 60 * 1000

function isTickLockActive(run, clock) {
  if (!run.tickLock) {
    return false
  }
  // timeoutMs is stored on the lock itself (set at claim time, defaulting
  // to TICK_LOCK_TIMEOUT_MS for locks that didn't specify one) so a large
  // wave's dispatch claim can request a longer allowance -- the fixed
  // default assumed a small, fast wave and could otherwise be exceeded by
  // a legitimately still-working dispatch of many sequential CLI calls,
  // wrongly treating it as abandoned.
  const timeoutMs = run.tickLock.timeoutMs ?? TICK_LOCK_TIMEOUT_MS
  return Date.parse(isoNow(clock)) - Date.parse(run.tickLock.claimedAt) <= timeoutMs
}

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
    inFlightWave: null,
    tickLock: null,
    orchestrationRunId: null,
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

export function transitionRun(
  run,
  to,
  { reason, evidence = [], expectedRevision, tickInternal = false } = {},
  clock
) {
  if (!OVERNIGHT_RUN_STATES.includes(to)) {
    throw new Error(`unknown overnight run state: ${to}`)
  }
  assertExpectedRevision(run, expectedRevision)
  // A live tick lock means an autonomous wave-dispatch tick currently owns
  // this run's dispatch/settle mutations (see claimTick/releaseTick below).
  // An external transition (operator pause/resume/etc.) while locked would
  // race the tick's own eventual commit -- reject it outright rather than
  // risk silently overwriting or being overwritten (a real, adversarially-
  // tested gap: see docs/tsf/M2_KEEP_GOING_DESIGN_V1.md's concurrency
  // hardening wave). tickInternal:true is set only by the tick's own
  // in-progress calls (markStalled, the retry-budget NEEDS_YOU escalation)
  // that are themselves part of the same commit releasing the lock -- they
  // must not be rejected by the lock they are about to clear.
  if (!tickInternal && isTickLockActive(run, clock)) {
    const error = new Error(
      `an autonomous tick (${run.tickLock.kind}) currently holds this run -- try again shortly`
    )
    error.code = 'TSF_TICK_IN_PROGRESS'
    throw error
  }
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
// tickInternal defaults false (an operator/external STALLED declaration is
// blocked while a tick holds the lock, same as pause/resume) -- the tick's
// own settleStep passes tickInternal:true since it is escalating STALLED
// as part of releasing its own lock, not racing it.
export const markStalled = (run, stalledWorkers, clock, tickInternal = false, expectedRevision) =>
  transitionRun(
    run,
    'STALLED',
    {
      reason: 'STALL_WATCHDOG_TRIGGERED',
      evidence: stalledWorkers.map((w) => w.dispatchId),
      tickInternal,
      expectedRevision
    },
    clock
  )

// Claims exclusive ownership of this run's dispatch/settle mutations for
// the duration of one tick's real Orca CLI round-trips (which can each
// take up to the orchestration bridge's own timeout). Must happen in a
// single synchronous read-check-write with the persisted store (see
// tsf/server/keep-going-run-store.mjs) -- that is what actually prevents
// two ticks from both starting real duplicate dispatch work, not this
// function alone. A stale/abandoned lock (past TICK_LOCK_TIMEOUT_MS) is
// treated as absent so a crashed tick cannot permanently wedge the run.
export function claimTick(run, kind, clock, expectedRevision, timeoutMs = TICK_LOCK_TIMEOUT_MS) {
  assertExpectedRevision(run, expectedRevision)
  if (run.state !== 'ACTIVE') {
    const error = new Error(`cannot start a tick on a run that is ${run.state}, not ACTIVE`)
    error.code = 'TSF_RUN_NOT_ACTIVE'
    throw error
  }
  if (isTickLockActive(run, clock)) {
    const error = new Error(`an autonomous tick (${run.tickLock.kind}) is already in progress`)
    error.code = 'TSF_TICK_IN_PROGRESS'
    throw error
  }
  const next = deepClone(run)
  next.tickLock = { kind, claimedAt: isoNow(clock), timeoutMs }
  next.revision += 1
  next.updatedAt = isoNow(clock)
  return next
}

// Releases a held tick lock. expectedRevision should be the revision the
// caller's own commit just produced (self-consistent, not a fresh-read
// check) -- callers combine this with their real domain mutation
// (dispatchWave/settleInFlightWave/markStalled/raiseNeedsYou) inside one
// synchronous store commit, not as a separate write.
export function releaseTick(run, clock, expectedRevision) {
  assertExpectedRevision(run, expectedRevision)
  if (!run.tickLock) {
    const error = new Error('no tick lock is held on this run')
    error.code = 'TSF_NO_TICK_LOCK_HELD'
    throw error
  }
  const next = deepClone(run)
  next.tickLock = null
  next.revision += 1
  next.updatedAt = isoNow(clock)
  return next
}

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
// expectedRevision (optional, same convention as transitionRun) is only
// checked on the real-write path -- a replayed wave (matching digest)
// returns the unchanged run before any staleness check, since a genuine
// idempotent replay needs no revision protection: it was never going to
// write regardless of what the caller believed the revision was.
export function recordWave(run, wavePlan, waveResult, clock, expectedRevision) {
  const digest = sha256({ wavePlan, waveResult })
  if (run.waves.some((wave) => wave.digest === digest)) {
    return deepClone(run)
  }
  assertExpectedRevision(run, expectedRevision)
  const next = deepClone(run)
  next.waves.push({ digest, wavePlan, waveResult, recordedAt: isoNow(clock) })
  next.revision += 1
  next.updatedAt = isoNow(clock)
  return next
}

// Records that a planned wave has been handed to real Orca workers but has
// not yet settled -- the missing link for the autonomous wave-dispatch loop
// (a UI-started run previously sat at 0 waves forever because nothing
// tracked "a wave is currently out being worked"). Does NOT append to
// run.waves yet; that only happens once settleInFlightWave records real
// outcomes, so a crash between dispatch and settle leaves the run
// re-checkable (inFlightWave still present) rather than silently losing the
// wave or double-counting it.
export function dispatchWave(run, wavePlan, dispatchRecords, clock, expectedRevision) {
  // Revision checked first, matching every other mutation in this module --
  // a stale caller must see TSF_STALE_REVISION, not TSF_WAVE_ALREADY_IN_FLIGHT
  // (a real review finding: checking the invariant first meant a stale-
  // revision caller racing an already-dispatched wave got the wrong error).
  assertExpectedRevision(run, expectedRevision)
  if (run.inFlightWave) {
    const error = new Error('a wave is already in flight for this run')
    error.code = 'TSF_WAVE_ALREADY_IN_FLIGHT'
    throw error
  }
  if (!Array.isArray(dispatchRecords) || dispatchRecords.length === 0) {
    throw new Error('at least one dispatch record is required')
  }
  const next = deepClone(run)
  next.inFlightWave = {
    wavePlan,
    dispatchRecords: [...dispatchRecords],
    dispatchedAt: isoNow(clock)
  }
  next.revision += 1
  next.updatedAt = isoNow(clock)
  return next
}

// Settles the currently in-flight wave against real task outcomes and clears
// inFlightWave. Reuses recordWave's idempotent-by-digest append inline
// (rather than calling recordWave itself) so clearing inFlightWave and
// appending the wave record share one revision bump -- clearing inFlightWave
// is always a real state change here (the wave was, by definition, still
// out), unlike recordWave's own true no-op replay case.
export function settleInFlightWave(run, waveResult, clock, expectedRevision) {
  // Revision checked first -- same reasoning as dispatchWave above.
  assertExpectedRevision(run, expectedRevision)
  if (!run.inFlightWave) {
    const error = new Error('no in-flight wave to settle')
    error.code = 'TSF_NO_IN_FLIGHT_WAVE'
    throw error
  }
  const wavePlan = run.inFlightWave.wavePlan
  const digest = sha256({ wavePlan, waveResult })
  const next = deepClone(run)
  next.inFlightWave = null
  if (!next.waves.some((wave) => wave.digest === digest)) {
    next.waves.push({ digest, wavePlan, waveResult, recordedAt: isoNow(clock) })
  }
  next.revision += 1
  next.updatedAt = isoNow(clock)
  return next
}

// Formalizes the stall recovery improvised live during the first M2 dogfood
// (see wave 18 notes): consumes retry budget per work item, escalates to
// NEEDS_YOU if exhausted (state permitting), settles the wave honestly as
// ABANDONED_STALLED (never claimed succeeded/failed), checkpoints.
export function abandonStalledWave(run, reason, clock, expectedRevision) {
  assertExpectedRevision(run, expectedRevision)
  // Tick-lock checked before the in-flight-wave requirement, matching
  // transitionRun's order -- otherwise a tick that claimed the lock but
  // hasn't dispatched yet (inFlightWave still null) would surface
  // TSF_NO_IN_FLIGHT_WAVE instead of the correct TSF_TICK_IN_PROGRESS.
  if (isTickLockActive(run, clock)) {
    const error = new Error(
      `an autonomous tick (${run.tickLock.kind}) currently holds this run -- try again shortly`
    )
    error.code = 'TSF_TICK_IN_PROGRESS'
    throw error
  }
  if (!run.inFlightWave) {
    const error = new Error('no in-flight wave to abandon')
    error.code = 'TSF_NO_IN_FLIGHT_WAVE'
    throw error
  }
  const { dispatchRecords } = run.inFlightWave
  let next = run
  // Any tickLock here is necessarily stale (an active one would already
  // have thrown above) -- clear it rather than leaving stale metadata for
  // a future truthy (not isTickLockActive-gated) reader to misinterpret.
  if (next.tickLock) {
    next = { ...next, tickLock: null }
  }
  const retryBudgetExceeded = []
  for (const record of dispatchRecords) {
    try {
      next = recordTaskAttempt(next, record.workItemId, 'RETRY', clock, next.revision)
    } catch (error) {
      if (error.code === 'TSF_RETRY_BUDGET_EXCEEDED') {
        retryBudgetExceeded.push(record.workItemId)
      } else {
        throw error
      }
    }
  }
  const waveResult = {
    schemaVersion: 'TSF_KEEP_GOING_WAVE_RESULT_V1',
    outcomes: dispatchRecords.map((record) => ({
      ...record,
      outcome: 'ABANDONED_STALLED',
      note: reason ?? null
    })),
    settledAt: isoNow(clock)
  }
  next = settleInFlightWave(next, waveResult, clock, next.revision)
  next = checkpointRun(
    next,
    {
      phase: 'STALLED_WAVE_ABANDONED',
      note: reason ?? null,
      evidence: dispatchRecords.map((r) => r.taskId)
    },
    clock
  )
  if (retryBudgetExceeded.length > 0) {
    // NEEDS_YOU is not reachable from every state (RUN_ALLOWED forbids it
    // from PAUSED/BLOCKED/COMPLETE) -- a run can end up PAUSED with a real
    // in-flight wave (pauseRun doesn't check inFlightWave). Escalating
    // unconditionally would throw TSF_INVALID_RUN_TRANSITION here and
    // discard the settlement/checkpoint already computed above, which
    // would be worse than the ad hoc recovery this function replaces.
    next = RUN_ALLOWED[next.state]?.includes('NEEDS_YOU')
      ? raiseNeedsYou(
          next,
          {
            question: `Retry budget exceeded for stalled work item(s): ${retryBudgetExceeded.join(', ')} after being abandoned and retried. How should I proceed?`,
            options: ['RETRY_ANYWAY', 'SKIP_AND_CONTINUE', 'BLOCK_RUN']
          },
          clock,
          next.revision
        )
      : checkpointRun(
          next,
          {
            phase: 'RETRY_BUDGET_EXCEEDED_ESCALATION_SKIPPED',
            note: `Retry budget exceeded for ${retryBudgetExceeded.join(', ')}, but run state ${next.state} cannot transition to NEEDS_YOU -- recorded here instead.`,
            evidence: retryBudgetExceeded
          },
          clock
        )
  }
  return next
}

export function recordTaskAttempt(run, taskId, outcome, clock, expectedRevision) {
  assertExpectedRevision(run, expectedRevision)
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
  next.revision += 1
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

// expectedRevision is checked up front (before any mutation) so both the
// transitioning and non-transitioning paths below are guarded consistently
// -- the non-transitioning "already NEEDS_YOU" path doesn't go through
// transitionRun (see comment below) and previously had no revision check
// or bump at all, an inconsistency an independent review caught.
export function raiseNeedsYou(
  run,
  { question, options = [], taskId = null },
  clock,
  expectedRevision,
  tickInternal = false
) {
  if (!question?.trim()) {
    throw new Error('a question is required to raise Needs You')
  }
  assertExpectedRevision(run, expectedRevision)
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
  // self-loop, and piling up questions shouldn't need one. This path skips
  // transitionRun, so it must bump revision itself to stay consistent with
  // every other mutation in this module.
  if (next.state === 'NEEDS_YOU') {
    next.revision += 1
    next.updatedAt = at
    return next
  }
  return transitionRun(
    next,
    'NEEDS_YOU',
    { reason: 'HUMAN_DECISION_REQUIRED', evidence: taskId ? [taskId] : [], tickInternal },
    clock
  )
}

export function resolveNeedsYou(run, needsYouId, resolution, clock, expectedRevision) {
  const index = run.needsYou.findIndex((entry) => entry.id === needsYouId)
  if (index === -1) {
    throw new Error(`unknown Needs You question: ${needsYouId}`)
  }
  assertExpectedRevision(run, expectedRevision)
  const next = deepClone(run)
  next.needsYou[index] = { ...next.needsYou[index], resolvedAt: isoNow(clock), resolution }
  next.updatedAt = isoNow(clock)
  const stillOpen = next.needsYou.some((entry) => !entry.resolvedAt)
  // Only auto-return to ACTIVE when the run's own state is NEEDS_YOU for
  // this reason -- PAUSED -> ACTIVE is also a legal transition (RUN_ALLOWED),
  // so resolving the last question on a run the operator separately paused
  // would otherwise silently un-pause it without operator intent (real
  // review finding, wave 11). Any other state just clears the answered
  // question and leaves the run's state alone.
  if (stillOpen || next.state !== 'NEEDS_YOU') {
    // Skips transitionRun (no state change), so bump revision here too.
    next.revision += 1
    return next
  }
  return transitionRun(next, 'ACTIVE', { reason: 'ALL_NEEDS_YOU_RESOLVED' }, clock)
}

// Durable, hash-chained checkpoint after each meaningful phase — the
// anti-drift anchor a resumed/rehydrated run reads before continuing.
export function checkpointRun(
  run,
  { phase, note = null, evidence = [] } = {},
  clock,
  expectedRevision
) {
  if (!phase?.trim()) {
    throw new Error('a phase label is required to checkpoint')
  }
  assertExpectedRevision(run, expectedRevision)
  const at = isoNow(clock)
  const record = { phase, note, evidence, waveCount: run.waves.length, state: run.state, at }
  const previousHash = run.checkpoints.at(-1)?.hash ?? null
  const hash = sha256({ previousHash, record })
  const next = deepClone(run)
  next.checkpoints.push({ ...record, previousHash, hash })
  next.revision += 1
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

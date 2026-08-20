// Bridges the operator UI's Keep Going / Overnight action to the real
// tsf/domain/keep-going.mjs state machine. Persists one overnight run per
// project in the local operator state (tsf/server/data-store.mjs). Start/
// Pause/Resume here are real domain transitions on real persisted state --
// wave dispatch itself (planWave/recordWave against live Orca workers) is
// not wired into an autonomous server-side loop yet; that remains a
// separate, larger piece of work (see program state.json M2 gaps). This
// controller's job is only to make the real run lifecycle and its honest
// current state observable and operable from the UI.
import { assertExpectedRevision } from '../domain/canonical.mjs'
import {
  abandonStalledWave,
  checkpointRun,
  compareStateToGoal,
  createOvernightRun,
  pauseRun,
  resumeRun
} from '../domain/keep-going.mjs'

export function keepGoingRunFor(opState, projectId) {
  return opState.keepGoingRuns?.[projectId] ?? null
}

// expectedRevision only matters when a prior (COMPLETE/BLOCKED) run exists --
// two concurrent "start a new run" requests reading that same stale prior
// run must not both succeed in silently overwriting each other, the same
// read-modify-write race pauseKeepGoingRun/resumeKeepGoingRun guard against.
export function startKeepGoingRun(opState, projectId, params, clock, expectedRevision) {
  const existing = keepGoingRunFor(opState, projectId)
  if (existing && !['COMPLETE', 'BLOCKED'].includes(existing.state)) {
    const error = new Error(
      'a Keep Going run is already active for this project -- pause or let it complete first'
    )
    error.code = 'TSF_RUN_ALREADY_ACTIVE'
    throw error
  }
  if (existing) {
    assertExpectedRevision(existing, expectedRevision)
  }
  let run = createOvernightRun(
    {
      id: `keep-going-${projectId}-${Date.now()}`,
      projectId,
      originalGoal: params.originalGoal,
      acceptanceCriteria: params.acceptanceCriteria,
      usageMode: params.usageMode ?? 'BALANCED',
      constraints: params.constraints ?? [],
      stopConditions: params.stopConditions ?? [],
      budget: params.budget ?? {}
    },
    clock
  )
  run = checkpointRun(run, { phase: 'RUN_STARTED' }, clock)
  const next = { ...opState, keepGoingRuns: { ...opState.keepGoingRuns, [projectId]: run } }
  return { opState: next, run }
}

// expectedRevision (optional) guards against a stale read-modify-write: two
// concurrent requests for the same project each load opState before either
// saves it, so without this check the later save silently drops the
// earlier transition. Passing the revision the caller last observed makes
// that race surface as an explicit TSF_STALE_REVISION error instead.
export function pauseKeepGoingRun(opState, projectId, reason, clock, expectedRevision) {
  const run = keepGoingRunFor(opState, projectId)
  if (!run) {
    const error = new Error('no Keep Going run exists for this project')
    error.code = 'TSF_RUN_NOT_FOUND'
    throw error
  }
  let paused = pauseRun(run, reason ?? 'OPERATOR_PAUSE', clock, expectedRevision)
  paused = checkpointRun(paused, { phase: 'OPERATOR_PAUSED', note: reason ?? null }, clock)
  const next = { ...opState, keepGoingRuns: { ...opState.keepGoingRuns, [projectId]: paused } }
  return { opState: next, run: paused }
}

export function resumeKeepGoingRun(opState, projectId, clock, expectedRevision) {
  const run = keepGoingRunFor(opState, projectId)
  if (!run) {
    const error = new Error('no Keep Going run exists for this project')
    error.code = 'TSF_RUN_NOT_FOUND'
    throw error
  }
  let resumed = resumeRun(run, clock, expectedRevision)
  // Matches pauseKeepGoingRun's own checkpoint -- without this, the UI's
  // "Last checkpoint" kept showing OPERATOR_PAUSED after a resume (real
  // review finding, wave 11).
  resumed = checkpointRun(resumed, { phase: 'RUN_RESUMED' }, clock)
  const next = { ...opState, keepGoingRuns: { ...opState.keepGoingRuns, [projectId]: resumed } }
  return { opState: next, run: resumed }
}

// A real, live-confirmed gap: a run left STALLED with its in-flight wave
// never fenced had NO path back to usability from the product surface at
// all -- tickKeepGoingRun always routes to settleStep whenever
// inFlightWave is set (STALLED or not), silently re-checking the SAME
// stuck wave and discarding any new work item a caller supplies, with no
// signal that this happened. abandonStalledWave already existed
// (tsf/domain/keep-going.mjs, waves 18/18b) but was only ever reachable
// from a raw script. Exposing it here is what actually lets an operator
// recover a stalled run through the UI instead of needing one.
export function abandonKeepGoingStalledWave(opState, projectId, reason, clock, expectedRevision) {
  const run = keepGoingRunFor(opState, projectId)
  if (!run) {
    const error = new Error('no Keep Going run exists for this project')
    error.code = 'TSF_RUN_NOT_FOUND'
    throw error
  }
  let next = abandonStalledWave(
    run,
    reason ?? 'OPERATOR_ABANDONED_STALLED_WAVE',
    clock,
    expectedRevision
  )
  // abandonStalledWave only fences the stuck wave -- it never moves the
  // run's own STALLED state, so without this an operator who just recovered
  // the wave would still be stuck with no usable affordance (canResume only
  // shows for PAUSED, and tickKeepGoingRun refuses anything but ACTIVE).
  // Only auto-resume if abandoning left the run at STALLED rather than
  // escalating it further (e.g. to NEEDS_YOU on retry-budget exhaustion,
  // which needs the operator's own decision, not an automatic override).
  if (next.state === 'STALLED') {
    next = resumeRun(next, clock, next.revision)
    next = checkpointRun(
      next,
      { phase: 'RUN_RESUMED', note: 'auto-resumed after abandoning a stalled wave' },
      clock
    )
  }
  return {
    opState: { ...opState, keepGoingRuns: { ...opState.keepGoingRuns, [projectId]: next } },
    run: next
  }
}

// Projects the real run into the display shape the acceptance criteria
// name: goal, Usage Mode, budget, constraints, stop conditions, and live
// phase/gap/worker/retry/verifier/NeedsYou/ReadyForAdoption state. Every
// field is read directly off the real run object -- nothing here invents
// data the domain layer doesn't already have.
//
// Gap analysis: no autonomous dispatch loop exists yet (see module header),
// so nothing has independently verified any criterion for a UI-started run
// -- verifiedSatisfied is honestly empty until real verifier evidence exists
// to pass in here. That means every fresh run correctly shows all criteria
// as remaining rather than a fabricated partial-progress view.
//
// Worker/verifier display: no live Orca worker or verifier facts are wired
// to a UI-started run yet (that also depends on the dispatch loop) -- both
// are surfaced as an honest empty list rather than invented entries.
export function projectKeepGoingRun(run, clock) {
  if (!run) {
    return { started: false }
  }
  const lastCheckpoint = run.checkpoints.at(-1) ?? null
  const openNeedsYou = run.needsYou.filter((entry) => !entry.resolvedAt)
  const gap = compareStateToGoal(run, { verifiedSatisfied: [] }, clock)
  return {
    started: true,
    runId: run.id,
    revision: run.revision,
    state: run.state,
    phase: lastCheckpoint?.phase ?? 'RUN_STARTED',
    goal: run.originalGoal.statement,
    acceptanceCriteria: run.originalGoal.acceptanceCriteria,
    usageMode: run.usageMode,
    budget: run.budget,
    constraints: run.constraints,
    stopConditions: run.stopConditions,
    wavesCompleted: run.waves.length,
    retryCounts: run.retryCounts,
    gap: {
      satisfiedCriteria: gap.satisfiedCriteria,
      remainingGaps: gap.remainingGaps,
      decision: gap.decision
    },
    workers: [],
    verifierResults: [],
    openNeedsYou: openNeedsYou.map(({ id, question, options, raisedAt }) => ({
      id,
      question,
      options,
      raisedAt
    })),
    lastCheckpoint,
    readyForAdoption: run.state === 'COMPLETE',
    createdAt: run.createdAt,
    updatedAt: run.updatedAt
  }
}

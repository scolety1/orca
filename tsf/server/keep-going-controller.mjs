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
  isTickLockActive,
  pauseRun,
  resumeRun
} from '../domain/keep-going.mjs'
import { assertUsageModeAllowed } from '../domain/usage-mode-validation.mjs'

export function keepGoingRunFor(opState, projectId) {
  return opState.keepGoingRuns?.[projectId] ?? null
}

// expectedRevision only matters when a prior (COMPLETE/BLOCKED) run exists --
// two concurrent "start a new run" requests reading that same stale prior
// run must not both succeed in silently overwriting each other, the same
// read-modify-write race pauseKeepGoingRun/resumeKeepGoingRun guard against.
export function startKeepGoingRun(opState, projectId, params, clock, expectedRevision) {
  // Closes a real silent-accept gap: this route never validated usageMode
  // at all, so a caller (e.g. Start Overnight Fleet's dialog, which -- until
  // fixed -- listed HIGH_ASSURANCE as a selectable option) could start a
  // real run in a mode POST /api/usage-mode itself refuses as reserved.
  assertUsageModeAllowed(params.usageMode ?? 'BALANCED')
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

// A real, live-confirmed gap: once a run's own state reached STALLED, it
// had NO path back to usability from the product surface at all --
// canResume only shows for PAUSED, and tickKeepGoingRun refuses to touch
// anything but an ACTIVE run, so a STALLED run with its wave never fenced
// was permanently wedged short of raw script access. abandonStalledWave
// already existed (tsf/domain/keep-going.mjs, waves 18/18b) but was only
// ever reachable that way. Exposing it here is what actually lets an
// operator recover a stalled run through the UI instead of needing one.
export function abandonKeepGoingStalledWave(opState, projectId, reason, clock, expectedRevision) {
  const run = keepGoingRunFor(opState, projectId)
  if (!run) {
    const error = new Error('no Keep Going run exists for this project')
    error.code = 'TSF_RUN_NOT_FOUND'
    throw error
  }
  // abandonStalledWave itself has no opinion on run.state -- it only checks
  // the tick lock and inFlightWave -- so without this guard, exposing it
  // over HTTP would let any caller prematurely abort a perfectly healthy,
  // still-in-progress ACTIVE wave (burning real retry budget on tasks that
  // never actually stalled), not just recover a genuinely STALLED one. A
  // real, independent-review-caught gap: the UI button is gated on STALLED,
  // but nothing previously stopped a direct API call from bypassing that.
  if (run.state !== 'STALLED') {
    const error = new Error(
      `this run is ${run.state}, not STALLED -- there is no stalled wave to abandon`
    )
    error.code = 'TSF_RUN_NOT_STALLED'
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
    // M3: the Live Work Feed's drill-down affordance -- Tim should not
    // normally need this, but it is the real, honest identifier for
    // inspecting raw technical detail (e.g. `orca orchestration run-show
    // --id <id>`), not a fabricated or placeholder value. null until a
    // wave has actually been dispatched (the run may not have created a
    // real Orca Run yet).
    orchestrationRunId: run.orchestrationRunId ?? null,
    // An independent review finding: the client's Live Work Feed mapping
    // (tsf/ui/src/lib/live-work-feed.ts) has no access to the raw
    // tickLock a real WAITING window depends on (correctly -- it's a
    // domain internal, never sent as-is) -- exposing just this boolean is
    // what actually lets the client detect the real gap between a
    // dispatch tick claiming the lock and the wave itself committing,
    // without leaking the lock's own internal shape.
    dispatchTickActive:
      !!run.tickLock && run.tickLock.kind === 'DISPATCH' && isTickLockActive(run, clock),
    // BUG-14 (bug-ledger.json): same "expose exactly the boolean the
    // client needs, never the raw domain internal" pattern as
    // dispatchTickActive above. Without this, the client's Live Work Feed
    // mapping (tsf/ui/src/lib/live-work-feed.ts) had no way to detect
    // domain/live-work-feed.mjs's own inFlightWave-still-set-but-last-
    // checkpointed-WAVE_STALLED case -- it fell through to a guessed
    // WORKING/VERIFYING/REVISION instead of the real STALLED, a genuine
    // drift between the two projections of the same run.
    inFlightWaveStalled: !!(run.inFlightWave && lastCheckpoint?.phase === 'WAVE_STALLED'),
    createdAt: run.createdAt,
    updatedAt: run.updatedAt
  }
}

// Bridges the operator UI's Keep Going / Overnight action to the real
// tsf/domain/keep-going.mjs state machine. Persists one overnight run per
// project in the local operator state (tsf/server/data-store.mjs). Start/
// Pause/Resume here are real domain transitions on real persisted state --
// wave dispatch itself (planWave/recordWave against live Orca workers) is
// not wired into an autonomous server-side loop yet; that remains a
// separate, larger piece of work (see program state.json M2 gaps). This
// controller's job is only to make the real run lifecycle and its honest
// current state observable and operable from the UI.
import { checkpointRun, createOvernightRun, pauseRun, resumeRun } from '../domain/keep-going.mjs'

export function keepGoingRunFor(opState, projectId) {
  return opState.keepGoingRuns?.[projectId] ?? null
}

export function startKeepGoingRun(opState, projectId, params, clock) {
  const existing = keepGoingRunFor(opState, projectId)
  if (existing && !['COMPLETE', 'BLOCKED'].includes(existing.state)) {
    const error = new Error(
      'a Keep Going run is already active for this project -- pause or let it complete first'
    )
    error.code = 'TSF_RUN_ALREADY_ACTIVE'
    throw error
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

export function pauseKeepGoingRun(opState, projectId, reason, clock) {
  const run = keepGoingRunFor(opState, projectId)
  if (!run) {
    const error = new Error('no Keep Going run exists for this project')
    error.code = 'TSF_RUN_NOT_FOUND'
    throw error
  }
  let paused = pauseRun(run, reason ?? 'OPERATOR_PAUSE', clock)
  paused = checkpointRun(paused, { phase: 'OPERATOR_PAUSED', note: reason ?? null }, clock)
  const next = { ...opState, keepGoingRuns: { ...opState.keepGoingRuns, [projectId]: paused } }
  return { opState: next, run: paused }
}

export function resumeKeepGoingRun(opState, projectId, clock) {
  const run = keepGoingRunFor(opState, projectId)
  if (!run) {
    const error = new Error('no Keep Going run exists for this project')
    error.code = 'TSF_RUN_NOT_FOUND'
    throw error
  }
  const resumed = resumeRun(run, clock)
  const next = { ...opState, keepGoingRuns: { ...opState.keepGoingRuns, [projectId]: resumed } }
  return { opState: next, run: resumed }
}

// Projects the real run into the display shape the acceptance criteria
// name: goal, Usage Mode, budget, constraints, stop conditions, and live
// phase/gap/worker/retry/verifier/NeedsYou/ReadyForAdoption state. Every
// field is read directly off the real run object -- nothing here invents
// data the domain layer doesn't already have.
export function projectKeepGoingRun(run) {
  if (!run) {
    return { started: false }
  }
  const lastCheckpoint = run.checkpoints.at(-1) ?? null
  const openNeedsYou = run.needsYou.filter((entry) => !entry.resolvedAt)
  return {
    started: true,
    runId: run.id,
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

// M9 wave 5: turns one AUTONOMY eval case into a real actual output by
// ACTUALLY calling keep-going.mjs's real functions -- never a fabricated
// stand-in for what the real guarantee would produce.
import { createOvernightRun, recordTaskAttempt, replaceGoal } from '../domain/keep-going.mjs'

// budget defaults to createOvernightRun's own real DEFAULT_BUDGET --
// overridable so a candidate (hypothetical, in-memory-only) budget
// configuration can be evaluated the exact same way, matching routing-
// eval-runner.mjs's own config-override pattern.
function baseRun(clock, budget = {}) {
  return createOvernightRun(
    {
      id: 'autonomy-eval-fixture',
      projectId: 'autonomy-eval-fixture',
      originalGoal: 'ship the real feature',
      acceptanceCriteria: ['done'],
      usageMode: 'BALANCED',
      budget
    },
    clock
  )
}

function runGoalImmutabilityCase(clock) {
  const run = baseRun(clock)
  let threw = false
  try {
    replaceGoal(
      run,
      { statement: 'a different goal entirely', acceptanceCriteria: ['done'] },
      { authorizedBy: 'SOME_AGENT', reason: 'attempted, unauthorized' },
      clock
    )
  } catch (error) {
    threw = error.code === 'TSF_GOAL_IMMUTABLE'
  }
  return { unauthorizedGoalChangeThrew: threw }
}

function runRetryBudgetCase(clock, budget) {
  let run = baseRun(clock, budget)
  run = recordTaskAttempt(run, 'task-1', 'RETRY', clock, run.revision)
  run = recordTaskAttempt(run, 'task-1', 'RETRY', clock, run.revision)
  let threw = false
  try {
    recordTaskAttempt(run, 'task-1', 'RETRY', clock, run.revision)
  } catch (error) {
    threw = error.code === 'TSF_RETRY_BUDGET_EXCEEDED'
  }
  return { retryBudgetExceededThrew: threw }
}

function runSuccessNoRetryConsumedCase(clock) {
  let run = baseRun(clock)
  run = recordTaskAttempt(run, 'task-1', 'SUCCEEDED', clock, run.revision)
  return { retryCountAfterSuccess: run.retryCounts['task-1'] ?? 0 }
}

export function runAutonomyEvalCase(evalCase, clock = () => new Date(), { budget = {} } = {}) {
  const { input } = evalCase
  if (input.kind === 'GOAL_IMMUTABILITY') {
    return runGoalImmutabilityCase(clock)
  }
  if (input.kind === 'RETRY_BUDGET') {
    return runRetryBudgetCase(clock, budget)
  }
  if (input.kind === 'SUCCESS_NO_RETRY_CONSUMED') {
    return runSuccessNoRetryConsumedCase(clock)
  }
  throw new Error(`unknown autonomy eval case input kind: ${input.kind}`)
}

export function runAutonomyEvalPack(pack, clock = () => new Date(), configOverride = {}) {
  const actualOutputsByCaseId = {}
  for (const evalCase of pack.cases) {
    actualOutputsByCaseId[evalCase.id] = runAutonomyEvalCase(evalCase, clock, configOverride)
  }
  return actualOutputsByCaseId
}

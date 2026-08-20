// The autonomous wave-dispatch loop (M2's last major gap): drives a
// UI-started, ACTIVE Keep Going run through real Orca dispatch on its own,
// instead of a run sitting at 0 waves until someone manually calls
// planWave/recordWave. One `tickKeepGoingRun` call performs exactly one
// bounded step -- plan+dispatch the next wave, or check an already-dispatched
// wave for settlement -- so it is idempotent and safe to invoke repeatedly
// (a manual "Run now" button, or later an `orca automations create --trigger
// cron` job; registering that recurring trigger is a separate decision, not
// made by this module, since it has its own safety/interval tradeoffs).
//
// Deliberately NOT done here: independent verification. This tick only
// tracks real Orca task status (completed/failed) to settle a wave and feed
// the retry budget -- it never marks an acceptance criterion
// `verifiedSatisfied` from that alone, because Orca reporting a task
// "completed" is the worker's own claim, and program discipline (Section F)
// forbids treating a worker's self-report as done. Deciding a criterion is
// satisfied still requires a separate independent verifier pass; this
// module only makes the mechanical dispatch/settle loop real.
//
// Also NOT done here: deciding *what* candidate work items exist for the
// current gap. That is a planning judgment (today: the operator or a
// planner session), supplied by the caller -- this module refuses to
// fabricate a plan when none is given.
import {
  createOrchestrationRun,
  createOrchestrationTask,
  dispatchOrchestrationTask,
  listOrchestrationTasks
} from '../adapters/orca-orchestration-bridge.mjs'
import { assertExpectedRevision } from '../domain/canonical.mjs'
import {
  checkpointRun,
  dispatchWave,
  planWave,
  recordTaskAttempt,
  settleInFlightWave
} from '../domain/keep-going.mjs'
import { keepGoingRunFor } from './keep-going-controller.mjs'

const DEFAULT_ORCHESTRATION = Object.freeze({
  createOrchestrationRun,
  createOrchestrationTask,
  dispatchOrchestrationTask,
  listOrchestrationTasks
})

const COMPLETED_STATUSES = new Set(['completed', 'succeeded'])
const FAILED_STATUSES = new Set(['failed', 'error'])

function trimPlanToDispatched(wavePlan, dispatchedWorkItemIds) {
  const dispatched = new Set(dispatchedWorkItemIds)
  const batches = wavePlan.batches
    .map((batch) => batch.filter((item) => dispatched.has(item.id)))
    .filter((batch) => batch.length > 0)
  return { ...wavePlan, batches }
}

function saveRun(opState, projectId, run) {
  return { ...opState, keepGoingRuns: { ...opState.keepGoingRuns, [projectId]: run } }
}

async function dispatchStep(opState, projectId, run, candidateWorkItems, clock, orchestration) {
  if (!Array.isArray(candidateWorkItems) || candidateWorkItems.length === 0) {
    return { opState, action: 'NOOP', reason: 'no candidate work items available to plan a wave' }
  }
  const wavePlan = planWave(run, candidateWorkItems, clock)

  let orchestrationRunId = run.orchestrationRunId
  if (!orchestrationRunId) {
    const runResult = await orchestration.createOrchestrationRun({
      objective: run.originalGoal.statement
    })
    if (!runResult.ok) {
      return {
        opState,
        action: 'DISPATCH_FAILED',
        reason: runResult.reason,
        detail: runResult.detail
      }
    }
    orchestrationRunId = runResult.result.run.id
  }

  const dispatchRecords = []
  for (const batch of wavePlan.batches) {
    for (const item of batch) {
      const taskResult = await orchestration.createOrchestrationTask({
        spec: item.spec ?? item.id,
        run: orchestrationRunId,
        taskTitle: item.id
      })
      if (!taskResult.ok) {
        return settlePartialDispatch(
          opState,
          run,
          wavePlan,
          dispatchRecords,
          orchestrationRunId,
          {
            failedItem: item.id,
            reason: taskResult.reason,
            detail: taskResult.detail
          },
          clock,
          projectId
        )
      }
      const taskId = taskResult.result.task.id
      const dispatchResult = await orchestration.dispatchOrchestrationTask({
        task: taskId,
        to: item.workerTerminal,
        run: orchestrationRunId
      })
      if (!dispatchResult.ok) {
        return settlePartialDispatch(
          opState,
          run,
          wavePlan,
          dispatchRecords,
          orchestrationRunId,
          {
            failedItem: item.id,
            reason: dispatchResult.reason,
            detail: dispatchResult.detail
          },
          clock,
          projectId
        )
      }
      dispatchRecords.push({
        workItemId: item.id,
        scope: item.scope,
        taskId,
        dispatchId: dispatchResult.result.dispatch.id
      })
    }
  }

  return recordDispatchedWave(
    opState,
    projectId,
    run,
    wavePlan,
    dispatchRecords,
    orchestrationRunId,
    clock,
    'WAVE_DISPATCHED'
  )
}

// A dispatch failure partway through a wave still leaves already-dispatched
// real Orca tasks running -- silently dropping them would orphan live work
// with no TSF-side record. Records exactly what was actually dispatched
// (trimmed to only the successful items), not the full original plan.
function settlePartialDispatch(
  opState,
  run,
  wavePlan,
  dispatchRecords,
  orchestrationRunId,
  failure,
  clock,
  projectId
) {
  if (dispatchRecords.length === 0) {
    return { opState, action: 'DISPATCH_FAILED', ...failure }
  }
  const trimmedPlan = trimPlanToDispatched(
    wavePlan,
    dispatchRecords.map((r) => r.workItemId)
  )
  return recordDispatchedWave(
    opState,
    projectId,
    run,
    trimmedPlan,
    dispatchRecords,
    orchestrationRunId,
    clock,
    'WAVE_DISPATCHED_PARTIAL',
    failure
  )
}

function recordDispatchedWave(
  opState,
  projectId,
  run,
  wavePlan,
  dispatchRecords,
  orchestrationRunId,
  clock,
  action,
  failure = null
) {
  let next = dispatchWave(run, wavePlan, dispatchRecords, clock, run.revision)
  next = { ...next, orchestrationRunId }
  next = checkpointRun(
    next,
    {
      phase: action,
      note: failure ? `stopped after failure on ${failure.failedItem}: ${failure.reason}` : null,
      evidence: dispatchRecords.map((r) => r.taskId)
    },
    clock
  )
  return {
    opState: saveRun(opState, projectId, next),
    action,
    run: next,
    wavePlan,
    dispatchRecords,
    ...(failure ? { failure } : {})
  }
}

async function settleStep(opState, projectId, run, clock, orchestration) {
  const { inFlightWave, orchestrationRunId } = run
  const tasksResult = await orchestration.listOrchestrationTasks({ run: orchestrationRunId })
  if (!tasksResult.ok) {
    return {
      opState,
      action: 'SETTLE_CHECK_FAILED',
      reason: tasksResult.reason,
      detail: tasksResult.detail
    }
  }
  const tasksById = new Map((tasksResult.result?.tasks ?? []).map((t) => [t.id, t]))

  const outcomes = []
  let allTerminal = true
  for (const record of inFlightWave.dispatchRecords) {
    const task = tasksById.get(record.taskId)
    const status = task?.status ?? 'unknown'
    if (COMPLETED_STATUSES.has(status)) {
      outcomes.push({ ...record, outcome: 'COMPLETED', rawStatus: status })
    } else if (FAILED_STATUSES.has(status)) {
      outcomes.push({ ...record, outcome: 'FAILED', rawStatus: status })
    } else {
      allTerminal = false
      outcomes.push({ ...record, outcome: 'PENDING', rawStatus: status })
    }
  }
  if (!allTerminal) {
    return { opState, action: 'WAVE_STILL_IN_FLIGHT', outcomes }
  }

  let next = run
  const retryBudgetExceeded = []
  for (const outcome of outcomes) {
    try {
      next = recordTaskAttempt(
        next,
        outcome.workItemId,
        outcome.outcome === 'FAILED' ? 'RETRY' : 'COMPLETED',
        clock,
        next.revision
      )
    } catch (error) {
      if (error.code === 'TSF_RETRY_BUDGET_EXCEEDED') {
        retryBudgetExceeded.push(outcome.workItemId)
      } else {
        throw error
      }
    }
  }

  const waveResult = { schemaVersion: 'TSF_KEEP_GOING_WAVE_RESULT_V1', outcomes, settledAt: null }
  next = settleInFlightWave(
    next,
    { ...waveResult, settledAt: next.updatedAt },
    clock,
    next.revision
  )
  next = checkpointRun(
    next,
    { phase: 'WAVE_SETTLED', evidence: outcomes.map((o) => o.taskId) },
    clock
  )

  return {
    opState: saveRun(opState, projectId, next),
    action: retryBudgetExceeded.length > 0 ? 'WAVE_SETTLED_RETRY_BUDGET_EXCEEDED' : 'WAVE_SETTLED',
    run: next,
    outcomes,
    ...(retryBudgetExceeded.length > 0 ? { retryBudgetExceeded } : {})
  }
}

// Performs exactly one bounded step for one project's run: dispatch the next
// wave, check an in-flight wave for settlement, or no-op. Never blocks
// waiting for a worker to finish -- callers (an HTTP route, a manual
// trigger, a future scheduled automation) invoke this repeatedly.
//
// expectedRevision (optional) is checked up front, before any mutation --
// same stale-read protection as every other real mutation path in this
// codebase (pauseKeepGoingRun, resumeKeepGoingRun, ...), for a caller that
// persists opState between reading it and calling tick (an HTTP route, or
// two overlapping automation firings racing on the same project).
export async function tickKeepGoingRun(
  opState,
  projectId,
  candidateWorkItems,
  clock,
  orchestration = DEFAULT_ORCHESTRATION,
  expectedRevision
) {
  const run = keepGoingRunFor(opState, projectId)
  if (!run) {
    return { opState, action: 'NOOP', reason: 'no Keep Going run for this project' }
  }
  assertExpectedRevision(run, expectedRevision)
  if (run.state !== 'ACTIVE') {
    return { opState, action: 'NOOP', reason: `run state is ${run.state}, not ACTIVE` }
  }
  if (run.inFlightWave) {
    return settleStep(opState, projectId, run, clock, orchestration)
  }
  return dispatchStep(opState, projectId, run, candidateWorkItems, clock, orchestration)
}

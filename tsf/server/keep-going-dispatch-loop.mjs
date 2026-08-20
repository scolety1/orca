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
import { assertExpectedRevision, isoNow } from '../domain/canonical.mjs'
import {
  checkpointRun,
  dispatchWave,
  markStalled,
  planWave,
  raiseNeedsYou,
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

  // Tracked separately from run.orchestrationRunId: a freshly-created real
  // Orca orchestration Run must be persisted even if every task-create in
  // this wave then fails, or it leaks -- forgotten by TSF but still real in
  // Orca -- and gets recreated (another orphan) on every retrying tick.
  let orchestrationRunId = run.orchestrationRunId
  let workingRun = run
  const orchestrationRunFreshlyCreated = !orchestrationRunId
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
    workingRun = checkpointRun(
      { ...run, orchestrationRunId },
      { phase: 'ORCHESTRATION_RUN_CREATED', evidence: [orchestrationRunId] },
      clock
    )
  }

  // Batches themselves must stay sequential (planWave puts conflicting
  // items in separate batches precisely so they don't overlap), but items
  // within one conflict-free batch are still dispatched one at a time here
  // rather than concurrently -- a real, disclosed gap against the module's
  // own "two independent workers beats five on one subsystem" design
  // intent (it costs wall-clock dispatch latency, not correctness).
  // Deliberately not fixed this wave: correctly handling partial failure
  // among concurrently-dispatched items needs more care than the current
  // sequential-with-early-return shape, and this bounded pass prioritized
  // the correctness findings above it.
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
          workingRun,
          wavePlan,
          dispatchRecords,
          orchestrationRunId,
          orchestrationRunFreshlyCreated,
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
          workingRun,
          wavePlan,
          dispatchRecords,
          orchestrationRunId,
          orchestrationRunFreshlyCreated,
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
    workingRun,
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
  orchestrationRunFreshlyCreated,
  failure,
  clock,
  projectId
) {
  if (dispatchRecords.length === 0) {
    // Nothing dispatched, but if this tick just created a new real Orca
    // orchestration Run, it must be persisted even on a total failure --
    // otherwise it leaks (forgotten by TSF but still real in Orca) and gets
    // recreated on every retrying tick. Reusing an already-known Run needs
    // no new write here.
    return orchestrationRunFreshlyCreated
      ? { opState: saveRun(opState, projectId, run), action: 'DISPATCH_FAILED', run, ...failure }
      : { opState, action: 'DISPATCH_FAILED', ...failure }
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
    // No real per-worker heartbeat timestamp exists to feed keep-going.mjs's
    // own detectStall (mapOrchestrationFacts always emits lastHeartbeatAt:
    // null -- a disclosed, still-open limitation, see wave 11 finding 4).
    // What IS real: how long this wave has been dispatched. Past
    // stallThresholdMs with nothing terminal, escalate to STALLED so an
    // operator sees it, rather than looping WAVE_STILL_IN_FLIGHT forever
    // with no way out.
    const silentForMs = Date.parse(isoNow(clock)) - Date.parse(inFlightWave.dispatchedAt)
    if (silentForMs > run.budget.stallThresholdMs) {
      const stalled = markStalled(
        run,
        inFlightWave.dispatchRecords.filter((r) =>
          outcomes.some((o) => o.workItemId === r.workItemId && o.outcome === 'PENDING')
        ),
        clock
      )
      return {
        opState: saveRun(opState, projectId, stalled),
        action: 'WAVE_STALLED',
        run: stalled,
        outcomes
      }
    }
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

  if (retryBudgetExceeded.length > 0) {
    // Reporting the breach alone doesn't stop anything: nothing prevents
    // the caller from handing the same exhausted work item back in on the
    // very next tick, immediately re-triggering the same breach forever.
    // Escalate to a real NEEDS_YOU question so an operator actually sees it
    // and the run stops silently spinning.
    next = raiseNeedsYou(
      next,
      {
        question: `Retry budget exceeded for work item(s): ${retryBudgetExceeded.join(', ')}. How should I proceed?`,
        options: ['RETRY_ANYWAY', 'SKIP_AND_CONTINUE', 'BLOCK_RUN']
      },
      clock
    )
    next = checkpointRun(
      next,
      { phase: 'RETRY_BUDGET_NEEDS_YOU', evidence: retryBudgetExceeded },
      clock
    )
  }

  return {
    opState: saveRun(opState, projectId, next),
    action: retryBudgetExceeded.length > 0 ? 'WAVE_SETTLED_NEEDS_YOU' : 'WAVE_SETTLED',
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
// expectedRevision (optional) is checked once, up front, against the
// revision the caller observed before calling tick -- it catches a caller
// acting on an already-stale read (an HTTP route racing another request
// that landed first). It does NOT protect against a change landing on the
// SAME in-memory run mid-tick: dispatchStep/settleStep hold that one `run`
// object across several awaited real CLI round-trips (each up to the
// bridge's own timeout), and the eventual dispatchWave/settleInFlightWave
// calls pass the run's own (by-then-current-to-itself) revision, which
// trivially always matches. Real protection against a concurrent write
// landing mid-tick needs per-request atomic read-check-write at the
// persistence layer -- the same still-open architectural gap already
// disclosed for data-store.mjs (wave 8 finding 4, wave 11 findings 1/6),
// not something this module solves on its own.
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

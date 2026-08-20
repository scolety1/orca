import assert from 'node:assert/strict'
import test from 'node:test'
import { createOvernightRun, pauseRun } from '../domain/keep-going.mjs'
import { tickKeepGoingRun } from '../server/keep-going-dispatch-loop.mjs'

const clock = () => new Date('2026-08-20T05:00:00.000Z')

function baseOpState(overrides = {}) {
  const run = createOvernightRun(
    {
      id: 'run-1',
      projectId: 'fixture:proj',
      originalGoal: 'Ship the fixture feature end to end.',
      acceptanceCriteria: ['CRITERION_A'],
      usageMode: 'BALANCED',
      ...overrides
    },
    clock
  )
  return { keepGoingRuns: { 'fixture:proj': run } }
}

function okOrchestration(overrides = {}) {
  return {
    createOrchestrationRun: async () => ({ ok: true, result: { run: { id: 'orch-run-1' } } }),
    createOrchestrationTask: async ({ taskTitle }) => ({
      ok: true,
      result: { task: { id: `task-${taskTitle}` } }
    }),
    dispatchOrchestrationTask: async ({ task }) => ({
      ok: true,
      result: { dispatch: { id: `ctx-${task}` } }
    }),
    listOrchestrationTasks: async () => ({ ok: true, result: { tasks: [] } }),
    ...overrides
  }
}

const oneItem = [{ id: 't1', scope: ['src/a.mjs'] }]
const twoItems = [
  { id: 't1', scope: ['src/a.mjs'] },
  { id: 't2', scope: ['src/b.mjs'] }
]

test('tickKeepGoingRun no-ops when there is no run for the project', async () => {
  const result = await tickKeepGoingRun({ keepGoingRuns: {} }, 'fixture:proj', oneItem, clock)
  assert.equal(result.action, 'NOOP')
  assert.deepEqual(result.opState.keepGoingRuns, {})
})

test('tickKeepGoingRun rejects a stale expectedRevision before touching anything', async () => {
  const opState = baseOpState()
  await assert.rejects(
    () => tickKeepGoingRun(opState, 'fixture:proj', oneItem, clock, okOrchestration(), 5),
    (error) => error.code === 'TSF_STALE_REVISION'
  )
  const result = await tickKeepGoingRun(
    opState,
    'fixture:proj',
    oneItem,
    clock,
    okOrchestration(),
    0
  )
  assert.equal(result.action, 'WAVE_DISPATCHED')
})

test('tickKeepGoingRun no-ops when the run is not ACTIVE', async () => {
  const opState = baseOpState()
  const paused = pauseRun(opState.keepGoingRuns['fixture:proj'], 'operator pause', clock)
  opState.keepGoingRuns['fixture:proj'] = paused
  const result = await tickKeepGoingRun(opState, 'fixture:proj', oneItem, clock)
  assert.equal(result.action, 'NOOP')
  assert.match(result.reason, /PAUSED/)
})

test('tickKeepGoingRun no-ops when no candidate work items are supplied -- it never fabricates a plan', async () => {
  const opState = baseOpState()
  const result = await tickKeepGoingRun(opState, 'fixture:proj', [], clock)
  assert.equal(result.action, 'NOOP')
  assert.match(result.reason, /candidate work items/)
})

test('tickKeepGoingRun dispatches the next wave, creating the orchestration run lazily on first dispatch', async () => {
  const opState = baseOpState()
  const result = await tickKeepGoingRun(opState, 'fixture:proj', oneItem, clock, okOrchestration())
  assert.equal(result.action, 'WAVE_DISPATCHED')
  const run = result.opState.keepGoingRuns['fixture:proj']
  assert.equal(run.orchestrationRunId, 'orch-run-1')
  assert.equal(run.waves.length, 0, 'not settled yet')
  assert.equal(run.inFlightWave.dispatchRecords.length, 1)
  assert.equal(run.inFlightWave.dispatchRecords[0].taskId, 'task-t1')
})

test('tickKeepGoingRun reuses an existing orchestrationRunId instead of creating a second Run', async () => {
  const opState = baseOpState()
  let createOrchestrationRunCalls = 0
  const orchestration = okOrchestration({
    createOrchestrationRun: async () => {
      createOrchestrationRunCalls += 1
      return { ok: true, result: { run: { id: 'orch-run-1' } } }
    }
  })
  const first = await tickKeepGoingRun(opState, 'fixture:proj', oneItem, clock, orchestration)
  // Settle the first wave so a second wave can be planned.
  const settled = await tickKeepGoingRun(
    first.opState,
    'fixture:proj',
    oneItem,
    clock,
    okOrchestration({
      listOrchestrationTasks: async () => ({
        ok: true,
        result: { tasks: [{ id: 'task-t1', status: 'completed' }] }
      })
    })
  )
  assert.equal(settled.action, 'WAVE_SETTLED')
  await tickKeepGoingRun(settled.opState, 'fixture:proj', oneItem, clock, orchestration)
  assert.equal(createOrchestrationRunCalls, 1)
})

test('a still-in-flight wave reports WAVE_STILL_IN_FLIGHT and leaves the run untouched', async () => {
  const opState = baseOpState()
  const dispatched = await tickKeepGoingRun(
    opState,
    'fixture:proj',
    oneItem,
    clock,
    okOrchestration()
  )
  const result = await tickKeepGoingRun(
    dispatched.opState,
    'fixture:proj',
    oneItem,
    clock,
    okOrchestration({
      listOrchestrationTasks: async () => ({
        ok: true,
        result: { tasks: [{ id: 'task-t1', status: 'in_progress' }] }
      })
    })
  )
  assert.equal(result.action, 'WAVE_STILL_IN_FLIGHT')
  assert.equal(result.opState, dispatched.opState, 'no state change while still in flight')
})

test('a completed in-flight wave settles: recorded into waves, inFlightWave cleared, retry count untouched', async () => {
  const opState = baseOpState()
  const dispatched = await tickKeepGoingRun(
    opState,
    'fixture:proj',
    oneItem,
    clock,
    okOrchestration()
  )
  const result = await tickKeepGoingRun(
    dispatched.opState,
    'fixture:proj',
    oneItem,
    clock,
    okOrchestration({
      listOrchestrationTasks: async () => ({
        ok: true,
        result: { tasks: [{ id: 'task-t1', status: 'completed' }] }
      })
    })
  )
  assert.equal(result.action, 'WAVE_SETTLED')
  const run = result.opState.keepGoingRuns['fixture:proj']
  assert.equal(run.inFlightWave, null)
  assert.equal(run.waves.length, 1)
  assert.equal(run.retryCounts.t1 ?? 0, 0, 'a completed outcome must not consume retry budget')
})

test('a failed in-flight wave settles and records a retry attempt against the work item id, not the Orca task id', async () => {
  const opState = baseOpState()
  const dispatched = await tickKeepGoingRun(
    opState,
    'fixture:proj',
    oneItem,
    clock,
    okOrchestration()
  )
  const result = await tickKeepGoingRun(
    dispatched.opState,
    'fixture:proj',
    oneItem,
    clock,
    okOrchestration({
      listOrchestrationTasks: async () => ({
        ok: true,
        result: { tasks: [{ id: 'task-t1', status: 'failed' }] }
      })
    })
  )
  assert.equal(result.action, 'WAVE_SETTLED')
  const run = result.opState.keepGoingRuns['fixture:proj']
  assert.equal(run.retryCounts.t1, 1)
})

test('exceeding the retry budget during settlement is reported, not thrown, and the wave still settles', async () => {
  const opState = baseOpState({ budget: { maxRetriesPerTask: 0 } })
  const dispatched = await tickKeepGoingRun(
    opState,
    'fixture:proj',
    oneItem,
    clock,
    okOrchestration()
  )
  const result = await tickKeepGoingRun(
    dispatched.opState,
    'fixture:proj',
    oneItem,
    clock,
    okOrchestration({
      listOrchestrationTasks: async () => ({
        ok: true,
        result: { tasks: [{ id: 'task-t1', status: 'failed' }] }
      })
    })
  )
  assert.equal(result.action, 'WAVE_SETTLED_RETRY_BUDGET_EXCEEDED')
  assert.deepEqual(result.retryBudgetExceeded, ['t1'])
  const run = result.opState.keepGoingRuns['fixture:proj']
  assert.equal(run.inFlightWave, null, 'the wave still settles despite the budget breach')
})

test('a dispatch failure with nothing yet dispatched reports DISPATCH_FAILED and leaves opState unchanged', async () => {
  const opState = baseOpState()
  const result = await tickKeepGoingRun(
    opState,
    'fixture:proj',
    oneItem,
    clock,
    okOrchestration({
      createOrchestrationTask: async () => ({ ok: false, reason: 'CLI_ERROR', detail: 'boom' })
    })
  )
  assert.equal(result.action, 'DISPATCH_FAILED')
  assert.equal(result.opState, opState)
})

test('a mid-wave dispatch failure records only the items actually dispatched, trimming the plan honestly', async () => {
  const opState = baseOpState({ budget: { maxConcurrentWorkers: 1 } })
  let taskCalls = 0
  const result = await tickKeepGoingRun(
    opState,
    'fixture:proj',
    twoItems,
    clock,
    okOrchestration({
      createOrchestrationTask: async ({ taskTitle }) => {
        taskCalls += 1
        if (taskTitle === 't2') {
          return { ok: false, reason: 'CLI_ERROR', detail: 'second item failed' }
        }
        return { ok: true, result: { task: { id: `task-${taskTitle}` } } }
      }
    })
  )
  assert.equal(result.action, 'WAVE_DISPATCHED_PARTIAL')
  assert.equal(result.dispatchRecords.length, 1)
  assert.equal(result.dispatchRecords[0].workItemId, 't1')
  assert.equal(result.failure.failedItem, 't2')
  const run = result.opState.keepGoingRuns['fixture:proj']
  assert.equal(run.inFlightWave.dispatchRecords.length, 1)
  assert.ok(
    run.inFlightWave.wavePlan.batches.flat().every((item) => item.id === 't1'),
    'the recorded plan must only reflect items actually dispatched'
  )
})

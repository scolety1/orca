import assert from 'node:assert/strict'
import test from 'node:test'
import { createOvernightRun } from '../domain/keep-going.mjs'
import { tickKeepGoingRun } from '../server/keep-going-dispatch-loop.mjs'

const clock = () => new Date('2026-08-20T05:00:00.000Z')
const PROJECT_ID = 'fixture:proj'

// A fake, in-memory store matching keep-going-run-store.mjs's synchronous
// contract (readRun/withRun) -- fast, pure-logic tests use this; real
// synchronous-data-store-backed adversarial concurrency tests live in
// keep-going-dispatch-loop-concurrency.test.mjs.
function makeFakeStore(run) {
  let current = run
  return {
    readRun: () => current,
    withRun: (_projectId, mutateFn) => {
      current = mutateFn(current)
      return current
    }
  }
}

function baseRun(overrides = {}) {
  return createOvernightRun(
    {
      id: 'run-1',
      projectId: PROJECT_ID,
      originalGoal: 'Ship the fixture feature end to end.',
      acceptanceCriteria: ['CRITERION_A'],
      usageMode: 'BALANCED',
      ...overrides
    },
    clock
  )
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
  const store = makeFakeStore(null)
  const result = await tickKeepGoingRun(PROJECT_ID, oneItem, clock, { store })
  assert.equal(result.action, 'NOOP')
})

test('tickKeepGoingRun no-ops when the run is not ACTIVE', async () => {
  const run = { ...baseRun(), state: 'PAUSED' }
  const store = makeFakeStore(run)
  const result = await tickKeepGoingRun(PROJECT_ID, oneItem, clock, { store })
  assert.equal(result.action, 'NOOP')
  assert.match(result.reason, /PAUSED/)
})

test('tickKeepGoingRun no-ops when no candidate work items are supplied -- it never fabricates a plan', async () => {
  const store = makeFakeStore(baseRun())
  const result = await tickKeepGoingRun(PROJECT_ID, [], clock, { store })
  assert.equal(result.action, 'NOOP')
  assert.match(result.reason, /candidate work items/)
})

test('tickKeepGoingRun dispatches the next wave, creating the orchestration run lazily on first dispatch', async () => {
  const store = makeFakeStore(baseRun())
  const result = await tickKeepGoingRun(PROJECT_ID, oneItem, clock, {
    orchestration: okOrchestration(),
    store
  })
  assert.equal(result.action, 'WAVE_DISPATCHED')
  const run = store.readRun(PROJECT_ID)
  assert.equal(run.orchestrationRunId, 'orch-run-1')
  assert.equal(run.waves.length, 0, 'not settled yet')
  assert.equal(run.tickLock, null, 'lock released after commit')
  assert.equal(run.inFlightWave.dispatchRecords.length, 1)
  assert.equal(run.inFlightWave.dispatchRecords[0].taskId, 'task-t1')
})

test('tickKeepGoingRun reuses an existing orchestrationRunId instead of creating a second Run', async () => {
  const store = makeFakeStore(baseRun())
  let createOrchestrationRunCalls = 0
  const orchestration = okOrchestration({
    createOrchestrationRun: async () => {
      createOrchestrationRunCalls += 1
      return { ok: true, result: { run: { id: 'orch-run-1' } } }
    }
  })
  await tickKeepGoingRun(PROJECT_ID, oneItem, clock, { orchestration, store })
  const settled = await tickKeepGoingRun(PROJECT_ID, oneItem, clock, {
    orchestration: okOrchestration({
      listOrchestrationTasks: async () => ({
        ok: true,
        result: { tasks: [{ id: 'task-t1', status: 'completed' }] }
      })
    }),
    store
  })
  assert.equal(settled.action, 'WAVE_SETTLED')
  await tickKeepGoingRun(PROJECT_ID, oneItem, clock, { orchestration, store })
  assert.equal(createOrchestrationRunCalls, 1)
})

test('a still-in-flight wave reports WAVE_STILL_IN_FLIGHT and releases the lock without settling', async () => {
  const store = makeFakeStore(baseRun())
  await tickKeepGoingRun(PROJECT_ID, oneItem, clock, { orchestration: okOrchestration(), store })
  const beforeRevision = store.readRun(PROJECT_ID).revision
  const result = await tickKeepGoingRun(PROJECT_ID, oneItem, clock, {
    orchestration: okOrchestration({
      listOrchestrationTasks: async () => ({
        ok: true,
        result: { tasks: [{ id: 'task-t1', status: 'in_progress' }] }
      })
    }),
    store
  })
  assert.equal(result.action, 'WAVE_STILL_IN_FLIGHT')
  const run = store.readRun(PROJECT_ID)
  assert.equal(run.inFlightWave.dispatchRecords.length, 1, 'wave still in flight, not settled')
  assert.equal(run.tickLock, null, 'lock released even when nothing settled')
  assert.ok(
    run.revision > beforeRevision,
    'claim+release still bumps revision even on a no-op poll'
  )
})

test('a wave stuck in flight past the stall threshold escalates the run to STALLED instead of looping forever', async () => {
  const store = makeFakeStore(baseRun({ budget: { stallThresholdMs: 60_000 } }))
  await tickKeepGoingRun(PROJECT_ID, oneItem, clock, { orchestration: okOrchestration(), store })
  const laterClock = () => new Date('2026-08-20T05:05:00.000Z') // 5 minutes later
  const result = await tickKeepGoingRun(PROJECT_ID, oneItem, laterClock, {
    orchestration: okOrchestration({
      listOrchestrationTasks: async () => ({
        ok: true,
        result: { tasks: [{ id: 'task-t1', status: 'in_progress' }] }
      })
    }),
    store
  })
  assert.equal(result.action, 'WAVE_STALLED')
  assert.equal(store.readRun(PROJECT_ID).state, 'STALLED')
})

test('a wave still within the stall threshold keeps reporting WAVE_STILL_IN_FLIGHT', async () => {
  const store = makeFakeStore(baseRun({ budget: { stallThresholdMs: 60_000 } }))
  await tickKeepGoingRun(PROJECT_ID, oneItem, clock, { orchestration: okOrchestration(), store })
  const soonClock = () => new Date('2026-08-20T05:00:30.000Z') // 30s later -- under threshold
  const result = await tickKeepGoingRun(PROJECT_ID, oneItem, soonClock, {
    orchestration: okOrchestration({
      listOrchestrationTasks: async () => ({
        ok: true,
        result: { tasks: [{ id: 'task-t1', status: 'in_progress' }] }
      })
    }),
    store
  })
  assert.equal(result.action, 'WAVE_STILL_IN_FLIGHT')
})

test('a completed in-flight wave settles: recorded into waves, inFlightWave cleared, retry count untouched', async () => {
  const store = makeFakeStore(baseRun())
  await tickKeepGoingRun(PROJECT_ID, oneItem, clock, { orchestration: okOrchestration(), store })
  const result = await tickKeepGoingRun(PROJECT_ID, oneItem, clock, {
    orchestration: okOrchestration({
      listOrchestrationTasks: async () => ({
        ok: true,
        result: { tasks: [{ id: 'task-t1', status: 'completed' }] }
      })
    }),
    store
  })
  assert.equal(result.action, 'WAVE_SETTLED')
  const run = store.readRun(PROJECT_ID)
  assert.equal(run.inFlightWave, null)
  assert.equal(run.tickLock, null)
  assert.equal(run.waves.length, 1)
  assert.equal(run.retryCounts.t1 ?? 0, 0, 'a completed outcome must not consume retry budget')
})

test('a failed in-flight wave settles and records a retry attempt against the work item id, not the Orca task id', async () => {
  const store = makeFakeStore(baseRun())
  await tickKeepGoingRun(PROJECT_ID, oneItem, clock, { orchestration: okOrchestration(), store })
  const result = await tickKeepGoingRun(PROJECT_ID, oneItem, clock, {
    orchestration: okOrchestration({
      listOrchestrationTasks: async () => ({
        ok: true,
        result: { tasks: [{ id: 'task-t1', status: 'failed' }] }
      })
    }),
    store
  })
  assert.equal(result.action, 'WAVE_SETTLED')
  assert.equal(store.readRun(PROJECT_ID).retryCounts.t1, 1)
})

test('exceeding the retry budget during settlement escalates to NEEDS_YOU rather than silently re-offering the same doomed work item', async () => {
  const store = makeFakeStore(baseRun({ budget: { maxRetriesPerTask: 0 } }))
  await tickKeepGoingRun(PROJECT_ID, oneItem, clock, { orchestration: okOrchestration(), store })
  const result = await tickKeepGoingRun(PROJECT_ID, oneItem, clock, {
    orchestration: okOrchestration({
      listOrchestrationTasks: async () => ({
        ok: true,
        result: { tasks: [{ id: 'task-t1', status: 'failed' }] }
      })
    }),
    store
  })
  assert.equal(result.action, 'WAVE_SETTLED_NEEDS_YOU')
  assert.deepEqual(result.retryBudgetExceeded, ['t1'])
  const run = store.readRun(PROJECT_ID)
  assert.equal(run.inFlightWave, null, 'the wave still settles despite the budget breach')
  assert.equal(run.state, 'NEEDS_YOU')
  assert.match(run.needsYou.at(-1).question, /t1/)
})

test('a dispatch failure with nothing yet dispatched reports DISPATCH_FAILED and persists a freshly-created orchestrationRunId so it is not orphaned', async () => {
  const store = makeFakeStore(baseRun())
  const result = await tickKeepGoingRun(PROJECT_ID, oneItem, clock, {
    orchestration: okOrchestration({
      createOrchestrationTask: async () => ({ ok: false, reason: 'CLI_ERROR', detail: 'boom' })
    }),
    store
  })
  assert.equal(result.action, 'DISPATCH_FAILED')
  const run = store.readRun(PROJECT_ID)
  assert.equal(
    run.orchestrationRunId,
    'orch-run-1',
    'the real Run created before the failure must not be forgotten'
  )
  assert.equal(run.tickLock, null)
})

test('a dispatch failure on an already-known orchestrationRunId does not touch it again', async () => {
  const withRunId = { ...baseRun(), orchestrationRunId: 'orch-run-1' }
  const store = makeFakeStore(withRunId)
  const result = await tickKeepGoingRun(PROJECT_ID, oneItem, clock, {
    orchestration: okOrchestration({
      createOrchestrationTask: async () => ({ ok: false, reason: 'CLI_ERROR', detail: 'boom' })
    }),
    store
  })
  assert.equal(result.action, 'DISPATCH_FAILED')
  assert.equal(store.readRun(PROJECT_ID).orchestrationRunId, 'orch-run-1')
})

test('a mid-wave dispatch failure records only the items actually dispatched, trimming the plan honestly', async () => {
  const store = makeFakeStore(baseRun({ budget: { maxConcurrentWorkers: 1 } }))
  const result = await tickKeepGoingRun(PROJECT_ID, twoItems, clock, {
    orchestration: okOrchestration({
      createOrchestrationTask: async ({ taskTitle }) => {
        if (taskTitle === 't2') {
          return { ok: false, reason: 'CLI_ERROR', detail: 'second item failed' }
        }
        return { ok: true, result: { task: { id: `task-${taskTitle}` } } }
      }
    }),
    store
  })
  assert.equal(result.action, 'WAVE_DISPATCHED_PARTIAL')
  assert.equal(result.dispatchRecords.length, 1)
  assert.equal(result.dispatchRecords[0].workItemId, 't1')
  assert.equal(result.failure.failedItem, 't2')
  const run = store.readRun(PROJECT_ID)
  assert.equal(run.inFlightWave.dispatchRecords.length, 1)
  assert.ok(
    run.inFlightWave.wavePlan.batches.flat().every((item) => item.id === 't1'),
    'the recorded plan must only reflect items actually dispatched'
  )
})

test('two overlapping ticks on the same run: the second is rejected outright, never attempting CLI work', async () => {
  const store = makeFakeStore(baseRun())
  let taskCreateCalls = 0
  // Simulate tick A's async CLI work never resolving during this test (a
  // slow/in-flight dispatch) by using a store whose withRun for the CLAIM
  // step succeeds once, then leaves the lock held -- tick B's claim on the
  // SAME store must see it and refuse to proceed.
  const orchestration = okOrchestration({
    createOrchestrationTask: async ({ taskTitle }) => {
      taskCreateCalls += 1
      return { ok: true, result: { task: { id: `task-${taskTitle}` } } }
    }
  })
  const tickA = tickKeepGoingRun(PROJECT_ID, oneItem, clock, { orchestration, store })
  // tick B starts its claim attempt "at the same time" -- since this fake
  // store's withRun is synchronous, tick A's claim (the first thing it
  // does) has already landed by the time tick B's claim call runs, so tick
  // B must see the lock and bail before touching orchestration at all.
  const resultB = await tickKeepGoingRun(PROJECT_ID, oneItem, clock, { orchestration, store })
  const resultA = await tickA
  assert.equal(resultB.action, 'DISPATCH_CLAIM_FAILED')
  assert.equal(resultB.reason, 'TSF_TICK_IN_PROGRESS')
  assert.equal(resultA.action, 'WAVE_DISPATCHED')
  assert.equal(taskCreateCalls, 1, 'only the winning tick ever called createOrchestrationTask')
})

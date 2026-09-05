// Sender-terminal resolution for the autonomous wave-dispatch loop -- split
// out of keep-going-dispatch-loop.test.mjs (same fast, fake-in-memory-store
// pattern). Real V1 stabilization finding: every real Orca orchestration
// call needs a `from` (sender-terminal) identity, and this module never
// supplied one, so every real dispatch attempt from the headless production
// TSF server failed with no_active_sender_terminal (confirmed live against
// both WorldForge and NWR). These tests prove the fix: ORCA_TERMINAL_HANDLE
// is used when present, a dispatcher terminal is created on demand
// otherwise, `from` reaches every real orchestration call, and a failure to
// resolve one aborts honestly before any Orca resource is created.
import assert from 'node:assert/strict'
import test from 'node:test'
import path from 'node:path'
import { createOvernightRun } from '../domain/keep-going.mjs'
import { tickKeepGoingRun } from '../server/keep-going-dispatch-loop.mjs'

process.env.TSF_ORCA_CLI_COMMAND = path.join(import.meta.dirname, 'fixtures', 'stub-orca-cli.mjs')
process.env.STUB_ORCA_MODE = 'success'
// Main TSF Resource Pressure Governor integration review: forced HEALTHY,
// same seam http-resource-pressure-governor.test.mjs uses.
process.env.TSF_RESOURCE_PRESSURE_TEST_TOTAL_BYTES = String(16 * 1024 ** 3)
process.env.TSF_RESOURCE_PRESSURE_TEST_FREE_BYTES = String(8 * 1024 ** 3)
delete process.env.ORCA_TERMINAL_HANDLE

const clock = () => new Date('2026-08-20T05:00:00.000Z')
const PROJECT_ID = 'fixture:proj'
const oneItem = [{ id: 't1', scope: ['src/a.mjs'], worktree: 'C:/repo/wt1' }]

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
    createDispatcherTerminal: async () => ({
      ok: true,
      result: { terminal: { handle: 'fake-dispatcher-terminal' } }
    }),
    bindOrchestrationRun: async ({ id }) => ({ ok: true, result: { run: { id } } }),
    createOrchestrationRun: async () => ({ ok: true, result: { run: { id: 'orch-run-1' } } }),
    createOrchestrationTask: async ({ taskTitle }) => ({
      ok: true,
      result: { task: { id: `task-${taskTitle}` } }
    }),
    startOrchestrationWorker: async ({ task }) => ({
      ok: true,
      result: { taskId: task, dispatchId: `ctx-${task}`, state: 'ready', stage: 'input_accepted' }
    }),
    listOrchestrationTasks: async () => ({ ok: true, result: { tasks: [] } }),
    ...overrides
  }
}

test('a real dispatch threads a freshly-created dispatcher terminal handle as `from` into every real orchestration call', async () => {
  const store = makeFakeStore(baseRun())
  const fromByCall = {}
  const orchestration = okOrchestration({
    createOrchestrationRun: async ({ from }) => {
      fromByCall.createOrchestrationRun = from
      return { ok: true, result: { run: { id: 'orch-run-1' } } }
    },
    createOrchestrationTask: async ({ taskTitle, from }) => {
      fromByCall.createOrchestrationTask = from
      return { ok: true, result: { task: { id: `task-${taskTitle}` } } }
    },
    startOrchestrationWorker: async ({ task, from }) => {
      fromByCall.startOrchestrationWorker = from
      return {
        ok: true,
        result: { taskId: task, dispatchId: `ctx-${task}`, state: 'ready', stage: 'input_accepted' }
      }
    }
  })
  const result = await tickKeepGoingRun(PROJECT_ID, oneItem, clock, { orchestration, store })
  assert.equal(result.action, 'WAVE_DISPATCHED')
  assert.equal(fromByCall.createOrchestrationRun, 'fake-dispatcher-terminal')
  assert.equal(fromByCall.createOrchestrationTask, 'fake-dispatcher-terminal')
  assert.equal(fromByCall.startOrchestrationWorker, 'fake-dispatcher-terminal')
})

test('ORCA_TERMINAL_HANDLE, when set, is used directly -- no dispatcher terminal is created', async () => {
  process.env.ORCA_TERMINAL_HANDLE = 'term_real-live-terminal'
  try {
    const store = makeFakeStore(baseRun())
    let createCalls = 0
    let fromSeen = null
    const orchestration = okOrchestration({
      createDispatcherTerminal: async () => {
        createCalls += 1
        return { ok: true, result: { terminal: { handle: 'should-never-be-used' } } }
      },
      startOrchestrationWorker: async ({ task, from }) => {
        fromSeen = from
        return {
          ok: true,
          result: {
            taskId: task,
            dispatchId: `ctx-${task}`,
            state: 'ready',
            stage: 'input_accepted'
          }
        }
      }
    })
    const result = await tickKeepGoingRun(PROJECT_ID, oneItem, clock, { orchestration, store })
    assert.equal(result.action, 'WAVE_DISPATCHED')
    assert.equal(createCalls, 0, 'the env var short-circuits terminal creation entirely')
    assert.equal(fromSeen, 'term_real-live-terminal')
  } finally {
    delete process.env.ORCA_TERMINAL_HANDLE
  }
})

test('a failure to resolve a sender terminal aborts honestly before any real Orca Run/task is created', async () => {
  const store = makeFakeStore(baseRun())
  let runCreateCalls = 0
  const orchestration = okOrchestration({
    createDispatcherTerminal: async () => ({
      ok: false,
      reason: 'CLI_ERROR',
      detail: 'no_active_sender_terminal'
    }),
    createOrchestrationRun: async () => {
      runCreateCalls += 1
      return { ok: true, result: { run: { id: 'orch-run-1' } } }
    }
  })
  const result = await tickKeepGoingRun(PROJECT_ID, oneItem, clock, { orchestration, store })
  assert.equal(result.action, 'DISPATCH_FAILED')
  assert.equal(result.reason, 'CLI_ERROR')
  assert.equal(
    runCreateCalls,
    0,
    'no real orchestration Run may be created without a sender identity'
  )
  const run = store.readRun(PROJECT_ID)
  assert.equal(run.orchestrationRunId, null, 'nothing real was ever recorded as created')
})

// Placement resolution, collision detection, and the missing-placement
// safety guard for the autonomous wave-dispatch loop -- split out of
// keep-going-dispatch-loop.test.mjs to keep that file under the repo's
// max-lines lint cap. Same fast, fake-in-memory-store pattern as that
// file; real synchronous-data-store-backed adversarial concurrency tests
// live in keep-going-dispatch-loop-concurrency.test.mjs.
import assert from 'node:assert/strict'
import test from 'node:test'
import path from 'node:path'
import { createOvernightRun } from '../domain/keep-going.mjs'
import { tickKeepGoingRun } from '../server/keep-going-dispatch-loop.mjs'

// M5: see keep-going-dispatch-loop.test.mjs's own identical comment --
// dispatchStep's new real capacity check shares orca-orchestration-
// bridge.mjs's TSF_ORCA_CLI_COMMAND resolution; pointing it at the stub
// CLI keeps every test here fast and hermetic.
process.env.TSF_ORCA_CLI_COMMAND = path.join(import.meta.dirname, 'fixtures', 'stub-orca-cli.mjs')
process.env.STUB_ORCA_MODE = 'success'
// Main TSF Resource Pressure Governor integration review: forced HEALTHY,
// same seam http-resource-pressure-governor.test.mjs uses.
process.env.TSF_RESOURCE_PRESSURE_TEST_TOTAL_BYTES = String(16 * 1024 ** 3)
process.env.TSF_RESOURCE_PRESSURE_TEST_FREE_BYTES = String(8 * 1024 ** 3)
// See keep-going-dispatch-loop.test.mjs's own identical comment.
delete process.env.ORCA_TERMINAL_HANDLE

const clock = () => new Date('2026-08-20T05:00:00.000Z')
const PROJECT_ID = 'fixture:proj'

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

const oneItem = [{ id: 't1', scope: ['src/a.mjs'], worktree: 'C:/repo/wt1' }]

test('startOrchestrationWorker is called with the resolved fresh-terminal placement (worktree/agent), not just task', async () => {
  const store = makeFakeStore(baseRun())
  let seenArgs = null
  await tickKeepGoingRun(
    PROJECT_ID,
    [{ id: 't1', scope: ['src/a.mjs'], worktree: 'C:/repo/wt1', agent: 'claude' }],
    clock,
    {
      orchestration: okOrchestration({
        startOrchestrationWorker: async (args) => {
          seenArgs = args
          return { ok: true, result: { taskId: args.task, dispatchId: 'ctx-1', state: 'ready' } }
        }
      }),
      store
    }
  )
  assert.equal(seenArgs.worktree, 'C:/repo/wt1')
  assert.equal(seenArgs.agent, 'claude')
  assert.equal(seenArgs.terminal, undefined)
})

test('startOrchestrationWorker is called with the resolved terminal-reuse placement, omitting worktree/agent', async () => {
  const store = makeFakeStore(baseRun())
  let seenArgs = null
  await tickKeepGoingRun(
    PROJECT_ID,
    [{ id: 't1', scope: ['src/a.mjs'], workerTerminal: 'term_existing' }],
    clock,
    {
      orchestration: okOrchestration({
        startOrchestrationWorker: async (args) => {
          seenArgs = args
          return { ok: true, result: { taskId: args.task, dispatchId: 'ctx-1', state: 'ready' } }
        }
      }),
      store
    }
  )
  assert.equal(seenArgs.terminal, 'term_existing')
  assert.equal(seenArgs.worktree, undefined)
  assert.equal(seenArgs.agent, undefined)
})

test('a startOrchestrationWorker failure reports DISPATCH_FAILED honestly, distinct from a createOrchestrationTask failure', async () => {
  const store = makeFakeStore(baseRun())
  const result = await tickKeepGoingRun(PROJECT_ID, oneItem, clock, {
    orchestration: okOrchestration({
      startOrchestrationWorker: async () => ({
        ok: false,
        reason: 'CLI_ERROR',
        detail: 'agent failed to become ready'
      })
    }),
    store
  })
  assert.equal(result.action, 'DISPATCH_FAILED')
  assert.equal(result.reason, 'CLI_ERROR')
})

test('two independent (disjoint-scope) items in the same batch that would both land fresh agents in the SAME explicit worktree are refused, not silently collided', async () => {
  const store = makeFakeStore(baseRun())
  const sameWorktreeItems = [
    { id: 't1', scope: ['src/a.mjs'], worktree: 'C:/repo/shared-wt' },
    { id: 't2', scope: ['src/b.mjs'], worktree: 'C:/repo/shared-wt' }
  ]
  let startCalls = 0
  const result = await tickKeepGoingRun(PROJECT_ID, sameWorktreeItems, clock, {
    orchestration: okOrchestration({
      startOrchestrationWorker: async (args) => {
        startCalls += 1
        return { ok: true, result: { taskId: args.task, dispatchId: 'ctx-1', state: 'ready' } }
      }
    }),
    store
  })
  assert.equal(result.action, 'DISPATCH_FAILED')
  assert.equal(result.reason, 'UNSAFE_PLACEMENT_COLLISION')
  assert.equal(startCalls, 0, 'neither colliding item should have been dispatched')
})

test('two independent items in the same batch with distinct explicit worktrees do not collide', async () => {
  const store = makeFakeStore(baseRun())
  const distinctItems = [
    { id: 't1', scope: ['src/a.mjs'], worktree: 'C:/repo/wt1' },
    { id: 't2', scope: ['src/b.mjs'], worktree: 'C:/repo/wt2' }
  ]
  const result = await tickKeepGoingRun(PROJECT_ID, distinctItems, clock, {
    orchestration: okOrchestration(),
    store
  })
  assert.equal(result.action, 'WAVE_DISPATCHED')
  assert.equal(result.dispatchRecords.length, 2)
})

test('two overlapping-scope items forced into SEPARATE batches, both explicitly targeting the SAME worktree, are still refused as a collision (checked across the whole wave, not per batch)', async () => {
  const store = makeFakeStore(baseRun({ budget: { maxConcurrentWorkers: 2 } }))
  let startCalls = 0
  const overlappingScopeItems = [
    { id: 't1', scope: ['src/shared.mjs'], worktree: 'C:/repo/shared-wt' },
    { id: 't2', scope: ['src/shared.mjs'], worktree: 'C:/repo/shared-wt' }
  ]
  const result = await tickKeepGoingRun(PROJECT_ID, overlappingScopeItems, clock, {
    orchestration: okOrchestration({
      startOrchestrationWorker: async (args) => {
        startCalls += 1
        return { ok: true, result: { taskId: args.task, dispatchId: 'ctx-1', state: 'ready' } }
      }
    }),
    store
  })
  assert.equal(result.action, 'DISPATCH_FAILED')
  assert.equal(result.reason, 'UNSAFE_PLACEMENT_COLLISION')
  assert.equal(startCalls, 0)
})

test('two items reusing the identical existing workerTerminal collide too, not just fresh-worktree placements', async () => {
  const store = makeFakeStore(baseRun())
  let startCalls = 0
  const sameTerminalItems = [
    { id: 't1', scope: ['src/a.mjs'], workerTerminal: 'term_existing' },
    { id: 't2', scope: ['src/b.mjs'], workerTerminal: 'term_existing' }
  ]
  const result = await tickKeepGoingRun(PROJECT_ID, sameTerminalItems, clock, {
    orchestration: okOrchestration({
      startOrchestrationWorker: async (args) => {
        startCalls += 1
        return { ok: true, result: { taskId: args.task, dispatchId: 'ctx-1', state: 'ready' } }
      }
    }),
    store
  })
  assert.equal(result.action, 'DISPATCH_FAILED')
  assert.equal(result.reason, 'UNSAFE_PLACEMENT_COLLISION')
  assert.equal(startCalls, 0)
})

test('worktree collision detection normalizes slash direction and case (Windows path variants)', async () => {
  const store = makeFakeStore(baseRun())
  const windowsVariantItems = [
    { id: 't1', scope: ['src/a.mjs'], worktree: 'C:/Repo/WT1' },
    { id: 't2', scope: ['src/b.mjs'], worktree: 'c:\\repo\\wt1\\' }
  ]
  const result = await tickKeepGoingRun(PROJECT_ID, windowsVariantItems, clock, {
    orchestration: okOrchestration(),
    store
  })
  assert.equal(result.action, 'DISPATCH_FAILED')
  assert.equal(result.reason, 'UNSAFE_PLACEMENT_COLLISION')
})

test('collision detection does not lowercase-fold case-sensitive selector forms (branch:/name:/id:/issue:/path:)', async () => {
  const store = makeFakeStore(baseRun())
  const distinctBranchItems = [
    { id: 't1', scope: ['src/a.mjs'], worktree: 'branch:Feature-X' },
    { id: 't2', scope: ['src/b.mjs'], worktree: 'branch:feature-x' }
  ]
  const result = await tickKeepGoingRun(PROJECT_ID, distinctBranchItems, clock, {
    orchestration: okOrchestration(),
    store
  })
  assert.equal(
    result.action,
    'WAVE_DISPATCHED',
    'two distinct case-differing branch selectors must not be treated as the same place'
  )
  assert.equal(result.dispatchRecords.length, 2)
})

test('duplicate candidate work item ids never cause one dispatch to silently use the wrong placement', async () => {
  const store = makeFakeStore(baseRun({ budget: { maxConcurrentWorkers: 1 } }))
  const seenPlacements = []
  const duplicateIdItems = [
    { id: 't1', scope: ['src/a.mjs'], worktree: 'C:/repo/a' },
    { id: 't1', scope: ['src/b.mjs'], worktree: 'C:/repo/b' }
  ]
  await tickKeepGoingRun(PROJECT_ID, duplicateIdItems, clock, {
    orchestration: okOrchestration({
      startOrchestrationWorker: async (args) => {
        seenPlacements.push(args.worktree)
        return { ok: true, result: { taskId: args.task, dispatchId: 'ctx-1', state: 'ready' } }
      }
    }),
    store
  })
  assert.deepEqual(
    seenPlacements,
    ['C:/repo/a', 'C:/repo/b'],
    "each dispatch must use its OWN item worktree, never the other duplicate-id item's"
  )
})

test('retryOf is threaded through even when reusing an existing terminal, not only on a fresh placement', async () => {
  const store = makeFakeStore(baseRun())
  let seenArgs = null
  await tickKeepGoingRun(
    PROJECT_ID,
    [{ id: 't1', scope: ['src/a.mjs'], workerTerminal: 'term_existing', retryOf: 'ctx_prior' }],
    clock,
    {
      orchestration: okOrchestration({
        startOrchestrationWorker: async (args) => {
          seenArgs = args
          return { ok: true, result: { taskId: args.task, dispatchId: 'ctx-1', state: 'ready' } }
        }
      }),
      store
    }
  )
  assert.equal(seenArgs.terminal, 'term_existing')
  assert.equal(seenArgs.retryOf, 'ctx_prior')
})

test('a work item with neither an explicit worktree nor a workerTerminal is refused honestly, never silently defaulted (a real, live-confirmed safety finding)', async () => {
  const store = makeFakeStore(baseRun())
  let taskCreateCalls = 0
  let runCreateCalls = 0
  const result = await tickKeepGoingRun(PROJECT_ID, [{ id: 't1', scope: ['src/a.mjs'] }], clock, {
    orchestration: okOrchestration({
      createOrchestrationRun: async () => {
        runCreateCalls += 1
        return { ok: true, result: { run: { id: 'orch-run-1' } } }
      },
      createOrchestrationTask: async ({ taskTitle }) => {
        taskCreateCalls += 1
        return { ok: true, result: { task: { id: `task-${taskTitle}` } } }
      }
    }),
    store
  })
  assert.equal(result.action, 'DISPATCH_FAILED')
  assert.equal(result.reason, 'TSF_MISSING_PLACEMENT')
  assert.equal(taskCreateCalls, 0, 'no real Orca task may be created without an explicit placement')
  assert.equal(
    runCreateCalls,
    0,
    'the guard must fire before ANY CLI call, including createOrchestrationRun'
  )
})

test('a non-string worktree value (e.g. a number, reachable from untrusted input) is treated as missing, not thrown on', async () => {
  const store = makeFakeStore(baseRun())
  const result = await tickKeepGoingRun(
    PROJECT_ID,
    [{ id: 't1', scope: ['src/a.mjs'], worktree: 0 }],
    clock,
    { orchestration: okOrchestration(), store }
  )
  assert.equal(result.action, 'DISPATCH_FAILED')
  assert.equal(result.reason, 'TSF_MISSING_PLACEMENT')
})

test('a work item with an empty-string worktree and no workerTerminal is refused the same way, not silently treated as missing entirely', async () => {
  const store = makeFakeStore(baseRun())
  const result = await tickKeepGoingRun(
    PROJECT_ID,
    [{ id: 't1', scope: ['src/a.mjs'], worktree: '   ' }],
    clock,
    { orchestration: okOrchestration(), store }
  )
  assert.equal(result.action, 'DISPATCH_FAILED')
  assert.equal(result.reason, 'TSF_MISSING_PLACEMENT')
})

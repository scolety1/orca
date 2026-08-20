import assert from 'node:assert/strict'
import test from 'node:test'
import { createOvernightRun, dispatchWave, markStalled, planWave } from '../domain/keep-going.mjs'
import { abandonAndReconcileStalledWave } from '../server/keep-going-dispatch-loop.mjs'

// Covers the gap a live manual UI acceptance retest actually hit: abandoning
// a stalled wave cleared TSF's own bookkeeping but never told Orca the
// dispatch was done, leaving its worktree resource marked owned there --
// silently blocking a later worker-start into the same worktree. See
// keep-going-dispatch-loop.mjs's abandonAndReconcileStalledWave.
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

// Builds a genuinely STALLED run holding one or more in-flight dispatch
// records, exactly as a real settleStep stall escalation would leave it.
function stalledRunWithDispatches(dispatchRecords) {
  let run = baseRun()
  const plan = planWave(
    run,
    dispatchRecords.map((r) => ({ id: r.workItemId, scope: r.scope })),
    clock
  )
  run = dispatchWave(run, plan, dispatchRecords, clock, run.revision)
  run = markStalled(
    run,
    dispatchRecords.map((r) => ({ dispatchId: r.dispatchId })),
    clock
  )
  return run
}

test('abandonAndReconcileStalledWave clears the wave, resumes to ACTIVE, and releases the real Orca dispatch', async () => {
  const stalled = stalledRunWithDispatches([
    { workItemId: 't1', scope: ['src/a.mjs'], taskId: 'task-1', dispatchId: 'ctx-1' }
  ])
  const store = makeFakeStore(stalled)
  const abandonCalls = []
  const result = await abandonAndReconcileStalledWave(
    PROJECT_ID,
    'stalled, recovering',
    clock,
    stalled.revision,
    {
      store,
      orchestration: {
        abandonOrchestrationWorker: async ({ dispatch }) => {
          abandonCalls.push(dispatch)
          return { ok: true, result: { dispatch: { id: dispatch, status: 'fenced' } } }
        }
      }
    }
  )
  assert.equal(
    result.run.state,
    'ACTIVE',
    'auto-resumed, not left stuck STALLED with no affordance'
  )
  assert.equal(result.run.inFlightWave, null)
  assert.deepEqual(abandonCalls, ['ctx-1'])
  assert.deepEqual(result.orchestrationReconciliation, [
    { dispatchId: 'ctx-1', ok: true, reason: null }
  ])
})

test('abandonAndReconcileStalledWave releases every dispatch in a multi-item wave, not just the first', async () => {
  const stalled = stalledRunWithDispatches([
    { workItemId: 't1', scope: ['src/a.mjs'], taskId: 'task-1', dispatchId: 'ctx-1' },
    { workItemId: 't2', scope: ['src/b.mjs'], taskId: 'task-2', dispatchId: 'ctx-2' }
  ])
  const store = makeFakeStore(stalled)
  const abandonCalls = []
  const result = await abandonAndReconcileStalledWave(
    PROJECT_ID,
    'stalled, recovering',
    clock,
    stalled.revision,
    {
      store,
      orchestration: {
        abandonOrchestrationWorker: async ({ dispatch }) => {
          abandonCalls.push(dispatch)
          return { ok: true, result: {} }
        }
      }
    }
  )
  assert.deepEqual(abandonCalls.sort(), ['ctx-1', 'ctx-2'])
  assert.equal(result.orchestrationReconciliation.length, 2)
})

test('a failed Orca-side reconciliation is reported but does not undo the already-succeeded TSF-side abandon', async () => {
  const stalled = stalledRunWithDispatches([
    { workItemId: 't1', scope: ['src/a.mjs'], taskId: 'task-1', dispatchId: 'ctx-1' }
  ])
  const store = makeFakeStore(stalled)
  const result = await abandonAndReconcileStalledWave(
    PROJECT_ID,
    'stalled, recovering',
    clock,
    stalled.revision,
    {
      store,
      orchestration: {
        abandonOrchestrationWorker: async () => ({
          ok: false,
          reason: 'CLI_ERROR',
          detail: 'dispatch already gone'
        })
      }
    }
  )
  assert.equal(
    result.run.state,
    'ACTIVE',
    'TSF-side recovery is not held hostage by Orca cooperating'
  )
  assert.equal(result.run.inFlightWave, null)
  assert.deepEqual(result.orchestrationReconciliation, [
    { dispatchId: 'ctx-1', ok: false, reason: 'CLI_ERROR' }
  ])
})

test('an exception from the Orca-side call is caught and reported, not left to crash the whole abandon', async () => {
  const stalled = stalledRunWithDispatches([
    { workItemId: 't1', scope: ['src/a.mjs'], taskId: 'task-1', dispatchId: 'ctx-1' }
  ])
  const store = makeFakeStore(stalled)
  const result = await abandonAndReconcileStalledWave(
    PROJECT_ID,
    'stalled, recovering',
    clock,
    stalled.revision,
    {
      store,
      orchestration: {
        abandonOrchestrationWorker: async () => {
          throw new Error('network exploded')
        }
      }
    }
  )
  assert.equal(result.run.state, 'ACTIVE')
  assert.deepEqual(result.orchestrationReconciliation, [
    { dispatchId: 'ctx-1', ok: false, reason: 'network exploded' }
  ])
})

test('when the TSF-side abandon itself fails (run is not STALLED), no Orca reconciliation is attempted at all', async () => {
  const active = baseRun()
  const store = makeFakeStore(active)
  let abandonCalled = false
  await assert.rejects(
    () =>
      abandonAndReconcileStalledWave(PROJECT_ID, 'not actually stalled', clock, active.revision, {
        store,
        orchestration: {
          abandonOrchestrationWorker: async () => {
            abandonCalled = true
            return { ok: true, result: {} }
          }
        }
      }),
    (error) => error.code === 'TSF_RUN_NOT_STALLED'
  )
  assert.equal(
    abandonCalled,
    false,
    'a rejected TSF-side commit must not still touch real Orca state'
  )
})

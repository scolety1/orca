// Resource-Wait Auto-Resume V1: recordPendingDispatch/pendingDispatch's own
// domain-level behavior -- split out of keep-going.test.mjs (which was
// already at its own max-lines cap) rather than growing that file further,
// same reasoning keep-going-dispatch-loop-*.test.mjs already established
// for this module's server-side counterpart.
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createOvernightRun,
  dispatchWave,
  planWave,
  recordPendingDispatch
} from '../domain/keep-going.mjs'

const clock = () => new Date('2026-08-19T18:00:00.000Z')

function baseRun(overrides = {}) {
  return createOvernightRun(
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
}

test('recordPendingDispatch durably records the exact candidateWorkItems a resource-refused first-wave attempt tried to place', () => {
  let run = baseRun()
  assert.equal(run.pendingDispatch, null)
  const items = [{ id: 't1', scope: ['src/a.mjs'], worktree: 'C:/repo/wt1' }]
  run = recordPendingDispatch(run, items, clock, 0)
  assert.equal(run.revision, 1)
  assert.deepEqual(run.pendingDispatch.candidateWorkItems, items)
  assert.equal(run.pendingDispatch.recordedAt, clock().toISOString())

  // A later, corrected/updated attempt overwrites the earlier record --
  // a resume should always replay the MOST RECENT real attempt, not a
  // stale earlier one.
  const updatedItems = [{ id: 't1', scope: ['src/b.mjs'], worktree: 'C:/repo/wt1' }]
  run = recordPendingDispatch(run, updatedItems, clock, 1)
  assert.deepEqual(run.pendingDispatch.candidateWorkItems, updatedItems)

  assert.throws(
    () => recordPendingDispatch(run, items, clock, 0), // stale
    (error) => error.code === 'TSF_STALE_REVISION'
  )
  assert.throws(() => recordPendingDispatch(run, [], clock, run.revision), /at least one candidate work item/)
})

test('dispatchWave clears any pending-first-wave-dispatch record once a real wave actually dispatches', () => {
  let run = baseRun()
  run = recordPendingDispatch(run, [{ id: 't1', scope: ['src/a.mjs'], worktree: 'C:/repo/wt1' }], clock, 0)
  assert.ok(run.pendingDispatch)

  const plan = planWave(run, [{ id: 't1', scope: ['src/a.mjs'] }], clock)
  const dispatchRecords = [
    { workItemId: 't1', scope: ['src/a.mjs'], taskId: 'task-1', dispatchId: 'ctx-1' }
  ]
  run = dispatchWave(run, plan, dispatchRecords, clock, run.revision)
  assert.equal(run.pendingDispatch, null, 'a real wave now exists -- the pending-first-wave record is resolved')
})

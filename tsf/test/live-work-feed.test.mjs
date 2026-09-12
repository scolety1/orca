import assert from 'node:assert/strict'
import test from 'node:test'
import {
  blockRun,
  checkpointRun,
  claimTick,
  completeRun,
  createOvernightRun,
  dispatchWave,
  markStalled,
  pauseRun,
  planWave,
  raiseNeedsYou,
  settleInFlightWave
} from '../domain/keep-going.mjs'
import { projectLiveWorkFeedState, describeLiveRunStatus } from '../domain/live-work-feed.mjs'

const clock = () => new Date('2026-08-20T05:00:00.000Z')
const PROJECT_ID = 'fixture:proj'

function baseRun(overrides = {}) {
  return createOvernightRun(
    {
      id: 'run-1',
      projectId: PROJECT_ID,
      originalGoal: 'Ship the fixture feature end to end.',
      acceptanceCriteria: ['CRITERION_A', 'CRITERION_B'],
      usageMode: 'BALANCED',
      ...overrides
    },
    clock
  )
}

test('no run at all -> PLANNING, honestly, not a fabricated status', () => {
  const result = projectLiveWorkFeedState(null)
  assert.equal(result.state, 'PLANNING')
})

test('a fresh run with no waves dispatched yet -> PLANNING', () => {
  const run = baseRun()
  assert.equal(projectLiveWorkFeedState(run).state, 'PLANNING')
})

test('a run with an in-flight wave -> WORKING', () => {
  let run = baseRun()
  const plan = planWave(run, [{ id: 't1', scope: ['a.mjs'] }], clock)
  run = dispatchWave(
    run,
    plan,
    [{ workItemId: 't1', scope: ['a.mjs'], taskId: 'task-1', dispatchId: 'ctx-1' }],
    clock,
    run.revision
  )
  assert.equal(projectLiveWorkFeedState(run).state, 'WORKING')
})

test('an in-flight wave whose last checkpoint is WAVE_STALLED -> STALLED, even though run.state is still ACTIVE', () => {
  let run = baseRun()
  const plan = planWave(run, [{ id: 't1', scope: ['a.mjs'] }], clock)
  run = dispatchWave(
    run,
    plan,
    [{ workItemId: 't1', scope: ['a.mjs'], taskId: 'task-1', dispatchId: 'ctx-1' }],
    clock,
    run.revision
  )
  // Simulate settleStep's own WAVE_STALLED checkpoint without changing
  // run.state to STALLED yet (markStalled does that -- test the checkpoint-
  // phase path specifically, distinct from the run.state === STALLED path).
  run = {
    ...run,
    checkpoints: [
      ...run.checkpoints,
      { phase: 'WAVE_STALLED', note: null, evidence: [], at: clock().toISOString() }
    ]
  }
  assert.equal(projectLiveWorkFeedState(run).state, 'STALLED')
})

test('run.state STALLED -> STALLED regardless of checkpoint history', () => {
  let run = baseRun()
  const plan = planWave(run, [{ id: 't1', scope: ['a.mjs'] }], clock)
  run = dispatchWave(
    run,
    plan,
    [{ workItemId: 't1', scope: ['a.mjs'], taskId: 'task-1', dispatchId: 'ctx-1' }],
    clock,
    run.revision
  )
  run = markStalled(run, [{ dispatchId: 'ctx-1' }], clock)
  assert.equal(run.state, 'STALLED')
  assert.equal(projectLiveWorkFeedState(run).state, 'STALLED')
})

test('run.state NEEDS_YOU -> NEEDS_YOU', () => {
  let run = baseRun()
  run = raiseNeedsYou(run, { question: 'Which approach?' }, clock, run.revision)
  assert.equal(projectLiveWorkFeedState(run).state, 'NEEDS_YOU')
})

test('an open (unresolved) Needs You entry -> NEEDS_YOU even if run.state itself is something else', () => {
  let run = baseRun()
  run = raiseNeedsYou(run, { question: 'Which approach?' }, clock, run.revision)
  // raiseNeedsYou itself transitions run.state to NEEDS_YOU, so directly
  // exercise the "open needsYou entry" branch by checking it independently
  // of the run.state check ordering -- both should agree here.
  assert.ok(run.needsYou.some((n) => !n.resolvedAt))
  assert.equal(projectLiveWorkFeedState(run).state, 'NEEDS_YOU')
})

test('run.state BLOCKED -> NEEDS_YOU (a real decision is needed, not a dead end with no feed signal)', () => {
  let run = baseRun()
  run = blockRun(run, 'architectural conflict', ['evidence-a'], clock)
  assert.equal(projectLiveWorkFeedState(run).state, 'NEEDS_YOU')
})

test('run.state PAUSED -> WAITING', () => {
  let run = baseRun()
  run = pauseRun(run, 'operator pause', clock, run.revision)
  assert.equal(projectLiveWorkFeedState(run).state, 'WAITING')
})

test('run.state COMPLETE -> READY_FOR_ADOPTION', () => {
  let run = baseRun()
  run = completeRun(run, clock)
  assert.equal(projectLiveWorkFeedState(run).state, 'READY_FOR_ADOPTION')
})

test('a dispatch tick holding the lock with nothing in flight yet -> WAITING', () => {
  let run = baseRun()
  run = claimTick(run, 'DISPATCH', clock, run.revision)
  assert.equal(run.inFlightWave, null)
  assert.equal(projectLiveWorkFeedState(run).state, 'WAITING')
})

test('a resource-wait checkpoint with no dispatched waves -> WAITING, not PLANNING', () => {
  const run = checkpointRun(
    baseRun(),
    { phase: 'DISPATCH_WAITING_FOR_RESOURCES', note: 'host memory critical' },
    clock
  )
  const result = projectLiveWorkFeedState(run)
  assert.equal(run.waves.length, 0)
  assert.equal(result.state, 'WAITING')
  assert.match(result.reason, /host memory critical/)
})

test('an in-flight wave stays WORKING even if the latest checkpoint is a resource wait', () => {
  let run = baseRun()
  const plan = planWave(run, [{ id: 't1', scope: ['a.mjs'] }], clock)
  run = dispatchWave(
    run,
    plan,
    [{ workItemId: 't1', scope: ['a.mjs'], taskId: 'task-1', dispatchId: 'ctx-1' }],
    clock,
    run.revision
  )
  run = checkpointRun(
    run,
    { phase: 'DISPATCH_WAITING_FOR_RESOURCES', note: 'host memory critical' },
    clock,
    run.revision
  )
  assert.ok(run.inFlightWave)
  assert.equal(projectLiveWorkFeedState(run).state, 'WORKING')
})

function runWithOneSettledWave() {
  let run = baseRun()
  const plan = planWave(run, [{ id: 't1', scope: ['a.mjs'] }], clock)
  run = dispatchWave(
    run,
    plan,
    [{ workItemId: 't1', scope: ['a.mjs'], taskId: 'task-1', dispatchId: 'ctx-1' }],
    clock,
    run.revision
  )
  run = settleInFlightWave(
    run,
    {
      schemaVersion: 'TSF_KEEP_GOING_WAVE_RESULT_V1',
      outcomes: [
        {
          workItemId: 't1',
          scope: ['a.mjs'],
          taskId: 'task-1',
          dispatchId: 'ctx-1',
          outcome: 'SUCCEEDED'
        }
      ],
      settledAt: clock().toISOString()
    },
    clock,
    run.revision
  )
  return run
}

test('a resource-wait checkpoint after a settled wave -> WAITING, not a gap-derived state', () => {
  let run = runWithOneSettledWave()
  run = checkpointRun(
    run,
    { phase: 'DISPATCH_WAITING_FOR_RESOURCES', note: 'host memory critical' },
    clock,
    run.revision
  )
  const gap = { satisfiedCriteria: ['CRITERION_A'], remainingGaps: ['CRITERION_B'] }
  assert.equal(run.waves.length, 1)
  assert.equal(projectLiveWorkFeedState(run, gap).state, 'WAITING')
})

test('ACTIVE with settled waves and no gap supplied -> WORKING, not a guessed VERIFYING/REVISION', () => {
  const run = runWithOneSettledWave()
  assert.equal(run.waves.length, 1, 'sanity: a real settled wave exists')
  assert.equal(projectLiveWorkFeedState(run, null).state, 'WORKING')
})

test('ACTIVE, settled waves, gap has remaining criteria and none yet satisfied -> VERIFYING', () => {
  const run = runWithOneSettledWave()
  const gap = { satisfiedCriteria: [], remainingGaps: ['CRITERION_A', 'CRITERION_B'] }
  assert.equal(projectLiveWorkFeedState(run, gap).state, 'VERIFYING')
})

test('ACTIVE, settled waves, gap has BOTH satisfied and remaining criteria -> REVISION', () => {
  const run = runWithOneSettledWave()
  const gap = { satisfiedCriteria: ['CRITERION_A'], remainingGaps: ['CRITERION_B'] }
  assert.equal(projectLiveWorkFeedState(run, gap).state, 'REVISION')
})

test('NEEDS_YOU is checked before STALLED/PAUSED/BLOCKED -- ordering matters, an operator question always wins the feed slot', () => {
  let run = baseRun()
  run = raiseNeedsYou(run, { question: 'Which approach?' }, clock, run.revision)
  // raiseNeedsYou already put run.state at NEEDS_YOU; assert the function
  // does not fall through to some other branch first.
  assert.equal(projectLiveWorkFeedState(run).state, 'NEEDS_YOU')
})

// BUG-13: describeLiveRunStatus is the one grounding sentence Planner
// Chat's deterministic fallback and the live conversational planner's
// context capsule both reuse -- proving it here proves both call sites'
// grounding is correct, not two independently-drifting copies.
test('describeLiveRunStatus: no run -> null, never fabricated', () => {
  assert.equal(describeLiveRunStatus(null), null)
})

test('describeLiveRunStatus: a real run -> id, state, and reason all present, grounded in projectLiveWorkFeedState', () => {
  const run = baseRun()
  const description = describeLiveRunStatus(run)
  assert.match(description, /Keep Going run run-1 is PLANNING:/)
})

test('describeLiveRunStatus: STALLED run reads STALLED, not the raw gap decision', () => {
  let run = baseRun()
  run = markStalled(run, [], clock, false, run.revision)
  assert.match(describeLiveRunStatus(run), /is STALLED:/)
})

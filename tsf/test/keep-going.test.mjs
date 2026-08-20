import assert from 'node:assert/strict'
import test from 'node:test'
import {
  checkpointRun,
  compareStateToGoal,
  completeRun,
  createOvernightRun,
  detectStall,
  dispatchWave,
  markStalled,
  pauseRun,
  planWave,
  raiseNeedsYou,
  recordTaskAttempt,
  recordWave,
  replaceGoal,
  resolveNeedsYou,
  resumeRun,
  settleInFlightWave,
  summarizeRun,
  transitionRun
} from '../domain/keep-going.mjs'

const clock = () => new Date('2026-08-19T18:00:00.000Z')
const goal = 'Ship the fixture feature end to end.'
const criteria = ['CRITERION_A', 'CRITERION_B']

function baseRun(overrides = {}) {
  return createOvernightRun(
    {
      id: 'run-1',
      projectId: 'fixture:proj',
      originalGoal: goal,
      acceptanceCriteria: criteria,
      usageMode: 'BALANCED',
      ...overrides
    },
    clock
  )
}

test('createOvernightRun requires id, project, and at least one acceptance criterion', () => {
  const run = baseRun()
  assert.equal(run.state, 'ACTIVE')
  assert.deepEqual(run.originalGoal.acceptanceCriteria, criteria)
  assert.throws(
    () => Object.isFrozen(run.originalGoal) && (run.originalGoal.statement = 'mutated'),
    TypeError
  )
  assert.throws(
    () =>
      createOvernightRun(
        { id: 'r', projectId: 'p', originalGoal: 'g', acceptanceCriteria: [] },
        clock
      ),
    /at least one acceptance criterion/
  )
})

test('the original goal is immutable unless Tim explicitly authorizes a replacement', () => {
  const run = baseRun()
  assert.throws(
    () =>
      replaceGoal(
        run,
        { statement: 'new goal', acceptanceCriteria: ['X'] },
        { authorizedBy: 'PLANNER', reason: 'drift' },
        clock
      ),
    /explicit Tim authorization/
  )
  const replaced = replaceGoal(
    run,
    { statement: 'new goal', acceptanceCriteria: ['X'] },
    { authorizedBy: 'TIM', reason: 'Tim changed scope' },
    clock
  )
  assert.equal(replaced.originalGoal.statement, 'new goal')
  assert.equal(replaced.goalHistory.length, 1)
  assert.equal(replaced.goalHistory[0].previous.statement, goal)
})

test('gap analysis only trusts independently-verified criteria, never worker self-report', () => {
  const run = baseRun()
  const partial = compareStateToGoal(run, { verifiedSatisfied: ['CRITERION_A'] }, clock)
  assert.equal(partial.decision, 'CONTINUE')
  assert.deepEqual(partial.remainingGaps, ['CRITERION_B'])

  const complete = compareStateToGoal(run, { verifiedSatisfied: criteria }, clock)
  assert.equal(complete.decision, 'STOP_COMPLETE')
  assert.deepEqual(complete.remainingGaps, [])

  const blocked = compareStateToGoal(
    run,
    { verifiedSatisfied: [], blockers: ['credential required'] },
    clock
  )
  assert.equal(blocked.decision, 'STOP_BLOCKED')

  assert.throws(
    () => compareStateToGoal(run, { verifiedSatisfied: ['NOT_A_REAL_CRITERION'] }, clock),
    /not part of the original goal/
  )
})

test('gap analysis stops for budget exhaustion once maxWaves is reached', () => {
  let run = baseRun({ budget: { maxWaves: 1 } })
  const plan = planWave(run, [{ id: 't1', scope: ['src/a.mjs'] }], clock)
  run = recordWave(run, plan, { outcome: 'SUCCEEDED' }, clock)
  const analysis = compareStateToGoal(run, { verifiedSatisfied: ['CRITERION_A'] }, clock)
  assert.equal(analysis.decision, 'STOP_BUDGET_EXHAUSTED')
})

test('planWave batches non-conflicting work items in parallel up to the concurrency cap', () => {
  const run = baseRun({ budget: { maxConcurrentWorkers: 2 } })
  const plan = planWave(
    run,
    [
      { id: 'normalize', scope: ['src/normalize.mjs'] },
      { id: 'filter', scope: ['src/filter.mjs'] },
      { id: 'health', scope: ['src/health.mjs'] }
    ],
    clock
  )
  assert.equal(plan.waveNumber, 1)
  assert.equal(plan.batches.flat().length, 3)
  assert.ok(plan.batches.every((batch) => batch.length <= 2))
  assert.equal(plan.conflictNotes.length, 0)
})

test('planWave serializes work items with overlapping scope into separate batches', () => {
  const run = baseRun()
  const plan = planWave(
    run,
    [
      { id: 'edit-a', scope: ['tsf/domain/coordinator.mjs'] },
      { id: 'edit-b', scope: ['tsf/domain/coordinator.mjs', 'tsf/domain/health.mjs'] },
      { id: 'edit-c', scope: ['tsf/ui/src/App.tsx'] }
    ],
    clock
  )
  const batchOf = (id) => plan.batches.findIndex((batch) => batch.some((item) => item.id === id))
  assert.notEqual(batchOf('edit-a'), batchOf('edit-b'))
  assert.equal(batchOf('edit-a'), batchOf('edit-c'))
  assert.equal(plan.conflictNotes.length, 1)
  assert.deepEqual([plan.conflictNotes[0].a, plan.conflictNotes[0].b].sort(), ['edit-a', 'edit-b'])
})

test('planWave rejects an empty candidate list and items missing scope', () => {
  const run = baseRun()
  assert.throws(() => planWave(run, [], clock), /at least one candidate work item/)
  assert.throws(
    () => planWave(run, [{ id: 'x', scope: [] }], clock),
    /requires id and a non-empty scope/
  )
})

test('recordWave is idempotent — replaying a settled wave never duplicates it', () => {
  let run = baseRun()
  const plan = planWave(run, [{ id: 't1', scope: ['src/a.mjs'] }], clock)
  const result = { outcome: 'SUCCEEDED', verifierVerdict: 'GREEN' }
  run = recordWave(run, plan, result, clock)
  run = recordWave(run, plan, result, clock)
  assert.equal(run.waves.length, 1)
})

test('recordWave, recordTaskAttempt, and checkpointRun bump revision and honor expectedRevision, but a replayed wave does not', () => {
  let run = baseRun()
  assert.equal(run.revision, 0)
  const plan = planWave(run, [{ id: 't1', scope: ['src/a.mjs'] }], clock)
  const result = { outcome: 'SUCCEEDED', verifierVerdict: 'GREEN' }

  run = recordWave(run, plan, result, clock, 0)
  assert.equal(run.revision, 1)
  assert.throws(
    () => recordWave(run, { ...plan, waveNumber: 2 }, result, clock, 0), // stale
    (error) => error.code === 'TSF_STALE_REVISION'
  )
  // A genuine replay (same plan+result digest) is idempotent and does not
  // touch revision at all, regardless of a stale expectedRevision -- it
  // was never going to write.
  const replayed = recordWave(run, plan, result, clock, 0)
  assert.equal(replayed.revision, 1)

  run = recordTaskAttempt(run, 'flaky', 'RETRY', clock, 1)
  assert.equal(run.revision, 2)
  assert.throws(
    () => recordTaskAttempt(run, 'flaky', 'RETRY', clock, 1), // stale
    (error) => error.code === 'TSF_STALE_REVISION'
  )

  run = checkpointRun(run, { phase: 'MID_WAVE' }, clock, 2)
  assert.equal(run.revision, 3)
  assert.throws(
    () => checkpointRun(run, { phase: 'MID_WAVE_AGAIN' }, clock, 2), // stale
    (error) => error.code === 'TSF_STALE_REVISION'
  )
})

test('bounded retry budget rejects a task past its retry limit', () => {
  let run = baseRun({ budget: { maxRetriesPerTask: 1 } })
  run = recordTaskAttempt(run, 'flaky-task', 'RETRY', clock)
  assert.equal(run.retryCounts['flaky-task'], 1)
  assert.throws(() => recordTaskAttempt(run, 'flaky-task', 'RETRY', clock), /retry budget exceeded/)
})

test('stall detection flags workers silent past the threshold', () => {
  const run = baseRun({ budget: { stallThresholdMs: 60_000 } })
  const heartbeats = [
    { dispatchId: 'd1', taskId: 't1', lastHeartbeatAt: '2026-08-19T17:58:00.000Z' }, // 2m silent -> stalled
    { dispatchId: 'd2', taskId: 't2', lastHeartbeatAt: '2026-08-19T17:59:30.000Z' } // 30s silent -> fine
  ]
  const stalled = detectStall(run, heartbeats, clock)
  assert.equal(stalled.length, 1)
  assert.equal(stalled[0].dispatchId, 'd1')
})

test('run-level transitions follow an explicit state machine', () => {
  let run = baseRun()
  run = pauseRun(run, 'operator requested pause', clock)
  assert.equal(run.state, 'PAUSED')
  run = resumeRun(run, clock)
  assert.equal(run.state, 'ACTIVE')
  run = markStalled(run, [{ dispatchId: 'd1' }], clock)
  assert.equal(run.state, 'STALLED')
  assert.throws(() => transitionRun(run, 'COMPLETE', {}, clock), /invalid overnight run transition/)
})

test('pauseRun/resumeRun reject a stale expectedRevision instead of silently overwriting a concurrent transition', () => {
  const run = baseRun()
  assert.equal(run.revision, 0)
  // Simulates two concurrent callers who both read the run at revision 0.
  // The first transition lands and bumps the persisted run to revision 1...
  const paused = pauseRun(run, 'operator pause', clock, 0)
  assert.equal(paused.revision, 1)
  // ...so a second caller acting on the now-current (revision 1) run but
  // still carrying its stale belief that the revision is 0 must be
  // rejected, not silently allowed to clobber the first transition.
  assert.throws(
    () => resumeRun(paused, clock, 0),
    (error) => error.code === 'TSF_STALE_REVISION' || /stale revision/.test(error.message)
  )
  // The correct current revision is accepted.
  const resumed = resumeRun(paused, clock, 1)
  assert.equal(resumed.state, 'ACTIVE')
})

test('Needs You blocks the run until every open question is resolved, then returns to ACTIVE', () => {
  let run = baseRun()
  run = raiseNeedsYou(
    run,
    { question: 'Adopt this candidate?', options: ['ADOPT', 'REJECT'] },
    clock
  )
  assert.equal(run.state, 'NEEDS_YOU')
  const secondQuestion = raiseNeedsYou(run, { question: 'Which branch?' }, clock)
  assert.equal(secondQuestion.needsYou.length, 2)
  run = resolveNeedsYou(secondQuestion, secondQuestion.needsYou[0].id, 'ADOPT', clock)
  assert.equal(run.state, 'NEEDS_YOU', 'still blocked while one question remains open')
  run = resolveNeedsYou(run, run.needsYou[1].id, 'main', clock)
  assert.equal(run.state, 'ACTIVE')
})

test('two Needs You questions with identical text and timestamp never collide into the same id', () => {
  // Same question/taskId under a fixed clock -- exactly the scenario a
  // content+timestamp-only id would collide on, permanently stranding the
  // older entry as unresolvable and the run stuck in NEEDS_YOU forever.
  let run = baseRun()
  run = raiseNeedsYou(run, { question: 'Retry this task?' }, clock)
  run = raiseNeedsYou(run, { question: 'Retry this task?' }, clock)
  assert.equal(run.needsYou.length, 2)
  assert.notEqual(run.needsYou[0].id, run.needsYou[1].id)
  run = resolveNeedsYou(run, run.needsYou[0].id, 'yes', clock)
  run = resolveNeedsYou(run, run.needsYou[1].id, 'yes', clock)
  assert.equal(run.state, 'ACTIVE')
})

test('raiseNeedsYou/resolveNeedsYou bump revision and honor expectedRevision even on their non-transitioning branches', () => {
  let run = baseRun()
  assert.equal(run.revision, 0)
  // First raiseNeedsYou transitions (bumps via transitionRun).
  run = raiseNeedsYou(run, { question: 'Q1?' }, clock, 0)
  assert.equal(run.revision, 1)
  // Second raiseNeedsYou takes the non-transitioning "already NEEDS_YOU"
  // branch -- must still bump revision and honor expectedRevision.
  assert.throws(
    () => raiseNeedsYou(run, { question: 'Q2?' }, clock, 0), // stale
    (error) => error.code === 'TSF_STALE_REVISION'
  )
  run = raiseNeedsYou(run, { question: 'Q2?' }, clock, 1)
  assert.equal(run.revision, 2)
  // resolveNeedsYou's "still open" branch (one of two questions resolved)
  // also skips transitionRun -- must bump revision and honor
  // expectedRevision too.
  assert.throws(
    () => resolveNeedsYou(run, run.needsYou[0].id, 'yes', clock, 0), // stale
    (error) => error.code === 'TSF_STALE_REVISION'
  )
  run = resolveNeedsYou(run, run.needsYou[0].id, 'yes', clock, 2)
  assert.equal(run.revision, 3)
  assert.equal(run.state, 'NEEDS_YOU', 'still blocked while one question remains open')
  // Resolving the last one transitions back to ACTIVE (via transitionRun).
  run = resolveNeedsYou(run, run.needsYou[1].id, 'yes', clock, 3)
  assert.equal(run.state, 'ACTIVE')
  assert.equal(run.revision, 4)
})

test('resolving the last Needs You question does not silently un-pause a run the operator separately paused', () => {
  // PAUSED -> ACTIVE is also a legal transition (RUN_ALLOWED), so a naive
  // "resolve the last question -> always go ACTIVE" would override an
  // operator's explicit pause without their intent.
  let run = baseRun()
  run = raiseNeedsYou(run, { question: 'Proceed?' }, clock)
  assert.equal(run.state, 'NEEDS_YOU')
  run = pauseRun(run, 'operator paused while awaiting the answer', clock)
  assert.equal(run.state, 'PAUSED')
  run = resolveNeedsYou(run, run.needsYou[0].id, 'yes', clock)
  assert.equal(run.state, 'PAUSED', 'resolving the question must not silently un-pause the run')
  assert.equal(
    run.needsYou[0].resolvedAt !== null,
    true,
    'the question is still recorded as resolved'
  )
})

test('checkpoints form a durable hash chain', () => {
  let run = baseRun()
  run = checkpointRun(run, { phase: 'WAVE_1_PLANNED' }, clock)
  run = checkpointRun(run, { phase: 'WAVE_1_VERIFIED', note: 'GREEN' }, clock)
  assert.equal(run.checkpoints.length, 2)
  assert.equal(run.checkpoints[1].previousHash, run.checkpoints[0].hash)
  assert.throws(() => checkpointRun(run, {}, clock), /phase label is required/)
})

test('summarizeRun produces a concise morning/return summary', () => {
  let run = baseRun()
  run = raiseNeedsYou(run, { question: 'Adopt this candidate?' }, clock)
  run = checkpointRun(run, { phase: 'WAVE_1_PLANNED' }, clock)
  const summary = summarizeRun(run, clock)
  assert.equal(summary.runId, 'run-1')
  assert.equal(summary.state, 'NEEDS_YOU')
  assert.equal(summary.openNeedsYou.length, 1)
  assert.equal(summary.lastCheckpoint.phase, 'WAVE_1_PLANNED')
})

test('dispatchWave records a wave as in flight without appending it to waves yet; settleInFlightWave clears it', () => {
  let run = baseRun()
  const plan = planWave(run, [{ id: 't1', scope: ['src/a.mjs'] }], clock)
  const dispatchRecords = [
    { workItemId: 't1', scope: ['src/a.mjs'], taskId: 'task-1', dispatchId: 'ctx-1' }
  ]
  run = dispatchWave(run, plan, dispatchRecords, clock, 0)
  assert.equal(run.revision, 1)
  assert.equal(run.waves.length, 0, 'not settled yet -- must not appear as a completed wave')
  assert.equal(run.inFlightWave.dispatchRecords.length, 1)

  // A second wave cannot be dispatched while one is already out.
  assert.throws(
    () => dispatchWave(run, plan, dispatchRecords, clock),
    (error) => error.code === 'TSF_WAVE_ALREADY_IN_FLIGHT'
  )

  const waveResult = { outcomes: [{ workItemId: 't1', outcome: 'COMPLETED' }] }
  run = settleInFlightWave(run, waveResult, clock, 1)
  assert.equal(run.revision, 2)
  assert.equal(run.inFlightWave, null)
  assert.equal(run.waves.length, 1)
  assert.equal(run.waves[0].waveResult, waveResult)

  // Settling again with nothing in flight is a real error, not a silent no-op.
  assert.throws(
    () => settleInFlightWave(run, waveResult, clock),
    (error) => error.code === 'TSF_NO_IN_FLIGHT_WAVE'
  )
})

test('settleInFlightWave is idempotent by (plan, result) digest, same as recordWave', () => {
  let run = baseRun()
  const plan = planWave(run, [{ id: 't1', scope: ['src/a.mjs'] }], clock)
  const dispatchRecords = [
    { workItemId: 't1', scope: ['src/a.mjs'], taskId: 'task-1', dispatchId: 'ctx-1' }
  ]
  run = dispatchWave(run, plan, dispatchRecords, clock)
  const waveResult = { outcomes: [{ workItemId: 't1', outcome: 'COMPLETED' }] }
  run = settleInFlightWave(run, waveResult, clock)
  assert.equal(run.waves.length, 1)
  // Re-dispatch + re-settle the exact same (plan, result) -- the digest match
  // must not duplicate the wave record, matching recordWave's own contract.
  run = dispatchWave(run, plan, dispatchRecords, clock)
  run = settleInFlightWave(run, waveResult, clock)
  assert.equal(run.waves.length, 1)
})

test('dispatchWave and settleInFlightWave reject a stale expectedRevision', () => {
  const run = baseRun()
  const plan = planWave(run, [{ id: 't1', scope: ['src/a.mjs'] }], clock)
  const dispatchRecords = [
    { workItemId: 't1', scope: ['src/a.mjs'], taskId: 'task-1', dispatchId: 'ctx-1' }
  ]
  assert.throws(
    () => dispatchWave(run, plan, dispatchRecords, clock, 5),
    (error) => error.code === 'TSF_STALE_REVISION'
  )
  const dispatched = dispatchWave(run, plan, dispatchRecords, clock, 0)
  assert.throws(
    () => settleInFlightWave(dispatched, {}, clock, 5),
    (error) => error.code === 'TSF_STALE_REVISION'
  )
})

test('dispatchWave/settleInFlightWave check expectedRevision before the in-flight invariant, matching every other mutation in this module', () => {
  const run = baseRun()
  const plan = planWave(run, [{ id: 't1', scope: ['src/a.mjs'] }], clock)
  const dispatchRecords = [
    { workItemId: 't1', scope: ['src/a.mjs'], taskId: 'task-1', dispatchId: 'ctx-1' }
  ]
  const dispatched = dispatchWave(run, plan, dispatchRecords, clock, 0)

  // dispatchWave: a wave IS in flight (invariant would fail) AND the
  // expectedRevision is stale -- staleness must be reported, not the
  // invariant error.
  assert.throws(
    () => dispatchWave(dispatched, plan, dispatchRecords, clock, 0), // stale -- dispatched.revision is 1
    (error) => error.code === 'TSF_STALE_REVISION'
  )
  // With the correct revision, the real invariant error still surfaces.
  assert.throws(
    () => dispatchWave(dispatched, plan, dispatchRecords, clock, 1),
    (error) => error.code === 'TSF_WAVE_ALREADY_IN_FLIGHT'
  )

  // settleInFlightWave: no wave is in flight (invariant would fail) AND the
  // expectedRevision is stale -- staleness must win here too.
  assert.throws(
    () => settleInFlightWave(run, {}, clock, 5), // stale -- run.revision is 0
    (error) => error.code === 'TSF_STALE_REVISION'
  )
  // With the correct revision, the real invariant error still surfaces.
  assert.throws(
    () => settleInFlightWave(run, {}, clock, 0),
    (error) => error.code === 'TSF_NO_IN_FLIGHT_WAVE'
  )
})

test('completeRun only reaches COMPLETE from ACTIVE, matching the gap-analysis stop decision', () => {
  const run = baseRun()
  const completed = completeRun(run, clock)
  assert.equal(completed.state, 'COMPLETE')
  assert.throws(() => completeRun(completed, clock), /invalid overnight run transition/)
})

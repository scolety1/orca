import assert from 'node:assert/strict'
import test from 'node:test'
import {
  checkpointRun,
  compareStateToGoal,
  completeRun,
  createOvernightRun,
  detectStall,
  markStalled,
  pauseRun,
  planWave,
  raiseNeedsYou,
  recordTaskAttempt,
  recordWave,
  replaceGoal,
  resolveNeedsYou,
  resumeRun,
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

test('completeRun only reaches COMPLETE from ACTIVE, matching the gap-analysis stop decision', () => {
  const run = baseRun()
  const completed = completeRun(run, clock)
  assert.equal(completed.state, 'COMPLETE')
  assert.throws(() => completeRun(completed, clock), /invalid overnight run transition/)
})

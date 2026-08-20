import assert from 'node:assert/strict'
import test from 'node:test'
import {
  keepGoingRunFor,
  pauseKeepGoingRun,
  projectKeepGoingRun,
  resumeKeepGoingRun,
  startKeepGoingRun
} from '../server/keep-going-controller.mjs'

const clock = () => new Date('2026-08-19T18:00:00.000Z')

test('projectKeepGoingRun reports an honest not-started shape for a project with no run', () => {
  assert.deepEqual(projectKeepGoingRun(null), { started: false })
})

test('startKeepGoingRun creates a real run and rejects starting a second one while active', () => {
  const { opState, run } = startKeepGoingRun(
    {},
    'proj-1',
    { originalGoal: 'Ship it.', acceptanceCriteria: ['A_DONE'], usageMode: 'BALANCED' },
    clock
  )
  assert.equal(run.state, 'ACTIVE')
  assert.equal(keepGoingRunFor(opState, 'proj-1').id, run.id)
  assert.throws(
    () =>
      startKeepGoingRun(
        opState,
        'proj-1',
        { originalGoal: 'Ship it again.', acceptanceCriteria: ['B_DONE'] },
        clock
      ),
    /TSF_RUN_ALREADY_ACTIVE|already active/
  )
})

test('pauseKeepGoingRun and resumeKeepGoingRun transition the real run and persist it', () => {
  const started = startKeepGoingRun(
    {},
    'proj-1',
    { originalGoal: 'Ship it.', acceptanceCriteria: ['A_DONE'] },
    clock
  )
  const paused = pauseKeepGoingRun(started.opState, 'proj-1', 'CAPACITY_REVIEW', clock)
  assert.equal(paused.run.state, 'PAUSED')
  assert.equal(keepGoingRunFor(paused.opState, 'proj-1').state, 'PAUSED')
  const resumed = resumeKeepGoingRun(paused.opState, 'proj-1', clock)
  assert.equal(resumed.run.state, 'ACTIVE')
})

test('pauseKeepGoingRun/resumeKeepGoingRun fail honestly when no run exists', () => {
  assert.throws(
    () => pauseKeepGoingRun({}, 'proj-none', null, clock),
    /TSF_RUN_NOT_FOUND|no Keep Going run/
  )
  assert.throws(
    () => resumeKeepGoingRun({}, 'proj-none', clock),
    /TSF_RUN_NOT_FOUND|no Keep Going run/
  )
})

test('projectKeepGoingRun exposes goal, usage mode, budget, constraints, stop conditions, and live state', () => {
  const { run } = startKeepGoingRun(
    {},
    'proj-1',
    {
      originalGoal: 'Ship the fixture upgrade.',
      acceptanceCriteria: ['A_DONE', 'B_DONE'],
      usageMode: 'DEEP',
      constraints: ['Fixture only.'],
      stopConditions: ['Real repo touched.'],
      budget: { maxWaves: 5 }
    },
    clock
  )
  const view = projectKeepGoingRun(run)
  assert.equal(view.started, true)
  assert.equal(view.state, 'ACTIVE')
  assert.equal(view.goal, 'Ship the fixture upgrade.')
  assert.deepEqual(view.acceptanceCriteria, ['A_DONE', 'B_DONE'])
  assert.equal(view.usageMode, 'DEEP')
  assert.equal(view.budget.maxWaves, 5)
  assert.deepEqual(view.constraints, ['Fixture only.'])
  assert.deepEqual(view.stopConditions, ['Real repo touched.'])
  assert.equal(view.wavesCompleted, 0)
  assert.equal(view.readyForAdoption, false)
  assert.ok(view.lastCheckpoint)
  assert.equal(view.lastCheckpoint.phase, 'RUN_STARTED')
})

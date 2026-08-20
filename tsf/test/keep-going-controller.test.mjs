import assert from 'node:assert/strict'
import test from 'node:test'
import { completeRun } from '../domain/keep-going.mjs'
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
  assert.equal(paused.run.checkpoints.at(-1).phase, 'OPERATOR_PAUSED')
  assert.equal(keepGoingRunFor(paused.opState, 'proj-1').state, 'PAUSED')
  const resumed = resumeKeepGoingRun(paused.opState, 'proj-1', clock)
  assert.equal(resumed.run.state, 'ACTIVE')
  // Regression (wave 11 review finding 4): resume must also checkpoint,
  // matching pause -- otherwise the UI's "Last checkpoint" stays stuck on
  // OPERATOR_PAUSED after a resume.
  assert.equal(resumed.run.checkpoints.at(-1).phase, 'RUN_RESUMED')
})

test('startKeepGoingRun rejects a stale expectedRevision when starting a new run after a prior one finished', () => {
  const first = startKeepGoingRun(
    {},
    'proj-1',
    { originalGoal: 'First run.', acceptanceCriteria: ['A_DONE'] },
    clock
  )
  const completed = completeRun(first.run, clock)
  const opStateWithFinishedRun = {
    ...first.opState,
    keepGoingRuns: { ...first.opState.keepGoingRuns, 'proj-1': completed }
  }
  // A concurrent request that read the run before it settled must be
  // rejected, not allowed to silently overwrite the finished run.
  assert.throws(
    () =>
      startKeepGoingRun(
        opStateWithFinishedRun,
        'proj-1',
        { originalGoal: 'Second run (stale).', acceptanceCriteria: ['B_DONE'] },
        clock,
        first.run.revision // stale -- completed.revision has since moved on
      ),
    (error) => error.code === 'TSF_STALE_REVISION'
  )
  // The correct current revision is accepted and creates a fresh run.
  const second = startKeepGoingRun(
    opStateWithFinishedRun,
    'proj-1',
    { originalGoal: 'Second run.', acceptanceCriteria: ['B_DONE'] },
    clock,
    completed.revision
  )
  assert.equal(second.run.state, 'ACTIVE')
  assert.equal(second.run.originalGoal.statement, 'Second run.')
})

test('pauseKeepGoingRun rejects a stale expectedRevision from a concurrent request', () => {
  const started = startKeepGoingRun(
    {},
    'proj-1',
    { originalGoal: 'Ship it.', acceptanceCriteria: ['A_DONE'] },
    clock
  )
  // Simulates two concurrent HTTP requests that both read opState before
  // either saved: the first pause lands (advancing the persisted revision)...
  const first = pauseKeepGoingRun(started.opState, 'proj-1', 'first', clock, started.run.revision)
  assert.equal(first.run.state, 'PAUSED')
  // ...so the second request, still carrying the pre-pause revision it
  // read, must be rejected rather than silently reapplying on top.
  assert.throws(
    () => pauseKeepGoingRun(first.opState, 'proj-1', 'second (stale)', clock, started.run.revision),
    (error) => error.code === 'TSF_STALE_REVISION'
  )
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
  const view = projectKeepGoingRun(run, clock)
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
  // M3's Live Work Feed drill-down affordance -- null until a real Orca
  // Run has actually been created (no wave dispatched yet on a fresh run).
  assert.equal(view.orchestrationRunId, null)
})

test('projectKeepGoingRun exposes the real orchestrationRunId once one exists, never a fabricated placeholder', () => {
  const { run: started } = startKeepGoingRun(
    {},
    'proj-1',
    { originalGoal: 'Ship it.', acceptanceCriteria: ['A_DONE'] },
    clock
  )
  const withOrchestrationRun = { ...started, orchestrationRunId: 'run_real_orca_id' }
  const view = projectKeepGoingRun(withOrchestrationRun, clock)
  assert.equal(view.orchestrationRunId, 'run_real_orca_id')
})

test('projectKeepGoingRun exposes an honest gap analysis that never treats an unverified criterion as satisfied', () => {
  const { run } = startKeepGoingRun(
    {},
    'proj-1',
    { originalGoal: 'Ship it.', acceptanceCriteria: ['A_DONE', 'B_DONE'] },
    clock
  )
  const view = projectKeepGoingRun(run, clock)
  assert.deepEqual(view.gap.satisfiedCriteria, [])
  assert.deepEqual(view.gap.remainingGaps, ['A_DONE', 'B_DONE'])
  assert.equal(view.gap.decision, 'CONTINUE')
  assert.deepEqual(view.workers, [])
  assert.deepEqual(view.verifierResults, [])
})

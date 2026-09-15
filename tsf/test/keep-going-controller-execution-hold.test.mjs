// TSF_DOGFOOD_FINDING_1_EXECUTION_HOLD_SAFETY_V1: proves the real gap this
// finding closed -- startKeepGoingRun/resumeKeepGoingRun/
// abandonKeepGoingStalledWave used to have NO awareness of a project
// execution hold at all, so a held project could get a new run "started"
// (or an existing one "resumed"/"recovered from STALLED") into ACTIVE
// state -- real, if administrative, project-mutating state -- even though
// the hold's own meaning is "TSF must not begin or resume execution for
// this project." tickKeepGoingRun's own dispatch-time gate (keep-going-
// dispatch-loop.mjs) was always correctly hold-aware; this suite is about
// the layer ABOVE it.
import assert from 'node:assert/strict'
import test from 'node:test'
import { createProjectExecutionHold } from '../domain/project-execution-hold.mjs'
import { markStalled, checkpointRun } from '../domain/keep-going.mjs'
import {
  abandonKeepGoingStalledWave,
  pauseKeepGoingRun,
  resumeKeepGoingRun,
  startKeepGoingRun
} from '../server/keep-going-controller.mjs'

const clock = () => new Date('2026-09-15T18:00:00.000Z')

function heldOpState(projectId, extra = {}) {
  const hold = createProjectExecutionHold(
    { projectId, reason: 'EXTERNAL_WORK_ACTIVE', setBy: 'TIM_VIA_COORDINATOR', note: 'test hold' },
    clock
  )
  return { projectExecutionHolds: { [projectId]: hold }, ...extra }
}

test('startKeepGoingRun refuses to start new work on a held project', () => {
  const opState = heldOpState('proj-held')
  assert.throws(
    () =>
      startKeepGoingRun(
        opState,
        'proj-held',
        { originalGoal: 'Ship it.', acceptanceCriteria: ['A_DONE'], usageMode: 'BALANCED' },
        clock
      ),
    (error) => {
      assert.equal(error.code, 'TSF_PROJECT_EXECUTION_HOLD_ACTIVE')
      assert.match(error.message, /execution hold/)
      return true
    }
  )
})

test('startKeepGoingRun still works normally for an unheld project (no regression)', () => {
  const { run } = startKeepGoingRun(
    {},
    'proj-free',
    { originalGoal: 'Ship it.', acceptanceCriteria: ['A_DONE'], usageMode: 'BALANCED' },
    clock
  )
  assert.equal(run.state, 'ACTIVE')
})

test("resumeKeepGoingRun refuses to resume a held project's paused run", () => {
  const { opState: started } = startKeepGoingRun(
    {},
    'proj-held',
    { originalGoal: 'Ship it.', acceptanceCriteria: ['A_DONE'], usageMode: 'BALANCED' },
    clock
  )
  const { opState: paused } = pauseKeepGoingRun(started, 'proj-held', 'operator paused', clock)
  const heldState = {
    ...paused,
    projectExecutionHolds: heldOpState('proj-held').projectExecutionHolds
  }
  assert.throws(
    () => resumeKeepGoingRun(heldState, 'proj-held', clock),
    (error) => {
      assert.equal(error.code, 'TSF_PROJECT_EXECUTION_HOLD_ACTIVE')
      return true
    }
  )
  // The run itself is untouched -- still PAUSED, not silently resumed.
  assert.equal(paused.keepGoingRuns['proj-held'].state, 'PAUSED')
})

test('pauseKeepGoingRun is NEVER blocked by a hold -- pausing only ever reduces activity', () => {
  const { opState: started } = startKeepGoingRun(
    {},
    'proj-held',
    { originalGoal: 'Ship it.', acceptanceCriteria: ['A_DONE'], usageMode: 'BALANCED' },
    clock
  )
  const heldState = {
    ...started,
    projectExecutionHolds: heldOpState('proj-held').projectExecutionHolds
  }
  const { run } = pauseKeepGoingRun(heldState, 'proj-held', 'operator paused', clock)
  assert.equal(run.state, 'PAUSED')
})

test("abandonKeepGoingStalledWave refuses to recover a held project's stalled run", () => {
  const { opState: started, run: freshRun } = startKeepGoingRun(
    {},
    'proj-held',
    { originalGoal: 'Ship it.', acceptanceCriteria: ['A_DONE'], usageMode: 'BALANCED' },
    clock
  )
  const stalled = checkpointRun(markStalled(freshRun, [], clock), { phase: 'WAVE_STALLED' }, clock)
  const opState = {
    ...started,
    keepGoingRuns: { 'proj-held': stalled },
    projectExecutionHolds: heldOpState('proj-held').projectExecutionHolds
  }
  assert.throws(
    () => abandonKeepGoingStalledWave(opState, 'proj-held', 'recover', clock),
    (error) => {
      assert.equal(error.code, 'TSF_PROJECT_EXECUTION_HOLD_ACTIVE')
      return true
    }
  )
  assert.equal(opState.keepGoingRuns['proj-held'].state, 'STALLED')
})

test('a RELEASED (not ACTIVE) hold never blocks start/resume/abandon -- the hold record survives release, status is what matters', () => {
  const hold = createProjectExecutionHold(
    { projectId: 'proj-released', reason: 'EXTERNAL_WORK_ACTIVE', setBy: 'TIM_VIA_COORDINATOR' },
    clock
  )
  const released = {
    ...hold,
    status: 'RELEASED',
    releasedBy: 'TIM_VIA_COORDINATOR',
    releasedAt: clock().toISOString()
  }
  const opState = { projectExecutionHolds: { 'proj-released': released } }
  const { run } = startKeepGoingRun(
    opState,
    'proj-released',
    { originalGoal: 'Ship it.', acceptanceCriteria: ['A_DONE'], usageMode: 'BALANCED' },
    clock
  )
  assert.equal(run.state, 'ACTIVE')
})

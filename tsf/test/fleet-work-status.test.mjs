import assert from 'node:assert/strict'
import test from 'node:test'
import { fleetWorkStatus } from '../domain/fleet-work-status.mjs'
import { createOvernightRun, dispatchWave } from '../domain/keep-going.mjs'

const clock = () => new Date('2026-08-25T00:00:00.000Z')

function project(id, overrides = {}) {
  return { id, displayName: id, mission: { state: 'ONBOARDED' }, ...overrides }
}

test('fleetWorkStatus reports hasRun:false and feed:null for a project with no Keep Going run', () => {
  const statuses = fleetWorkStatus([project('a')], {}, clock)
  assert.deepEqual(statuses, [
    { projectId: 'a', displayName: 'a', hasRun: false, feed: null, runId: null }
  ])
})

test('fleetWorkStatus reports PLANNING for a freshly-started run with no dispatched wave -- the exact Started->Work bug', () => {
  const run = createOvernightRun(
    { id: 'run-a', projectId: 'a', originalGoal: 'Fix it.', acceptanceCriteria: ['X'] },
    clock
  )
  const statuses = fleetWorkStatus([project('a')], { a: run }, clock)
  assert.equal(statuses[0].hasRun, true)
  assert.equal(statuses[0].runId, 'run-a')
  assert.equal(statuses[0].feed.state, 'PLANNING')
})

test('fleetWorkStatus reports WORKING once a wave is in flight', () => {
  let run = createOvernightRun(
    { id: 'run-a', projectId: 'a', originalGoal: 'Fix it.', acceptanceCriteria: ['X'] },
    clock
  )
  const wavePlan = {
    schemaVersion: 'TSF_KEEP_GOING_WAVE_PLAN_V1',
    runId: run.id,
    waveNumber: 1,
    batches: []
  }
  run = dispatchWave(run, wavePlan, [{ workItemId: 't1', taskId: 'task-1' }], clock, run.revision)
  const statuses = fleetWorkStatus([project('a')], { a: run }, clock)
  assert.equal(statuses[0].feed.state, 'WORKING')
})

test('fleetWorkStatus is unaffected by an unrelated project with no run in the same fleet', () => {
  const run = createOvernightRun(
    { id: 'run-a', projectId: 'a', originalGoal: 'Fix it.', acceptanceCriteria: ['X'] },
    clock
  )
  const statuses = fleetWorkStatus([project('a'), project('b')], { a: run }, clock)
  const byId = Object.fromEntries(statuses.map((s) => [s.projectId, s]))
  assert.equal(byId.a.hasRun, true)
  assert.equal(byId.b.hasRun, false)
})

import assert from 'node:assert/strict'
import test from 'node:test'
import { projectLiveWorkFeedState } from '../ui/src/lib/live-work-feed.ts'

// Client-side mirror of tsf/domain/live-work-feed.mjs's own, separately
// tested state mapping -- adapted to KeepGoingRunView's fields (the server
// projection actually sent to the client), not the raw domain run. Node's
// native TypeScript support runs this .ts module directly; no bundler/
// test-framework was added to tsf/ui for this (it has none today -- see
// the M2 acceptance investigation's own conclusion that inventing one
// just for this would weaken, not satisfy, the acceptance contract).
function run(overrides = {}) {
  return {
    started: true,
    runId: 'run-1',
    revision: 1,
    state: 'ACTIVE',
    phase: 'RUN_STARTED',
    goal: 'Ship it',
    acceptanceCriteria: ['CRITERION_A', 'CRITERION_B'],
    usageMode: 'BALANCED',
    budget: {},
    constraints: [],
    stopConditions: [],
    wavesCompleted: 0,
    retryCounts: {},
    gap: {
      satisfiedCriteria: [],
      remainingGaps: ['CRITERION_A', 'CRITERION_B'],
      decision: 'CONTINUE'
    },
    workers: [],
    verifierResults: [],
    openNeedsYou: [],
    lastCheckpoint: null,
    readyForAdoption: false,
    // Kept in sync with the real KeepGoingActiveRunView shape -- an
    // independent review finding was that an earlier version of this
    // fixture omitted fields, invisible to tooling here since .mjs test
    // files aren't type-checked and Node's native TS stripping performs
    // no type-checking either.
    orchestrationRunId: null,
    dispatchTickActive: false,
    createdAt: '2026-08-20T05:00:00.000Z',
    updatedAt: '2026-08-20T05:00:00.000Z',
    ...overrides
  }
}

test('no run at all -> PLANNING', () => {
  assert.equal(projectLiveWorkFeedState(null).state, 'PLANNING')
})

test('a fresh run with no waves dispatched yet -> PLANNING', () => {
  assert.equal(projectLiveWorkFeedState(run()).state, 'PLANNING')
})

test('phase WAVE_DISPATCHED -> WORKING', () => {
  assert.equal(
    projectLiveWorkFeedState(run({ phase: 'WAVE_DISPATCHED', wavesCompleted: 0 })).state,
    'WORKING'
  )
})

test('phase WAVE_DISPATCHED_PARTIAL -> WORKING', () => {
  assert.equal(
    projectLiveWorkFeedState(run({ phase: 'WAVE_DISPATCHED_PARTIAL', wavesCompleted: 0 })).state,
    'WORKING'
  )
})

test('state STALLED -> STALLED regardless of phase', () => {
  assert.equal(
    projectLiveWorkFeedState(run({ state: 'STALLED', phase: 'WAVE_STALLED' })).state,
    'STALLED'
  )
})

test('state NEEDS_YOU -> NEEDS_YOU', () => {
  assert.equal(projectLiveWorkFeedState(run({ state: 'NEEDS_YOU' })).state, 'NEEDS_YOU')
})

test('an open Needs You entry -> NEEDS_YOU even if state is something else', () => {
  assert.equal(
    projectLiveWorkFeedState(
      run({ openNeedsYou: [{ id: 'n1', question: 'Which way?', options: [], raisedAt: '' }] })
    ).state,
    'NEEDS_YOU'
  )
})

test('state BLOCKED -> NEEDS_YOU', () => {
  assert.equal(projectLiveWorkFeedState(run({ state: 'BLOCKED' })).state, 'NEEDS_YOU')
})

test('state PAUSED -> WAITING', () => {
  assert.equal(projectLiveWorkFeedState(run({ state: 'PAUSED' })).state, 'WAITING')
})

// An independent review finding: a real, reachable window where a
// dispatch tick claims the lock (a real write) before the eventual
// WAVE_DISPATCHED commit (a separate, later write) -- any concurrent load
// of this data (a second tab, a refresh) mid-window previously fell
// through to a stale PLANNING/WORKING guess instead of the honest WAITING.
test('ACTIVE, no wave in flight yet, but a dispatch tick currently holds the lock -> WAITING', () => {
  assert.equal(
    projectLiveWorkFeedState(run({ wavesCompleted: 0, dispatchTickActive: true })).state,
    'WAITING'
  )
})

test('state COMPLETE -> READY_FOR_ADOPTION', () => {
  assert.equal(
    projectLiveWorkFeedState(run({ state: 'COMPLETE', readyForAdoption: true })).state,
    'READY_FOR_ADOPTION'
  )
})

test('ACTIVE, settled wave, no gap remaining -> WORKING', () => {
  assert.equal(
    projectLiveWorkFeedState(
      run({
        wavesCompleted: 1,
        phase: 'WAVE_SETTLED',
        gap: {
          satisfiedCriteria: ['CRITERION_A', 'CRITERION_B'],
          remainingGaps: [],
          decision: 'STOP_COMPLETE'
        }
      })
    ).state,
    'WORKING'
  )
})

test('ACTIVE, settled wave, gap has remaining criteria and none satisfied -> VERIFYING', () => {
  assert.equal(
    projectLiveWorkFeedState(
      run({
        wavesCompleted: 1,
        phase: 'WAVE_SETTLED',
        gap: { satisfiedCriteria: [], remainingGaps: ['CRITERION_A'], decision: 'CONTINUE' }
      })
    ).state,
    'VERIFYING'
  )
})

test('ACTIVE, settled wave, gap has BOTH satisfied and remaining -> REVISION', () => {
  assert.equal(
    projectLiveWorkFeedState(
      run({
        wavesCompleted: 1,
        phase: 'WAVE_SETTLED',
        gap: {
          satisfiedCriteria: ['CRITERION_A'],
          remainingGaps: ['CRITERION_B'],
          decision: 'CONTINUE'
        }
      })
    ).state,
    'REVISION'
  )
})

test('NEEDS_YOU wins over STALLED/PAUSED/BLOCKED ordering', () => {
  assert.equal(
    projectLiveWorkFeedState(run({ state: 'NEEDS_YOU', phase: 'WAVE_STALLED' })).state,
    'NEEDS_YOU'
  )
})

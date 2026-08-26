import assert from 'node:assert/strict'
import test from 'node:test'
import { classifyUpdateSafety } from '../domain/update-safety.mjs'
import { fleetWorkStatus } from '../domain/fleet-work-status.mjs'

// Fast, precise unit-level coverage of classifyUpdateSafety's own contract
// -- `executing` set explicitly, independent of fleet-work-status.mjs.
function status(projectId, hasRun, state, executing = false) {
  return {
    projectId,
    displayName: projectId,
    hasRun,
    feed: hasRun ? { state, reason: state } : null,
    runId: hasRun ? 'run-1' : null,
    executing
  }
}

test('no real work anywhere is SAFE_NOW', () => {
  const result = classifyUpdateSafety([status('a', false, null), status('b', true, 'PLANNING')])
  assert.equal(result.state, 'SAFE_NOW')
  assert.deepEqual(result.blockingProjectIds, [])
})

test('a project with a worker genuinely WORKING blocks an update -- WAIT_FOR_ACTIVE_WORK', () => {
  const result = classifyUpdateSafety([status('a', true, 'WORKING', true)])
  assert.equal(result.state, 'WAIT_FOR_ACTIVE_WORK')
  assert.deepEqual(result.blockingProjectIds, ['a'])
})

test('the label alone no longer decides it -- VERIFYING/REVISION/WAITING with executing:false do not block', () => {
  // Governed-adoption-review finding, pinned here: the OLD version of this
  // function gated on these three labels unconditionally and would have
  // blocked forever on a settled, unowned run -- exactly what real
  // production evidence (three real fleet projects, no live process, clean
  // worktrees, ~2 days idle, all VERIFYING) showed happening. executing is
  // the real fact; the label is not.
  assert.equal(classifyUpdateSafety([status('a', true, 'VERIFYING', false)]).state, 'SAFE_NOW')
  assert.equal(classifyUpdateSafety([status('a', true, 'REVISION', false)]).state, 'SAFE_NOW')
  // WAITING for a deliberately human-PAUSED run: also not executing, also
  // safe -- the run isn't going anywhere until a human resumes it.
  assert.equal(classifyUpdateSafety([status('a', true, 'WAITING', false)]).state, 'SAFE_NOW')
  // But the SAME labels with executing:true (a genuinely held dispatch
  // lock, or an in-flight wave whose checkpoint hasn't caught up to
  // relabel it WORKING yet) still block.
  assert.equal(
    classifyUpdateSafety([status('a', true, 'WAITING', true)]).state,
    'WAIT_FOR_ACTIVE_WORK'
  )
})

test('an open Needs You question escalates to TIM_REQUIRED, outranking a merely-active project', () => {
  const result = classifyUpdateSafety([
    status('a', true, 'NEEDS_YOU', false),
    status('b', true, 'WORKING', true)
  ])
  assert.equal(result.state, 'TIM_REQUIRED')
  assert.deepEqual(result.blockingProjectIds, ['a'])
})

test('undeterminable fleet state escalates to TIM_REQUIRED rather than guessing safe', () => {
  const result = classifyUpdateSafety(null)
  assert.equal(result.state, 'TIM_REQUIRED')
})

test('PLANNING (a run that exists but has not dispatched a wave) does not block an update', () => {
  const result = classifyUpdateSafety([status('a', true, 'PLANNING', false)])
  assert.equal(result.state, 'SAFE_NOW')
})

// --- Realistic, integrated coverage: real run shapes through the real
// fleetWorkStatus -> classifyUpdateSafety pipeline, not synthetic
// fixtures. Each mirrors an exact real shape seen in the governed
// adoption review's live production evidence.

const clock = () => new Date('2026-08-26T17:00:00.000Z')
const project = (id) => ({ id, displayName: id })

function baseRun(overrides) {
  return {
    id: 'run-x',
    projectId: 'p',
    state: 'ACTIVE',
    originalGoal: {
      statement: 'do the thing',
      acceptanceCriteria: ['criterion one', 'criterion two']
    },
    budget: { maxWaves: 10 },
    waves: [],
    inFlightWave: null,
    tickLock: null,
    needsYou: [],
    checkpoints: [],
    ...overrides
  }
}

test('ADVERSARIAL: a real in-flight implementation wave blocks an update', () => {
  const run = baseRun({
    inFlightWave: {
      wavePlan: { waveNumber: 1, batches: [[{ id: 'do-the-fix', worktree: '/x' }]] }
    }
  })
  const [s] = fleetWorkStatus([project('p')], { p: run }, clock)
  assert.equal(s.feed.state, 'WORKING')
  assert.equal(s.executing, true)
  assert.equal(classifyUpdateSafety([s]).state, 'WAIT_FOR_ACTIVE_WORK')
})

test('ADVERSARIAL: a real in-flight VERIFICATION wave blocks an update identically -- verification is still a wave dispatch, not a separate untracked activity', () => {
  const run = baseRun({
    inFlightWave: {
      wavePlan: { waveNumber: 2, batches: [[{ id: 'verify-acceptance-criteria', worktree: '/x' }]] }
    }
  })
  const [s] = fleetWorkStatus([project('p')], { p: run }, clock)
  assert.equal(s.feed.state, 'WORKING')
  assert.equal(s.executing, true)
  assert.equal(classifyUpdateSafety([s]).state, 'WAIT_FOR_ACTIVE_WORK')
})

test('ADVERSARIAL: queued work (waves.length === 0, no run yet dispatched) never blocks -- "queued" has no real domain signal today (Stage A\'s documented gap), PLANNING is its honest closest equivalent', () => {
  const run = baseRun({})
  const [s] = fleetWorkStatus([project('p')], { p: run }, clock)
  assert.equal(s.feed.state, 'PLANNING')
  assert.equal(s.executing, false)
  assert.equal(classifyUpdateSafety([s]).state, 'SAFE_NOW')
})

test('ADVERSARIAL: a settled, stale, unowned run does not falsely block an update forever -- the exact real shape found live in NWR/WorldForge/Landing Page', () => {
  const run = baseRun({
    waves: [
      {
        wavePlan: { waveNumber: 1, batches: [[{ id: 'w1', worktree: '/x' }]] },
        waveResult: {
          outcomes: [{ workItemId: 'w1', outcome: 'COMPLETED' }],
          settledAt: '2026-08-24T09:46:20.658Z'
        }
      }
    ],
    inFlightWave: null,
    tickLock: null,
    checkpoints: [{ phase: 'WAVE_SETTLED', at: '2026-08-24T09:46:20.658Z' }],
    updatedAt: '2026-08-24T09:46:20.658Z'
  })
  const [s] = fleetWorkStatus([project('p')], { p: run }, clock)
  assert.equal(s.feed.state, 'VERIFYING')
  assert.equal(
    s.executing,
    false,
    'no inFlightWave and no tickLock -- nothing is executing right now'
  )
  assert.equal(classifyUpdateSafety([s]).state, 'SAFE_NOW')
})

test('ADVERSARIAL: that same settled-unowned run is never mislabeled complete just because it stopped blocking', () => {
  const run = baseRun({
    waves: [
      {
        wavePlan: { waveNumber: 1, batches: [[{ id: 'w1', worktree: '/x' }]] },
        waveResult: {
          outcomes: [{ workItemId: 'w1', outcome: 'COMPLETED' }],
          settledAt: '2026-08-24T09:46:20.658Z'
        }
      }
    ],
    inFlightWave: null,
    tickLock: null
  })
  const [s] = fleetWorkStatus([project('p')], { p: run }, clock)
  assert.notEqual(s.feed.state, 'READY_FOR_ADOPTION')
  assert.notEqual(s.feed.state, 'COMPLETED')
  assert.equal(s.feed.state, 'VERIFYING', 'still honestly unverified, just also no longer blocking')
})

test('ADVERSARIAL: NEEDS_YOU still gates to TIM_REQUIRED regardless of executing', () => {
  const run = baseRun({ needsYou: [{ question: 'which direction?', resolvedAt: null }] })
  const [s] = fleetWorkStatus([project('p')], { p: run }, clock)
  assert.equal(s.feed.state, 'NEEDS_YOU')
  assert.equal(s.executing, false)
  assert.equal(classifyUpdateSafety([s]).state, 'TIM_REQUIRED')
})

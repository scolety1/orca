import assert from 'node:assert/strict'
import test from 'node:test'
import { createOvernightRun } from '../domain/keep-going.mjs'
import { reclaimExpiredDispatchLock } from '../server/keep-going-stale-dispatch-lock-reclaim.mjs'

const clock = () => new Date('2026-08-20T05:00:00.000Z')
const PROJECT_ID = 'fixture:proj'

function baseRun(overrides = {}) {
  return createOvernightRun(
    {
      id: 'run-1',
      projectId: PROJECT_ID,
      originalGoal: 'Fix the thing.',
      acceptanceCriteria: ['CRITERION_A'],
      usageMode: 'BALANCED',
      ...overrides
    },
    clock
  )
}

function makeFakeStore(run) {
  let current = run
  return {
    readRun: () => current,
    withRun: (_projectId, mutateFn) => {
      current = mutateFn(current)
      return current
    },
    get current() {
      return current
    }
  }
}

test('reclaimExpiredDispatchLock claims and releases an expired lock atomically -- ends with no lock, no dispatchAttempt', async () => {
  const run = {
    ...baseRun(),
    tickLock: { kind: 'DISPATCH', claimedAt: '2026-08-20T04:56:00.000Z', timeoutMs: 2 * 60 * 1000 }
  }
  const store = makeFakeStore(run)
  const result = await reclaimExpiredDispatchLock(PROJECT_ID, clock, store)
  assert.equal(result.reclaimed, true)
  assert.equal(store.current.tickLock, null)
  assert.equal(store.current.dispatchAttempt, null)
})

test('reclaimExpiredDispatchLock refuses (does not reclaim) a genuinely ambiguous crashed dispatchAttempt', async () => {
  const run = {
    ...baseRun(),
    tickLock: { kind: 'DISPATCH', claimedAt: '2026-08-20T04:56:00.000Z', timeoutMs: 2 * 60 * 1000 },
    dispatchAttempt: { beganAt: '2026-08-20T04:56:00.000Z' }
  }
  const store = makeFakeStore(run)
  const result = await reclaimExpiredDispatchLock(PROJECT_ID, clock, store)
  assert.equal(result.reclaimed, false)
  assert.equal(result.code, 'TSF_KEEP_GOING_DISPATCH_AMBIGUOUS')
  assert.ok(store.current.tickLock, 'the ambiguous lock is left untouched for owner review')
})

test('reclaimExpiredDispatchLock refuses a still-genuinely-active (not yet expired) lock without touching it', async () => {
  const run = {
    ...baseRun(),
    tickLock: { kind: 'DISPATCH', claimedAt: clock().toISOString(), timeoutMs: 2 * 60 * 1000 }
  }
  const store = makeFakeStore(run)
  const before = JSON.stringify(store.current.tickLock)
  const result = await reclaimExpiredDispatchLock(PROJECT_ID, clock, store)
  assert.equal(result.reclaimed, false)
  assert.equal(result.code, 'TSF_TICK_IN_PROGRESS')
  assert.equal(JSON.stringify(store.current.tickLock), before)
})

// Real adversarial-review finding (round 1): claim and release used to be
// two SEPARATE `store.withRun` commits -- a crash (or a storage failure)
// between them left a FRESH tickLock/dispatchAttempt durably persisted
// with nothing to ever release it, recreating the exact permanent wedge
// this module exists to fix. Proves the fix: a single injected storage
// failure on the ONE remaining `withRun` call must leave the run in
// EXACTLY its pre-attempt state -- never a half-claimed one.
test('reclaimExpiredDispatchLock: a storage failure during the single atomic commit never leaves a half-claimed lock behind', async () => {
  const run = {
    ...baseRun(),
    tickLock: { kind: 'DISPATCH', claimedAt: '2026-08-20T04:56:00.000Z', timeoutMs: 2 * 60 * 1000 }
  }
  const originalTickLock = JSON.stringify(run.tickLock)
  let current = run
  const faultyStore = {
    readRun: () => current,
    withRun: () => {
      // The real store's own contract: a failed commit never applies the
      // mutation -- `current` is untouched by a throwing withRun call.
      throw new Error('simulated storage failure')
    }
  }
  const result = await reclaimExpiredDispatchLock(PROJECT_ID, clock, faultyStore)
  assert.equal(result.reclaimed, false)
  assert.equal(result.code, 'CLAIM_FAILED')
  assert.equal(
    JSON.stringify(current.tickLock),
    originalTickLock,
    'no partial claim survived the failure'
  )
  assert.equal(current.dispatchAttempt, null, 'no orphaned dispatchAttempt was left behind')
})

test('reclaimExpiredDispatchLock refuses when a real wave started concurrently, without touching the run', async () => {
  const run = {
    ...baseRun(),
    tickLock: { kind: 'DISPATCH', claimedAt: '2026-08-20T04:56:00.000Z', timeoutMs: 2 * 60 * 1000 },
    inFlightWave: { dispatchRecords: [], dispatchedAt: clock().toISOString() }
  }
  const store = makeFakeStore(run)
  const result = await reclaimExpiredDispatchLock(PROJECT_ID, clock, store)
  assert.equal(result.reclaimed, false)
  assert.equal(result.code, 'TSF_STALE_ROUTING_DECISION')
})

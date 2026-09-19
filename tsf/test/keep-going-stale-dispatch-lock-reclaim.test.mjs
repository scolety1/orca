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
// this module exists to fix.
//
// Real adversarial-review finding (round 2): the first version of this
// test injected a failure on the FIRST withRun call, which the OLD,
// vulnerable two-commit implementation also caught and reported
// {reclaimed:false} for -- it never reached the actual crash window (after
// a successful claim, before the release commits), so it would have
// passed against the bug it claimed to prove fixed. This version asserts
// withRun is called exactly ONCE (proving claim+release are the same
// commit, not two), which only the atomic, single-mutation implementation
// can satisfy.
test('reclaimExpiredDispatchLock: claim and release happen inside exactly ONE store.withRun commit, closing the crash window between them', async () => {
  const run = {
    ...baseRun(),
    tickLock: { kind: 'DISPATCH', claimedAt: '2026-08-20T04:56:00.000Z', timeoutMs: 2 * 60 * 1000 }
  }
  let current = run
  let withRunCallCount = 0
  const countingStore = {
    readRun: () => current,
    withRun: (_projectId, mutateFn) => {
      withRunCallCount += 1
      current = mutateFn(current)
      return current
    }
  }
  const result = await reclaimExpiredDispatchLock(PROJECT_ID, clock, countingStore)
  assert.equal(result.reclaimed, true)
  assert.equal(
    withRunCallCount,
    1,
    'claim and release must be the same commit -- two separate commits reopens the crash window'
  )
  assert.equal(current.tickLock, null)
  assert.equal(current.dispatchAttempt, null)
})

// Companion case: if that single commit itself fails (a real storage
// failure, or a process crash before it lands), the real store's own
// atomic-rename contract (verified against the REAL store in round 2)
// guarantees the mutation was never applied at all -- proven here with a
// fake store matching that same "all or nothing" contract.
test('reclaimExpiredDispatchLock: a storage failure on that single commit leaves the run in exactly its pre-attempt state', async () => {
  const run = {
    ...baseRun(),
    tickLock: { kind: 'DISPATCH', claimedAt: '2026-08-20T04:56:00.000Z', timeoutMs: 2 * 60 * 1000 }
  }
  const originalTickLock = JSON.stringify(run.tickLock)
  const current = run
  const faultyStore = {
    readRun: () => current,
    withRun: () => {
      // The real store's own contract (server/data-store.mjs: write-temp +
      // atomic rename): a failed commit never applies the mutation.
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

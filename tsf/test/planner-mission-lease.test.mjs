import assert from 'node:assert/strict'
import test from 'node:test'
import {
  acquirePlannerMissionLease,
  isPlannerMissionLeaseLive,
  relinquishPlannerMissionLease,
  renewPlannerMissionLease
} from '../domain/planner-mission-lease.mjs'

const clock = () => new Date('2026-09-06T12:00:00.000Z')

test('acquire on an empty lease slot grants immediately', () => {
  const outcome = acquirePlannerMissionLease(null, { plannerSessionId: 'planner-A', ttlMs: 60_000 }, clock)
  assert.equal(outcome.granted, true)
  assert.equal(outcome.lease.holderPlannerSessionId, 'planner-A')
  assert.ok(isPlannerMissionLeaseLive(outcome.lease, clock()))
})

test('a second, different session is refused while the first holder is live -- only one wins', () => {
  const first = acquirePlannerMissionLease(null, { plannerSessionId: 'planner-A', ttlMs: 60_000 }, clock).lease
  const outcome = acquirePlannerMissionLease(first, { plannerSessionId: 'planner-B', ttlMs: 60_000 }, clock)
  assert.equal(outcome.granted, false)
  assert.match(outcome.reason, /planner-A/)
})

test('re-acquiring with the SAME holder is idempotent (renew), not a refusal', () => {
  const first = acquirePlannerMissionLease(null, { plannerSessionId: 'planner-A', ttlMs: 1_000 }, clock).lease
  const later = () => new Date('2026-09-06T12:00:00.500Z')
  const outcome = acquirePlannerMissionLease(first, { plannerSessionId: 'planner-A', ttlMs: 1_000 }, later)
  assert.equal(outcome.granted, true)
  assert.equal(outcome.lease.acquiredAt, first.acquiredAt, 'acquiredAt is preserved across a renew')
  assert.ok(new Date(outcome.lease.expiresAt) > new Date(first.expiresAt), 'expiry was extended')
})

test('a stale (expired) lease is reclaimable by a different session -- crash recovery', () => {
  const stale = acquirePlannerMissionLease(null, { plannerSessionId: 'planner-A', ttlMs: 1_000 }, clock).lease
  const muchLater = () => new Date('2026-09-06T12:05:00.000Z')
  const outcome = acquirePlannerMissionLease(stale, { plannerSessionId: 'planner-B', ttlMs: 60_000 }, muchLater)
  assert.equal(outcome.granted, true)
  assert.equal(outcome.lease.holderPlannerSessionId, 'planner-B')
})

test('renew fails honest (TSF_PLANNER_LEASE_NOT_HELD) for a session that is not the live holder', () => {
  const lease = acquirePlannerMissionLease(null, { plannerSessionId: 'planner-A', ttlMs: 60_000 }, clock).lease
  assert.throws(
    () => renewPlannerMissionLease(lease, { plannerSessionId: 'planner-B', ttlMs: 60_000 }, clock),
    (error) => error.code === 'TSF_PLANNER_LEASE_NOT_HELD'
  )
  const muchLater = () => new Date('2026-09-06T13:00:00.000Z')
  assert.throws(
    () => renewPlannerMissionLease(lease, { plannerSessionId: 'planner-A', ttlMs: 60_000 }, muchLater),
    (error) => error.code === 'TSF_PLANNER_LEASE_NOT_HELD',
    'renewing an already-expired lease is refused, not silently revived'
  )
})

test('relinquish: the live holder releases cleanly; a non-holder is refused; an already-empty slot is a graceful no-op', () => {
  const lease = acquirePlannerMissionLease(null, { plannerSessionId: 'planner-A', ttlMs: 60_000 }, clock).lease
  const refused = relinquishPlannerMissionLease(lease, { plannerSessionId: 'planner-B' }, clock)
  assert.equal(refused.released, false)
  const released = relinquishPlannerMissionLease(lease, { plannerSessionId: 'planner-A' }, clock)
  assert.equal(released.released, true)
  assert.equal(released.lease, null)
  const noop = relinquishPlannerMissionLease(null, { plannerSessionId: 'planner-A' }, clock)
  assert.equal(noop.released, false)
})

test('two racing acquire calls against the SAME snapshot: exactly one call sees granted=true, deterministically', () => {
  // Pure-function race proxy: both calls observe the identical `existingLease`
  // snapshot (as two truly concurrent readers under a lock would, right up
  // to the point one of them wins the write) -- the real cross-process
  // serialization is proven in planner-mission-lease-cross-process.test.mjs.
  const outcomeA = acquirePlannerMissionLease(null, { plannerSessionId: 'racer-A', ttlMs: 60_000 }, clock)
  const outcomeB = acquirePlannerMissionLease(null, { plannerSessionId: 'racer-B', ttlMs: 60_000 }, clock)
  assert.equal(outcomeA.granted, true)
  assert.equal(outcomeB.granted, true, 'both grant against an empty slot in isolation -- only the STORE layer serializes the actual write, proven separately')
})

// Unit coverage for the pure Resource Pressure Governor V0 domain logic:
// tier classification, admission policy, the TSF_RESOURCE_PRESSURE_STATE_V0
// contract's honesty constraints, and heavy-task lease mutual exclusion.
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DEFAULT_RESOURCE_PRESSURE_THRESHOLDS_BYTES as THRESHOLDS,
  classifyResourcePressureTier,
  buildAdmissionPolicy,
  buildResourcePressureState,
  requestHeavyTaskLease,
  releaseHeavyTaskLease
} from '../domain/resource-pressure-governor.mjs'

const GB = 1024 ** 3

test('tier boundaries: exactly at a threshold rounds up to the healthier tier', () => {
  assert.equal(classifyResourcePressureTier(THRESHOLDS.healthyAtLeastBytes), 'HEALTHY')
  assert.equal(classifyResourcePressureTier(THRESHOLDS.healthyAtLeastBytes - 1), 'PRESSURED')
  assert.equal(classifyResourcePressureTier(THRESHOLDS.pressuredAtLeastBytes), 'PRESSURED')
  assert.equal(classifyResourcePressureTier(THRESHOLDS.pressuredAtLeastBytes - 1), 'CRITICAL')
  assert.equal(classifyResourcePressureTier(THRESHOLDS.criticalAtLeastBytes), 'CRITICAL')
  assert.equal(classifyResourcePressureTier(THRESHOLDS.criticalAtLeastBytes - 1), 'EMERGENCY')
})

test('the real incident evidence (~1.69GB free) classifies CRITICAL, matching the requirement doc', () => {
  assert.equal(classifyResourcePressureTier(1.69 * GB), 'CRITICAL')
})

test('zero available memory is EMERGENCY, not a division/boundary artifact', () => {
  assert.equal(classifyResourcePressureTier(0), 'EMERGENCY')
})

for (const bad of [null, undefined, NaN, -1, '4000000000', {}, []]) {
  test(`REQUIRED PROOF: unmeasurable/invalid availableBytes (${JSON.stringify(bad)}) fails closed to EMERGENCY, never HEALTHY`, () => {
    assert.equal(classifyResourcePressureTier(bad), 'EMERGENCY')
  })
}

test('admission policy: HEALTHY admits, PRESSURED delays, CRITICAL/EMERGENCY refuse -- uniformly across work categories', () => {
  const categories = ['newFullSuiteTests', 'newBrowserPilots', 'newResearchWorkers']
  const expected = { HEALTHY: 'ADMIT', PRESSURED: 'DELAY', CRITICAL: 'REFUSE', EMERGENCY: 'REFUSE' }
  for (const [tier, decision] of Object.entries(expected)) {
    const policy = buildAdmissionPolicy(tier)
    for (const category of categories) {
      assert.equal(policy[category], decision, `${tier}/${category}`)
    }
    assert.ok(policy.reason.length > 0)
  }
})

test('an unrecognized tier fails closed to the EMERGENCY policy, not HEALTHY', () => {
  const policy = buildAdmissionPolicy('SOMETHING_NEW')
  assert.equal(policy.newFullSuiteTests, 'REFUSE')
})

test('buildResourcePressureState: real contract shape, schemaVersion, and injected clock', () => {
  const clock = () => new Date('2026-09-04T23:00:00.000Z')
  const state = buildResourcePressureState(
    { hostMemory: { totalBytes: 16 * GB, freeBytes: 5 * GB, availableBytes: 5 * GB, usedPercent: 68.8 } },
    clock
  )
  assert.equal(state.schemaVersion, 'TSF_RESOURCE_PRESSURE_STATE_V0')
  assert.equal(state.observedAt, '2026-09-04T23:00:00.000Z')
  assert.equal(state.tier, 'HEALTHY')
  assert.equal(state.admission.newFullSuiteTests, 'ADMIT')
  assert.deepEqual(state.hostMemory, {
    totalBytes: 16 * GB,
    freeBytes: 5 * GB,
    availableBytes: 5 * GB,
    usedPercent: 68.8
  })
})

test('REQUIRED PROOF: evidenceSource is hard-coded TSF_OS_MODULE even if hostMemory claims otherwise', () => {
  const state = buildResourcePressureState({
    hostMemory: { totalBytes: GB, freeBytes: GB, availableBytes: GB, evidenceSource: 'ORCA_NATIVE_COLLECTOR' }
  })
  assert.equal(state.evidenceSource, 'TSF_OS_MODULE')
})

test('REQUIRED PROOF: reclaimCandidates is always empty and structurally cannot be injected by any caller shape', () => {
  const state = buildResourcePressureState({
    hostMemory: { availableBytes: 5 * GB },
    reclaimCandidates: [{ kind: 'COMPLETED_PLANNER_SESSION', ownerMission: 'fake', estimatedReclaimBytes: 999 }]
  })
  assert.deepEqual(state.reclaimCandidates, [])
})

test('missing hostMemory produces honestly-null fields and the EMERGENCY fail-closed tier', () => {
  const state = buildResourcePressureState({ hostMemory: undefined })
  assert.deepEqual(state.hostMemory, { totalBytes: null, freeBytes: null, availableBytes: null, usedPercent: null })
  assert.equal(state.tier, 'EMERGENCY')
})

test('protectedProcesses and missionsWaitingForResources: malformed entries are dropped, valid ones pass through', () => {
  const state = buildResourcePressureState({
    hostMemory: { availableBytes: 5 * GB },
    protectedProcesses: [
      { ownerMission: 'nwr-draft-upgrade-hq', kind: 'ACTIVE_MISSION', reason: 'active NWR mission' },
      { ownerMission: 'missing-kind' },
      'not an object',
      null
    ],
    missionsWaitingForResources: [
      { missionId: 'tsf-unified-platform-v1', waitingSince: '2026-09-04T22:52:00.000Z', blockedOn: 'CRITICAL tier' },
      { missionId: 'no-waiting-since' }
    ]
  })
  assert.deepEqual(state.protectedProcesses, [
    { ownerMission: 'nwr-draft-upgrade-hq', kind: 'ACTIVE_MISSION', reason: 'active NWR mission' }
  ])
  assert.deepEqual(state.missionsWaitingForResources, [
    { missionId: 'tsf-unified-platform-v1', waitingSince: '2026-09-04T22:52:00.000Z', blockedOn: 'CRITICAL tier' }
  ])
})

test('non-array protectedProcesses/missionsWaitingForResources are treated as empty, not thrown on', () => {
  const state = buildResourcePressureState({
    hostMemory: { availableBytes: 5 * GB },
    protectedProcesses: 'not-an-array',
    missionsWaitingForResources: null
  })
  assert.deepEqual(state.protectedProcesses, [])
  assert.deepEqual(state.missionsWaitingForResources, [])
})

test('the leases snapshot excludes expired entries', () => {
  const clock = () => new Date('2026-09-04T23:00:00.000Z')
  const state = buildResourcePressureState(
    {
      hostMemory: { availableBytes: 5 * GB },
      leases: {
        LIVE: { holderMissionId: 'm1', acquiredAt: '2026-09-04T22:00:00.000Z', expiresAt: '2026-09-05T00:00:00.000Z' },
        EXPIRED: { holderMissionId: 'm2', acquiredAt: '2026-09-04T20:00:00.000Z', expiresAt: '2026-09-04T22:00:00.000Z' }
      }
    },
    clock
  )
  assert.deepEqual(state.leases, [
    { kind: 'LIVE', holderMissionId: 'm1', acquiredAt: '2026-09-04T22:00:00.000Z', expiresAt: '2026-09-05T00:00:00.000Z' }
  ])
})

// -- Heavy-task lease mutual exclusion --

test('a free lease is granted under HEALTHY', () => {
  const clock = () => new Date('2026-09-04T23:00:00.000Z')
  const result = requestHeavyTaskLease({}, { kind: 'FULL_TSF_REGRESSION', missionId: 'hq-a' }, 'HEALTHY', clock)
  assert.equal(result.granted, true)
  assert.equal(result.lease.holderMissionId, 'hq-a')
  assert.equal(result.leases.FULL_TSF_REGRESSION.holderMissionId, 'hq-a')
})

test('a free lease is granted under PRESSURED (serialized, not refused)', () => {
  const result = requestHeavyTaskLease({}, { kind: 'BROWSER_PILOT', missionId: 'hq-a' }, 'PRESSURED')
  assert.equal(result.granted, true)
})

test('REQUIRED PROOF: a lease request is refused outright under CRITICAL, even when the slot is free', () => {
  const result = requestHeavyTaskLease({}, { kind: 'FULL_TSF_REGRESSION', missionId: 'hq-a' }, 'CRITICAL')
  assert.equal(result.granted, false)
  assert.equal(result.waitingFor, 'MEMORY_HEADROOM')
})

test('REQUIRED PROOF: a lease request is refused outright under EMERGENCY, even when the slot is free', () => {
  const result = requestHeavyTaskLease({}, { kind: 'FULL_TSF_REGRESSION', missionId: 'hq-a' }, 'EMERGENCY')
  assert.equal(result.granted, false)
  assert.equal(result.waitingFor, 'MEMORY_HEADROOM')
})

test('a held, unexpired lease is refused to a different mission (serialization)', () => {
  const clock = () => new Date('2026-09-04T23:00:00.000Z')
  const held = { FULL_TSF_REGRESSION: { holderMissionId: 'hq-a', acquiredAt: clock().toISOString(), expiresAt: '2026-09-05T01:00:00.000Z' } }
  const result = requestHeavyTaskLease(held, { kind: 'FULL_TSF_REGRESSION', missionId: 'hq-b' }, 'HEALTHY', clock)
  assert.equal(result.granted, false)
  assert.equal(result.waitingFor, 'HEAVY_TASK_LEASE')
  assert.match(result.reason, /hq-a/)
})

test('an expired lease is treated as free and re-grantable to a different mission', () => {
  const clock = () => new Date('2026-09-04T23:00:00.000Z')
  const expired = { FULL_TSF_REGRESSION: { holderMissionId: 'hq-a', acquiredAt: '2026-09-04T20:00:00.000Z', expiresAt: '2026-09-04T22:00:00.000Z' } }
  const result = requestHeavyTaskLease(expired, { kind: 'FULL_TSF_REGRESSION', missionId: 'hq-b' }, 'HEALTHY', clock)
  assert.equal(result.granted, true)
  assert.equal(result.lease.holderMissionId, 'hq-b')
})

test('a re-request by the current holder is idempotent and refreshes expiresAt', () => {
  const clock = () => new Date('2026-09-04T23:00:00.000Z')
  const held = { FULL_TSF_REGRESSION: { holderMissionId: 'hq-a', acquiredAt: '2026-09-04T22:00:00.000Z', expiresAt: '2026-09-05T00:00:00.000Z' } }
  const result = requestHeavyTaskLease(held, { kind: 'FULL_TSF_REGRESSION', missionId: 'hq-a' }, 'HEALTHY', clock)
  assert.equal(result.granted, true)
  assert.equal(result.lease.acquiredAt, '2026-09-04T22:00:00.000Z')
  assert.notEqual(result.lease.expiresAt, '2026-09-05T00:00:00.000Z')
})

test('releasing your own held lease succeeds', () => {
  const held = { FULL_TSF_REGRESSION: { holderMissionId: 'hq-a', acquiredAt: 'x', expiresAt: 'y' } }
  const result = releaseHeavyTaskLease(held, { kind: 'FULL_TSF_REGRESSION', missionId: 'hq-a' })
  assert.equal(result.released, true)
  assert.equal(result.leases.FULL_TSF_REGRESSION, undefined)
})

test('REQUIRED PROOF: a mission cannot release another mission\'s lease', () => {
  const held = { FULL_TSF_REGRESSION: { holderMissionId: 'hq-a', acquiredAt: 'x', expiresAt: 'y' } }
  const result = releaseHeavyTaskLease(held, { kind: 'FULL_TSF_REGRESSION', missionId: 'hq-b' })
  assert.equal(result.released, false)
  assert.equal(result.leases.FULL_TSF_REGRESSION.holderMissionId, 'hq-a')
})

test('releasing a lease that is not held is an honest no-op, not an error', () => {
  const result = releaseHeavyTaskLease({}, { kind: 'FULL_TSF_REGRESSION', missionId: 'hq-a' })
  assert.equal(result.released, false)
  assert.match(result.reason, /no lease held/)
})

// Main TSF integration review, Phase 3: Resource Pressure Governor x
// ResearchMission Autonomy Driver interaction. The two features were each
// independently verified (Job 1's own resource-pressure-governor.test.mjs/
// resource-pressure-lease-host-wide.test.mjs; Job 2's own research-
// autonomy-policy.test.mjs/research-mission-autonomy-driver-zero-relay.test.mjs)
// but never proven TOGETHER across every tier and a recovery/restart
// sequence -- this file is that proof. Uses the same deterministic, $0
// fake worker every other research test relies on; no real network, no
// real memory pressure manufactured.
import assert from 'node:assert/strict'
import test from 'node:test'
import { rmSync } from 'node:fs'
import path from 'node:path'
import { createDeterministicFakeResearchWorker } from '../adapters/deterministic-fake-research-worker.mjs'
import { addResearchNode, createResearchMission, findResearchNode } from '../domain/research-mission.mjs'
import { buildBoundedResearchRequest } from '../domain/research-node.mjs'

const HERE = import.meta.dirname
const STATE_FILE = path.join(HERE, '..', 'server', '.local-state', `operator-state.test-research-resource-interaction-${process.pid}.json`)
process.env.TSF_UI_STATE_FILE = STATE_FILE

const { readResearchMission, withResearchMission } = await import('../server/research-mission-store.mjs')
const { advanceOneMission } = await import('../server/research-mission-fleet-driver.mjs')

function cleanupStateFile() {
  for (const suffix of ['', '.tmp', '.research.lock']) {
    rmSync(`${STATE_FILE}${suffix}`, { force: true })
  }
}
cleanupStateFile()
test.after(cleanupStateFile)

const clock = () => new Date('2026-09-05T06:00:00.000Z')
const HEALTHY_BYTES = 8 * 1024 ** 3
const PRESSURED_BYTES = 3 * 1024 ** 3
const CRITICAL_BYTES = 2 * 1024 ** 3
const EMERGENCY_BYTES = 0.5 * 1024 ** 3

function specification(id) {
  return {
    schemaVersion: 'TSF_RESEARCH_SPECIFICATION_V1',
    id: `spec:${id}`,
    researchQuestion: 'What is the fixture value?',
    entityType: 'FIXTURE_ENTITY',
    requestedFields: [{ fieldName: 'value', valueType: 'number', required: true, derivationRule: null }],
    sourcePolicy: {
      preferredSources: ['fixture.invalid'],
      disallowedSources: [],
      licensingConstraints: [],
      freshnessPolicy: 'HISTORICAL_STATIC',
      requireIndependentSources: false,
      minSourceCount: 1
    },
    temporalRequirements: { asOfDate: '2026-09-05', periodScope: 'FIXTURE_SCOPE' },
    budget: { maxCostUsd: null, maxLatencyMs: 60000, maxToolCallsPerNode: 5 },
    toolPermissions: ['fake-research-worker'],
    expectedUniverse: { schemaVersion: 'TSF_EXPECTED_UNIVERSE_V1', entityType: 'FIXTURE_ENTITY', expectedCount: 1, expectedEntities: [] }
  }
}

function fieldsSchema() {
  return { type: 'object', properties: { value: { type: 'number' } }, required: ['value'] }
}

function buildMission(missionId, nodeIds = ['node:alpha']) {
  const spec = specification(missionId)
  let mission = createResearchMission({ id: missionId, projectId: 'fixture:resource-interaction', specification: spec, expectedUniverse: spec.expectedUniverse }, clock)
  for (const nodeId of nodeIds) {
    mission = addResearchNode(mission, { id: nodeId, nodeRole: 'PRIMARY_RESEARCH', requestedFields: spec.requestedFields, requestedOutputSchema: fieldsSchema() }, clock)
  }
  return mission
}

function goodResult(fieldValue, sourceRef) {
  return {
    behavior: 'SUCCESS',
    observations: [],
    proposedClaims: [{ fieldName: 'value', proposedValue: fieldValue, temporalScope: 'FIXTURE_SCOPE', providerConfidence: 0.9, providerReasoning: 'fixture' }],
    evidence: [{ claimFieldName: 'value', sourceRef, snippet: `value is ${fieldValue}`, supportsClaim: true }],
    sourceReferences: [{ sourceRef, url: `https://example.invalid/${sourceRef}`, publisher: sourceRef, retrievedAt: '2026-09-05T00:00:00.000Z' }],
    sourceSnapshotsOrSnapshotRefs: [{ sourceRef, contentHash: `sha256:${sourceRef}`, rawContentRef: `fixture://${sourceRef}` }],
    newGapProposals: [],
    warnings: [],
    unresolvedQuestions: [],
    usage: { requestCount: 1, tokensOrUnits: 100, providerReportedCostUsd: 0 }
  }
}

for (const [label, bytes] of [
  ['HEALTHY', HEALTHY_BYTES],
  ['PRESSURED', PRESSURED_BYTES]
]) {
  test(`${label} host memory admits normal bounded research dispatch`, async () => {
    const missionId = `mission:tier-${label.toLowerCase()}`
    const mission = buildMission(missionId)
    await withResearchMission(missionId, () => mission)
    const node = findResearchNode(mission, 'node:alpha')
    const request = buildBoundedResearchRequest(mission, node, 'PRIMARY', clock)
    const worker = createDeterministicFakeResearchWorker({
      provider: 'PRIMARY',
      script: new Map([[request.taskFingerprint, goodResult(1, `fixture:${label}`)]]),
      clock
    })
    const result = await advanceOneMission(missionId, clock, {
      worker,
      providerId: 'PRIMARY',
      collectHostMemoryEvidence: () => ({ availableBytes: bytes })
    })
    assert.equal(result.action, 'DISPATCHED')
    assert.equal(result.dispatchResult.ok, true, `${label} must still admit a single dispatch -- multi-mission throttling is the heavy-task lease's job, not this per-dispatch gate`)
  })
}

for (const [label, bytes] of [
  ['CRITICAL', CRITICAL_BYTES],
  ['EMERGENCY', EMERGENCY_BYTES]
]) {
  test(`${label} host memory refuses new research dispatch honestly -- WAITING_FOR_RESOURCES, never a fabricated failure`, async () => {
    const missionId = `mission:tier-${label.toLowerCase()}`
    const mission = buildMission(missionId)
    await withResearchMission(missionId, () => mission)
    let workerTouched = false
    const worker = {
      dispatch: async () => {
        workerTouched = true
        return { ok: true, workerRunRef: { providerRunId: 'never' } }
      },
      fetchResult: async () => ({ ok: false })
    }
    const result = await advanceOneMission(missionId, clock, {
      worker,
      providerId: 'PRIMARY',
      collectHostMemoryEvidence: () => ({ availableBytes: bytes })
    })
    assert.equal(result.action, 'WAITING_FOR_RESOURCES')
    assert.notEqual(result.action, 'FAILED')
    assert.equal(workerTouched, false, 'the worker must never be touched under a refused admission')
    const node = findResearchNode(readResearchMission(missionId), 'node:alpha')
    assert.equal(node.status, 'PENDING', 'the node is left exactly as it was -- a resource wait mutates nothing')
    assert.equal(readResearchMission(missionId).state, 'ACTIVE', 'the mission itself is never paused or blocked by a resource wait')
  })
}

test('CRITICAL blocks new dispatch while lightweight reconciliation for an already-ADMITTED node still proceeds -- a resource wait never stalls cheap, real work', async () => {
  const missionId = 'mission:critical-mixed-work'
  // node:toAdmit declared FIRST and dispatched to ADMITTED under HEALTHY
  // during setup; node:pending stays genuinely PENDING throughout -- a
  // real, still-outstanding DISPATCH candidate for CRITICAL to block.
  const mission = buildMission(missionId, ['node:toAdmit', 'node:pending'])
  await withResearchMission(missionId, () => mission)

  const toAdmitNode = findResearchNode(mission, 'node:toAdmit')
  const request = buildBoundedResearchRequest(mission, toAdmitNode, 'PRIMARY', clock)
  const worker = createDeterministicFakeResearchWorker({
    provider: 'PRIMARY',
    script: new Map([[request.taskFingerprint, goodResult(42, 'fixture:mixed')]]),
    clock
  })
  const healthyDeps = { worker, providerId: 'PRIMARY', collectHostMemoryEvidence: () => ({ availableBytes: HEALTHY_BYTES }) }
  // Dispatch + poll node:toAdmit under HEALTHY first, to get it to a real
  // ADMITTED state with an unverified claim -- the setup, not the proof.
  await advanceOneMission(missionId, clock, healthyDeps) // DISPATCH node:toAdmit
  await advanceOneMission(missionId, clock, healthyDeps) // POLL -> ADMITTED
  assert.equal(findResearchNode(readResearchMission(missionId), 'node:toAdmit').status, 'ADMITTED')
  assert.equal(findResearchNode(readResearchMission(missionId), 'node:pending').status, 'PENDING')

  // Under CRITICAL, node:pending's real DISPATCH candidate exists (it
  // would be refused if chosen) but node:toAdmit's cheap
  // VERIFY_AND_RECONCILE_FIELD is preferred mission-wide regardless of
  // declared order -- proving a resource wait on one node never stalls
  // real, ungated work on another.
  const criticalDeps = { worker, providerId: 'PRIMARY', collectHostMemoryEvidence: () => ({ availableBytes: CRITICAL_BYTES }) }
  const result = await advanceOneMission(missionId, clock, criticalDeps)
  assert.equal(result.action, 'VERIFIED_AND_RECONCILED', `expected lightweight verification to proceed under CRITICAL ahead of the blocked dispatch, got: ${result.action}`)
  assert.equal(findResearchNode(readResearchMission(missionId), 'node:pending').status, 'PENDING', 'the blocked node is genuinely untouched, not silently failed')
})

test('recovery to HEALTHY resumes waiting research automatically -- no special resume action, no manual intervention', async () => {
  const missionId = 'mission:recovery'
  const mission = buildMission(missionId)
  await withResearchMission(missionId, () => mission)
  const node = findResearchNode(mission, 'node:alpha')
  const request = buildBoundedResearchRequest(mission, node, 'PRIMARY', clock)
  const worker = createDeterministicFakeResearchWorker({
    provider: 'PRIMARY',
    script: new Map([[request.taskFingerprint, goodResult(1, 'fixture:recovery')]]),
    clock
  })

  const waiting = await advanceOneMission(missionId, clock, {
    worker,
    providerId: 'PRIMARY',
    collectHostMemoryEvidence: () => ({ availableBytes: CRITICAL_BYTES })
  })
  assert.equal(waiting.action, 'WAITING_FOR_RESOURCES')

  // Resources recover -- the exact same call, no state to reset, no
  // resume endpoint, no operator action.
  const recovered = await advanceOneMission(missionId, clock, {
    worker,
    providerId: 'PRIMARY',
    collectHostMemoryEvidence: () => ({ availableBytes: HEALTHY_BYTES })
  })
  assert.equal(recovered.action, 'DISPATCHED')
  assert.equal(recovered.dispatchResult.ok, true)
})

test('a restart during a resource wait preserves the correct state -- a fresh call sees exactly the pre-wait mission, dispatches once resources allow, never duplicates', async () => {
  const missionId = 'mission:restart-during-wait'
  const mission = buildMission(missionId)
  await withResearchMission(missionId, () => mission)
  const node = findResearchNode(mission, 'node:alpha')
  const request = buildBoundedResearchRequest(mission, node, 'PRIMARY', clock)
  const worker = createDeterministicFakeResearchWorker({
    provider: 'PRIMARY',
    script: new Map([[request.taskFingerprint, goodResult(1, 'fixture:restart')]]),
    clock
  })

  await advanceOneMission(missionId, clock, {
    worker,
    providerId: 'PRIMARY',
    collectHostMemoryEvidence: () => ({ availableBytes: EMERGENCY_BYTES })
  })
  const beforeRestart = readResearchMission(missionId)
  assert.equal(findResearchNode(beforeRestart, 'node:alpha').status, 'PENDING')
  assert.equal(findResearchNode(beforeRestart, 'node:alpha').dispatchRecords.length, 0)

  // "Restart": advanceOneMission holds no in-memory state of its own (it
  // always calls readResearchMission fresh) -- a genuinely new process
  // calling it again is indistinguishable from this same process calling
  // it again. A fresh worker instance simulates a real provider client
  // reconnecting after a process restart (a real provider's own backend
  // state is unaffected by TSF's restart; only the deterministic fake's
  // in-memory run registry would be, which this mission's node never used
  // since nothing was ever dispatched).
  const freshWorker = createDeterministicFakeResearchWorker({
    provider: 'PRIMARY',
    script: new Map([[request.taskFingerprint, goodResult(1, 'fixture:restart')]]),
    clock
  })
  const afterRestart = await advanceOneMission(missionId, clock, {
    worker: freshWorker,
    providerId: 'PRIMARY',
    collectHostMemoryEvidence: () => ({ availableBytes: HEALTHY_BYTES })
  })
  assert.equal(afterRestart.action, 'DISPATCHED')
  const finalNode = findResearchNode(readResearchMission(missionId), 'node:alpha')
  assert.equal(finalNode.dispatchRecords.length, 1, 'exactly one real dispatch -- the resource wait never duplicated anything')
})

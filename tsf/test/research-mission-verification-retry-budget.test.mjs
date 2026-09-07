// Phase 9 (Research Autonomy Chaos / Soak Test) real generic finding,
// sibling to Finding F5 (research-mission-clean-dispatch-failure.test.mjs).
// F5 fixed "a CLEAN DISPATCH failure leaves the node at READY forever,
// bypassing retry budget." This is the SAME class of bug on a genuinely
// different trigger F5 never covered: a node whose dispatch SUCCEEDS but
// whose sole, non-conflicting claim then FAILS INDEPENDENT VERIFICATION
// (REJECTED via contradicting evidence, or stays INCONCLUSIVE with zero
// evidence). decideRetryOrEscalate correctly decides RETRY_DISPATCH, but
// recordResearchNodeAttempt's own RETRY branch sets the node's execution
// status back to READY -- the SAME status a never-before-attempted node
// starts from -- and decideNextNodeAction's READY branch always returned a
// fresh, unconditional DISPATCH, never consulting retryCount/budget.
// Reproduced BEFORE this fix with the plain, generic
// deterministic-fake-research-worker (no NFL/NWR fixture, no specific
// provider): retryCount froze at 1 forever, 8+ real ticks each returned
// DISPATCHED, ESCALATE was structurally unreachable.
import assert from 'node:assert/strict'
import test from 'node:test'
import { rmSync } from 'node:fs'
import path from 'node:path'

const STATE_FILE = path.join(import.meta.dirname, '..', 'server', '.local-state', `operator-state.test-verification-retry-budget-${process.pid}.json`)
process.env.TSF_UI_STATE_FILE = STATE_FILE
process.env.TSF_RESOURCE_PRESSURE_TEST_TOTAL_BYTES = String(16 * 1024 ** 3)
process.env.TSF_RESOURCE_PRESSURE_TEST_FREE_BYTES = String(8 * 1024 ** 3)
function cleanupStateFile() {
  for (const suffix of ['', '.tmp', '.research.lock']) { rmSync(`${STATE_FILE}${suffix}`, { force: true }) }
}
cleanupStateFile()
test.after(cleanupStateFile)

const { createDeterministicFakeResearchWorker } = await import('../adapters/deterministic-fake-research-worker.mjs')
const { buildBoundedResearchRequest } = await import('../domain/research-node.mjs')
const {
  createResearchMissionDurable,
  dispatchResearchNodeDurable,
  pollAndAdmitResearchNodeDurable
} = await import('../server/research-mission-driver.mjs')
const { readResearchMission } = await import('../server/research-mission-store.mjs')
const { advanceOneMission } = await import('../server/research-mission-fleet-driver.mjs')

const clock = () => new Date('2026-09-07T12:00:00.000Z')

async function setupMission(missionId) {
  const spec = {
    schemaVersion: 'TSF_RESEARCH_SPECIFICATION_V1',
    id: `spec:${missionId}`,
    researchQuestion: 'q',
    entityType: 'FIXTURE',
    requestedFields: [{ fieldName: 'value', valueType: 'number', required: true }],
    sourcePolicy: { preferredSources: [], disallowedSources: [], licensingConstraints: [], freshnessPolicy: 'UNSPECIFIED', requireIndependentSources: false, minSourceCount: 0 },
    temporalRequirements: { asOfDate: '2026-09-07', periodScope: 'FIXTURE_SCOPE' },
    budget: { maxCostUsd: 0, maxLatencyMs: null, maxToolCallsPerNode: null },
    toolPermissions: []
  }
  await createResearchMissionDurable(
    missionId,
    {
      projectId: 'test',
      specification: spec,
      expectedUniverse: { schemaVersion: 'TSF_EXPECTED_UNIVERSE_V1', entityType: 'FIXTURE', expectedCount: 1, expectedEntities: [] },
      nodes: [{ id: 'node:x', nodeRole: 'PRIMARY_RESEARCH', targetEntity: { entityId: 'e' }, requestedFields: spec.requestedFields, requestedOutputSchema: { type: 'object' } }]
    },
    clock
  )
  return spec
}

test('a sole claim genuinely REJECTED by contradicting evidence retries within budget then escalates -- never an unbounded READY retry loop', async () => {
  const missionId = 'mission:verification-retry-budget-rejected'
  await setupMission(missionId)
  const script = new Map()
  const worker = createDeterministicFakeResearchWorker({ provider: 'FAKE_A', clock, script })
  const mission = readResearchMission(missionId)
  const req = buildBoundedResearchRequest(mission, mission.nodes[0], 'FAKE_A', clock)
  script.set(req.taskFingerprint, {
    proposedClaims: [{ fieldName: 'value', proposedValue: 42, temporalScope: 'FIXTURE_SCOPE', providerConfidence: 0.9, providerReasoning: 'r' }],
    evidence: [{ claimFieldName: 'value', sourceRef: 'src:1', snippet: 'contradicts', supportsClaim: false }],
    sourceReferences: [{ sourceRef: 'src:1', url: 'https://example.invalid', publisher: 'pub', retrievedAt: clock().toISOString() }],
    sourceSnapshotsOrSnapshotRefs: []
  })
  await dispatchResearchNodeDurable(missionId, 'node:x', 'FAKE_A', worker, clock)
  await pollAndAdmitResearchNodeDurable(missionId, 'node:x', worker, clock)

  const deps = { worker, providerId: 'FAKE_A' }

  // Tick 0: verifies the claim for real -- FAIL verdict (contradicting
  // evidence), claim REJECTED. Node stays ADMITTED (no legal ADMITTED->FAILED
  // transition for a verification-only failure, by design).
  const tick0 = await advanceOneMission(missionId, clock, deps)
  assert.equal(tick0.action, 'VERIFIED_AND_RECONCILED')
  let node = readResearchMission(missionId).nodes[0]
  assert.equal(node.claims[0].status, 'REJECTED')
  assert.equal(node.retryCount, 0)

  // Tick 1: RETRY_DISPATCH (retryCount 0 < budget 2) -> retryCount becomes
  // 1, node lands at READY (recordResearchNodeAttempt's own shape).
  const tick1 = await advanceOneMission(missionId, clock, deps)
  assert.equal(tick1.action, 'DISPATCHED')
  node = readResearchMission(missionId).nodes[0]
  assert.equal(node.status, 'READY')
  assert.equal(node.retryCount, 1, 'the real retry budget must accumulate on this node\'s own verification-failure history')

  // Tick 2 -- THE REQUIRED PROOF: a READY node with retryCount 1 must
  // retry again (budget-tracked), never a fresh, unconditional DISPATCH
  // that would leave retryCount frozen forever.
  const tick2 = await advanceOneMission(missionId, clock, deps)
  assert.equal(tick2.action, 'DISPATCHED')
  node = readResearchMission(missionId).nodes[0]
  assert.equal(node.retryCount, 2, 'retryCount must keep accumulating past 1 -- the exact point the pre-fix bug froze forever')

  // Tick 3: retryCount 2 >= budget(2) -> ESCALATE, real BLOCKED status,
  // real Needs You -- reached at all, not merely "eventually" (bounded).
  const tick3 = await advanceOneMission(missionId, clock, deps)
  assert.equal(tick3.action, 'ESCALATED')
  const finalMission = readResearchMission(missionId)
  assert.equal(finalMission.nodes[0].status, 'BLOCKED')
  assert.equal(finalMission.state, 'NEEDS_YOU')
  assert.equal(finalMission.needsYou.filter((n) => !n.resolvedAt).length, 1)
  assert.equal(finalMission.nodes[0].canonicalFacts.length, 0, 'the rejected value was never silently accepted')

  // Ticks after escalation are true no-ops -- never resumes the loop.
  const tick4 = await advanceOneMission(missionId, clock, deps)
  assert.equal(tick4.action, 'SKIPPED')
  assert.equal(readResearchMission(missionId).nodes[0].retryCount, 2, 'retryCount must never increment again once genuinely escalated')
})

test('a sole claim that stays INCONCLUSIVE (zero evidence) retries within budget then escalates -- same fix, different verdict', async () => {
  const missionId = 'mission:verification-retry-budget-inconclusive'
  await setupMission(missionId)
  const script = new Map()
  const worker = createDeterministicFakeResearchWorker({ provider: 'FAKE_A', clock, script })
  const mission = readResearchMission(missionId)
  const req = buildBoundedResearchRequest(mission, mission.nodes[0], 'FAKE_A', clock)
  script.set(req.taskFingerprint, {
    proposedClaims: [{ fieldName: 'value', proposedValue: 42, temporalScope: 'FIXTURE_SCOPE', providerConfidence: 0.9, providerReasoning: 'r' }],
    evidence: [],
    sourceReferences: [],
    sourceSnapshotsOrSnapshotRefs: []
  })
  await dispatchResearchNodeDurable(missionId, 'node:x', 'FAKE_A', worker, clock)
  await pollAndAdmitResearchNodeDurable(missionId, 'node:x', worker, clock)

  const deps = { worker, providerId: 'FAKE_A' }
  let lastAction = null
  for (let i = 0; i < 5; i++) {
    // eslint-disable-next-line no-await-in-loop -- sequential real driver ticks
    const tick = await advanceOneMission(missionId, clock, deps)
    lastAction = tick.action
    if (lastAction === 'ESCALATED') { break }
  }
  assert.equal(lastAction, 'ESCALATED', 'a zero-evidence claim (INCONCLUSIVE, never PASS) must reach real escalation within a bounded number of ticks, never loop forever')
  const finalMission = readResearchMission(missionId)
  assert.equal(finalMission.state, 'NEEDS_YOU')
  assert.equal(finalMission.nodes[0].canonicalFacts.length, 0)
})

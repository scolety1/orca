// Phase 9 (Research Autonomy Chaos / Soak Test), scenario #7: "provider
// failure mid-mission -- a worker that fails partway through a multi-node
// mission -- verify the mission correctly isolates the failure to the
// affected node(s) without corrupting the rest."
//
// research-autonomy-policy.test.mjs already proves the underlying tier
// priority (POLL/VERIFY_AND_RECONCILE_FIELD before DISPATCH before ESCALATE)
// at the pure decideNextMissionAction level, single tick, in-memory. This
// file is the genuinely under-tested composed-mission proof: a REAL,
// multi-tick run through the real durable driver
// (research-mission-fleet-driver.mjs's advanceOneMission), reusing F5's
// clean-dispatch-failure retry/escalate machinery unmodified, confirming a
// SIBLING node's real durable progress (dispatch, admission, verification,
// canonicalization) is never lost, corrupted, or blocked by the failing
// node's own dispatch/retry/escalation history.
import assert from 'node:assert/strict'
import test from 'node:test'
import { rmSync } from 'node:fs'
import path from 'node:path'

const STATE_FILE = path.join(import.meta.dirname, '..', 'server', '.local-state', `operator-state.test-multi-node-isolation-${process.pid}.json`)
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
const { createResearchMissionDurable } = await import('../server/research-mission-driver.mjs')
const { readResearchMission } = await import('../server/research-mission-store.mjs')
const { advanceOneMission } = await import('../server/research-mission-fleet-driver.mjs')

const clock = () => new Date('2026-09-07T12:00:00.000Z')

test('a real, deterministic provider that cleanly fails on one node never corrupts, delays past its due priority, or blocks a healthy sibling node\'s durable progress', async () => {
  const missionId = 'mission:multi-node-failure-isolation'
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
      // node:healthy declared FIRST -- the SAME real deterministic worker
      // instance is shared by both nodes; node:failing's own taskFingerprint
      // is DELIBERATELY never scripted, so its every dispatch attempt is a
      // real, clean {ok:false, reason:'NO_SCRIPT_FOR_FINGERPRINT'} -- the
      // exact "provider fails" shape F5's own regression test uses.
      expectedUniverse: { schemaVersion: 'TSF_EXPECTED_UNIVERSE_V1', entityType: 'FIXTURE', expectedCount: 2, expectedEntities: [{ entityId: 'entity-healthy', identityHints: {} }, { entityId: 'entity-failing', identityHints: {} }] },
      nodes: [
        { id: 'node:healthy', nodeRole: 'PRIMARY_RESEARCH', targetEntity: { entityId: 'entity-healthy' }, requestedFields: spec.requestedFields, requestedOutputSchema: { type: 'object' } },
        { id: 'node:failing', nodeRole: 'PRIMARY_RESEARCH', targetEntity: { entityId: 'entity-failing' }, requestedFields: spec.requestedFields, requestedOutputSchema: { type: 'object' } }
      ]
    },
    clock
  )

  const script = new Map()
  const worker = createDeterministicFakeResearchWorker({ provider: 'FAKE_A', clock, script })
  const mission = readResearchMission(missionId)
  const healthyReq = buildBoundedResearchRequest(mission, mission.nodes.find((n) => n.id === 'node:healthy'), 'FAKE_A', clock)
  script.set(healthyReq.taskFingerprint, {
    proposedClaims: [{ fieldName: 'value', proposedValue: 7, temporalScope: 'FIXTURE_SCOPE', providerConfidence: 0.9, providerReasoning: 'r' }],
    evidence: [{ claimFieldName: 'value', sourceRef: 'src:1', snippet: 's', supportsClaim: true }],
    sourceReferences: [{ sourceRef: 'src:1', url: 'https://example.invalid', publisher: 'pub', retrievedAt: clock().toISOString() }],
    sourceSnapshotsOrSnapshotRefs: []
  })
  // node:failing's real taskFingerprint is intentionally left unscripted.

  const deps = { worker, providerId: 'FAKE_A' }

  // Tick 0: both nodes need DISPATCH (tier 1, no cheaper work exists yet) --
  // node:healthy is declared first, so it real-dispatches first.
  const tick0 = await advanceOneMission(missionId, clock, deps)
  assert.equal(tick0.nodeId, 'node:healthy')
  assert.equal(tick0.action, 'DISPATCHED')
  assert.equal(tick0.dispatchResult.ok, true)

  // Tick 1: node:healthy is now DISPATCHED -> real POLL is tier 0, strictly
  // preferred over node:failing's still-pending tier-1 DISPATCH -- proves
  // tier priority for real, through the actual driver, not just the pure
  // decision function.
  const tick1 = await advanceOneMission(missionId, clock, deps)
  assert.equal(tick1.nodeId, 'node:healthy')
  assert.equal(tick1.action, 'POLLED')
  assert.equal(readResearchMission(missionId).nodes.find((n) => n.id === 'node:healthy').status, 'ADMITTED')

  // Tick 2: node:healthy ADMITTED with an unverified claim -> tier 0 again,
  // still strictly ahead of node:failing's dispatch.
  const tick2 = await advanceOneMission(missionId, clock, deps)
  assert.equal(tick2.nodeId, 'node:healthy')
  assert.equal(tick2.action, 'VERIFIED_AND_RECONCILED')
  const healthySnapshot = readResearchMission(missionId).nodes.find((n) => n.id === 'node:healthy')
  assert.equal(healthySnapshot.canonicalFacts.length, 1, 'node:healthy reaches a real CanonicalFact BEFORE node:failing is ever even dispatched once')
  assert.equal(healthySnapshot.canonicalFacts[0].value, 7)

  // node:healthy now has nothing left to do -- every remaining tick is
  // node:failing's real clean-dispatch-failure/retry/escalate arc (F5's own
  // mechanism, unmodified, reused here). Re-read node:healthy after EVERY
  // tick and assert byte-for-byte it never changes.
  for (let i = 3; i <= 6; i++) {
    // eslint-disable-next-line no-await-in-loop -- sequential real driver ticks
    const tick = await advanceOneMission(missionId, clock, deps)
    assert.equal(tick.nodeId, 'node:failing', `tick ${i} must only ever touch the failing node`)
    const current = readResearchMission(missionId)
    assert.deepEqual(current.nodes.find((n) => n.id === 'node:healthy'), healthySnapshot, `tick ${i}: node:failing's own failure/retry history must never mutate node:healthy's durable state`)
  }

  const final = readResearchMission(missionId)
  const failingNode = final.nodes.find((n) => n.id === 'node:failing')
  assert.equal(failingNode.status, 'BLOCKED', 'the failing node\'s own retry budget genuinely exhausted and it was escalated, isolated to itself')
  assert.equal(failingNode.canonicalFacts.length, 0)
  assert.equal(final.state, 'NEEDS_YOU')
  assert.equal(final.needsYou.filter((n) => !n.resolvedAt).length, 1)
  assert.equal(final.needsYou[0].nodeId, 'node:failing', 'the Needs You entry names the ACTUAL affected node, never the healthy one')

  // Final, decisive proof of "no corruption": node:healthy's real canonical
  // value survives completely untouched by node:failing's escalation to
  // BLOCKED/NEEDS_YOU, even though the WHOLE MISSION is now correctly
  // unable to progress further (a real, honest, mission-wide consequence
  // of one genuinely unresolved node -- never silently hidden either).
  const healthyFinal = final.nodes.find((n) => n.id === 'node:healthy')
  assert.deepEqual(healthyFinal, healthySnapshot)
})

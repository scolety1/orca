// Phase 9 (Research Autonomy Chaos / Soak Test): two real, generic gaps
// found while proving scenarios #3 (incomplete expected universe) and #6
// (identity ambiguity) through the REAL autonomous driver
// (research-mission-fleet-driver.mjs), not just the pure domain layer
// research-epistemic-ladder.test.mjs already covers.
//
// BOTH gaps share the same root shape: CHECK_COMPLETE's fallback branch
// ("every node is terminal but completeness is not yet fully satisfied")
// silently returned SKIPPED forever, with NO real Needs You ever raised --
// there was simply no node left for any EXISTING escalation mechanism to
// attach to. Fixed by reusing the SAME raiseResearchNeedsYou mechanism
// every other real escalation in this codebase already uses, with the
// SAME two Needs You categories (AMBIGUOUS_IDENTITY, UNIVERSE_AMBIGUITY)
// that already existed in RESEARCH_NEEDS_YOU_CATEGORIES but were never
// actually raised by any real caller before this fix (confirmed by grep
// before writing this test -- both were dead vocabulary).
import assert from 'node:assert/strict'
import test from 'node:test'
import { rmSync } from 'node:fs'
import path from 'node:path'

const STATE_FILE = path.join(import.meta.dirname, '..', 'server', '.local-state', `operator-state.test-completion-honesty-${process.pid}.json`)
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
const { recordIdentityResolutionState } = await import('../domain/research-admission.mjs')
const { resolveResearchNeedsYou } = await import('../domain/research-mission.mjs')
const {
  createResearchMissionDurable,
  dispatchResearchNodeDurable,
  pollAndAdmitResearchNodeDurable
} = await import('../server/research-mission-driver.mjs')
const { readResearchMission, withResearchMission } = await import('../server/research-mission-store.mjs')
const { advanceOneMission } = await import('../server/research-mission-fleet-driver.mjs')

const clock = () => new Date('2026-09-07T12:00:00.000Z')

function spec(id) {
  return {
    schemaVersion: 'TSF_RESEARCH_SPECIFICATION_V1',
    id: `spec:${id}`,
    researchQuestion: 'q',
    entityType: 'FIXTURE',
    requestedFields: [{ fieldName: 'value', valueType: 'number', required: true }],
    sourcePolicy: { preferredSources: [], disallowedSources: [], licensingConstraints: [], freshnessPolicy: 'UNSPECIFIED', requireIndependentSources: false, minSourceCount: 0 },
    temporalRequirements: { asOfDate: '2026-09-07', periodScope: 'FIXTURE_SCOPE' },
    budget: { maxCostUsd: 0, maxLatencyMs: null, maxToolCallsPerNode: null },
    toolPermissions: []
  }
}

async function dispatchAndAdmitOneClaim(missionId, nodeId, worker, script) {
  const mission = readResearchMission(missionId)
  const req = buildBoundedResearchRequest(mission, mission.nodes.find((n) => n.id === nodeId), 'FAKE_A', clock)
  script.set(req.taskFingerprint, {
    proposedClaims: [{ fieldName: 'value', proposedValue: 42, temporalScope: 'FIXTURE_SCOPE', providerConfidence: 0.9, providerReasoning: 'r' }],
    evidence: [{ claimFieldName: 'value', sourceRef: 'src:1', snippet: 's', supportsClaim: true }],
    sourceReferences: [{ sourceRef: 'src:1', url: 'https://example.invalid', publisher: 'pub', retrievedAt: clock().toISOString() }],
    sourceSnapshotsOrSnapshotRefs: []
  })
  const dispatched = await dispatchResearchNodeDurable(missionId, nodeId, 'FAKE_A', worker, clock)
  assert.equal(dispatched.ok, true)
  const polled = await pollAndAdmitResearchNodeDurable(missionId, nodeId, worker, clock)
  assert.equal(polled.ok, true)
}

test('#6 IDENTITY AMBIGUITY: a real autonomous-driver run never silently strands the mission -- it honestly escalates to NEEDS_YOU, never canonicalizes, never throws uncaught', async () => {
  const missionId = 'mission:completion-honesty-identity'
  const script = new Map()
  const worker = createDeterministicFakeResearchWorker({ provider: 'FAKE_A', clock, script })
  await createResearchMissionDurable(
    missionId,
    {
      projectId: 'test',
      specification: spec(missionId),
      expectedUniverse: { schemaVersion: 'TSF_EXPECTED_UNIVERSE_V1', entityType: 'FIXTURE', expectedCount: 1, expectedEntities: [] },
      nodes: [{ id: 'node:x', nodeRole: 'PRIMARY_RESEARCH', targetEntity: { entityId: 'ambiguous-entity' }, requestedFields: [{ fieldName: 'value', valueType: 'number', required: true }], requestedOutputSchema: { type: 'object' } }]
    },
    clock
  )
  await dispatchAndAdmitOneClaim(missionId, 'node:x', worker, script)
  await withResearchMission(missionId, (m) =>
    recordIdentityResolutionState(m, 'node:x', { candidateEntityRefs: [{ id: 'a' }, { id: 'b' }], resolvedEntityId: null, status: 'AMBIGUOUS', rationale: 'two real, equally plausible entities' }, clock, m.revision)
  )

  // Drives the REAL production driver repeatedly -- the exact way a real
  // background tick loop would call it. Must never throw uncaught (the
  // pre-fix behavior: admitReconciliationDecision's own
  // TSF_IDENTITY_AMBIGUOUS_CANNOT_CANONICALIZE propagated straight out of
  // this call).
  for (let i = 0; i < 4; i++) {
    // eslint-disable-next-line no-await-in-loop -- sequential real driver ticks, each depends on the previous durable state
    await advanceOneMission(missionId, clock, { worker, providerId: 'FAKE_A' })
  }

  const mission = readResearchMission(missionId)
  assert.equal(mission.state, 'NEEDS_YOU', 'a genuinely ambiguous identity must be honestly escalated to a human, never left silently ACTIVE-but-stuck')
  assert.equal(mission.nodes[0].canonicalFacts.length, 0, 'never silently resolved to a guess')
  const entry = mission.needsYou.find((n) => n.category === 'AMBIGUOUS_IDENTITY' && !n.resolvedAt)
  assert.ok(entry, 'a real, human-visible Needs You entry must exist for this exact reason')
  assert.equal(entry.nodeId, 'node:x')

  // Resolving identity, then re-driving, completes normally -- proves this
  // is a real, recoverable escalation, not a permanent dead end.
  await withResearchMission(missionId, (m) =>
    recordIdentityResolutionState(m, 'node:x', { candidateEntityRefs: [{ id: 'a' }, { id: 'b' }], resolvedEntityId: 'a', status: 'RESOLVED', rationale: 'a human confirmed entity a' }, clock, m.revision)
  )
  await withResearchMission(missionId, (m) => resolveResearchNeedsYou(m, entry.id, { note: 'identity resolved by a human' }, clock, m.revision))
  let finalTick = null
  for (let i = 0; i < 4; i++) {
    // eslint-disable-next-line no-await-in-loop
    finalTick = await advanceOneMission(missionId, clock, { worker, providerId: 'FAKE_A' })
    if (finalTick.action === 'COMPLETED') { break }
  }
  assert.equal(finalTick.action, 'COMPLETED', 'once identity is genuinely resolved, the exact same node completes normally through the real driver')
  assert.equal(readResearchMission(missionId).nodes[0].canonicalFacts[0].value, 42)
})

test('#3 INCOMPLETE EXPECTED UNIVERSE: a real autonomous-driver run never silently reports a partially-researched universe as COMPLETE', async () => {
  const missionId = 'mission:completion-honesty-universe'
  const script = new Map()
  const worker = createDeterministicFakeResearchWorker({ provider: 'FAKE_A', clock, script })
  // expectedUniverse names TWO entities; only ONE ever becomes a node --
  // e.g. a planner/spec-synthesis step that under-built the node set. No
  // mechanism anywhere ever creates the missing node automatically.
  await createResearchMissionDurable(
    missionId,
    {
      projectId: 'test',
      specification: spec(missionId),
      expectedUniverse: { schemaVersion: 'TSF_EXPECTED_UNIVERSE_V1', entityType: 'FIXTURE', expectedCount: 2, expectedEntities: [{ entityId: 'entity-a', identityHints: {} }, { entityId: 'entity-b', identityHints: {} }] },
      nodes: [{ id: 'node:a', nodeRole: 'PRIMARY_RESEARCH', targetEntity: { entityId: 'entity-a' }, requestedFields: [{ fieldName: 'value', valueType: 'number', required: true }], requestedOutputSchema: { type: 'object' } }]
    },
    clock
  )
  await dispatchAndAdmitOneClaim(missionId, 'node:a', worker, script)

  let lastTick = null
  for (let i = 0; i < 5; i++) {
    // eslint-disable-next-line no-await-in-loop
    lastTick = await advanceOneMission(missionId, clock, { worker, providerId: 'FAKE_A' })
    if (lastTick.action === 'COMPLETED' || lastTick.action === 'ESCALATED') { break }
  }

  assert.notEqual(lastTick.action, 'COMPLETED', 'node:a alone resolving its own field must never be reported as the whole expected universe being done')
  const mission = readResearchMission(missionId)
  assert.equal(mission.state, 'NEEDS_YOU', 'a genuinely uncovered expected universe must be honestly escalated, not silently completed and not silently stuck forever')
  const entry = mission.needsYou.find((n) => n.category === 'UNIVERSE_AMBIGUITY' && !n.resolvedAt)
  assert.ok(entry, 'a real, human-visible Needs You entry must name the coverage gap')
  assert.match(entry.question, /entity-b/, 'must honestly name the specific missing entity, never a vague generic message')
  assert.equal(mission.nodes[0].canonicalFacts.length, 1, 'node:a\'s own real, genuine progress is preserved -- the escalation does not corrupt or roll back what was actually resolved')
})

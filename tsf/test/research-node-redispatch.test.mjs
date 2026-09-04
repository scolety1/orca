// Wave 0 preflight, item B: ADMITTED -> READY is permitted for another
// bounded research attempt/provider (multi-source cross-validation).
// Mechanically proves the properties HQ required rather than relying on
// the fact that the NFL fixture's Warner/Miller scenarios happen to
// exercise this path incidentally.
import assert from 'node:assert/strict'
import test from 'node:test'
import { admitBoundedResearchResult } from '../domain/research-admission.mjs'
import { addResearchNode, createResearchMission } from '../domain/research-mission.mjs'
import { buildBoundedResearchRequest, markResearchNodeReady, recordResearchNodeDispatch, recordResearchNodeResult } from '../domain/research-node.mjs'
import { buildNflQb2001Specification } from '../fixtures/nfl-2001-qb-research-fixture.mjs'

const clock = () => new Date('2026-09-20T10:00:00.000Z')

function baseMission() {
  const specification = buildNflQb2001Specification()
  let mission = createResearchMission({ id: 'm', projectId: 'p', specification, expectedUniverse: specification.expectedUniverse }, clock)
  mission = addResearchNode(mission, { id: 'node:x', nodeRole: 'PRIMARY_RESEARCH', targetEntity: { entityId: 'e' }, requestedFields: [{ fieldName: 'yards', valueType: 'number', required: true }], requestedOutputSchema: {} }, clock)
  return mission
}

function result(request, provider, value) {
  return {
    schemaVersion: 'TSF_BOUNDED_RESEARCH_RESULT_V1',
    nodeId: request.nodeId,
    taskFingerprint: request.taskFingerprint,
    provider,
    providerRunRef: { provider, providerRunId: `run-${provider}`, dispatchedAt: clock().toISOString() },
    status: 'SUCCEEDED',
    observations: [{ rawContent: `raw from ${provider}`, extractedAt: clock().toISOString(), providerConfidence: 0.9, providerReasoning: 'r' }],
    proposedClaims: [{ fieldName: 'yards', proposedValue: value, providerConfidence: 0.9, providerReasoning: 'r' }],
    evidence: [{ claimFieldName: 'yards', sourceRef: `src:${provider}`, snippet: `from ${provider}`, supportsClaim: true }],
    sourceReferences: [{ sourceRef: `src:${provider}`, url: `https://example.invalid/${provider}`, publisher: provider, retrievedAt: clock().toISOString() }],
    sourceSnapshotsOrSnapshotRefs: [{ sourceRef: `src:${provider}`, contentHash: `sha256:${provider}`, rawContentRef: `fixture://${provider}` }],
    newGapProposals: [],
    warnings: [],
    unresolvedQuestions: [],
    usage: { requestCount: 1, tokensOrUnits: 1, providerReportedCostUsd: 0 },
    failureDetails: null
  }
}

function dispatchAndAdmit(mission, provider, value) {
  const request = buildBoundedResearchRequest(mission, mission.nodes.find((n) => n.id === 'node:x'), provider, clock)
  let next = markResearchNodeReady(mission, 'node:x', clock, mission.revision)
  const r = result(request, provider, value)
  next = recordResearchNodeDispatch(next, 'node:x', { taskFingerprint: request.taskFingerprint, workerRunRef: r.providerRunRef }, clock, next.revision)
  next = recordResearchNodeResult(next, 'node:x', r, clock, next.revision)
  const digest = next.nodes[0].rawResults.at(-1).digest
  next = admitBoundedResearchResult(next, 'node:x', digest, clock, next.revision)
  return next
}

test('previously admitted observations/claims/evidence remain durable across a second dispatch cycle', () => {
  let mission = dispatchAndAdmit(baseMission(), 'PROVIDER_A', 100)
  assert.equal(mission.nodes[0].claims.length, 1)
  assert.equal(mission.nodes[0].observations.length, 1)
  assert.equal(mission.nodes[0].evidence.length, 1)
  const firstClaimId = mission.nodes[0].claims[0].id
  const firstObservationId = mission.nodes[0].observations[0].id
  const firstEvidenceId = mission.nodes[0].evidence[0].id

  mission = dispatchAndAdmit(mission, 'PROVIDER_B', 150)

  assert.equal(mission.nodes[0].claims.length, 2, 'the second cycle adds a claim, never replaces the first')
  assert.equal(mission.nodes[0].observations.length, 2)
  assert.equal(mission.nodes[0].evidence.length, 2)
  assert.ok(mission.nodes[0].claims.some((c) => c.id === firstClaimId), 'the first claim record is byte-identical and still present')
  assert.ok(mission.nodes[0].observations.some((o) => o.id === firstObservationId))
  assert.ok(mission.nodes[0].evidence.some((e) => e.id === firstEvidenceId))
})

test('attempt/provider-run identities remain distinct across dispatch cycles -- never collapsed or overwritten', () => {
  let mission = dispatchAndAdmit(baseMission(), 'PROVIDER_A', 100)
  mission = dispatchAndAdmit(mission, 'PROVIDER_B', 150)
  const dispatchRecords = mission.nodes[0].dispatchRecords
  assert.equal(dispatchRecords.length, 2)
  const fingerprints = dispatchRecords.map((d) => d.taskFingerprint)
  const runIds = dispatchRecords.map((d) => d.workerRunRef.providerRunId)
  assert.equal(new Set(fingerprints).size, 2, 'each dispatch cycle has its own distinct taskFingerprint')
  assert.equal(new Set(runIds).size, 2, 'each dispatch cycle has its own distinct providerRunId')
  const rawResultDigests = mission.nodes[0].rawResults.map((r) => r.digest)
  assert.equal(new Set(rawResultDigests).size, 2, 'each raw result is separately, distinctly stored')
})

test('re-dispatch does not erase previous evidence -- source references/snapshots accumulate, never truncate', () => {
  let mission = dispatchAndAdmit(baseMission(), 'PROVIDER_A', 100)
  const firstSourceCount = mission.nodes[0].sourceReferences.length
  const firstSnapshotCount = mission.nodes[0].sourceSnapshots.length
  mission = dispatchAndAdmit(mission, 'PROVIDER_B', 150)
  assert.ok(mission.nodes[0].sourceReferences.length > firstSourceCount)
  assert.ok(mission.nodes[0].sourceSnapshots.length > firstSnapshotCount)
})

test('COMPLETED remains the actual terminal execution state -- no transition out of it', () => {
  let mission = dispatchAndAdmit(baseMission(), 'PROVIDER_A', 100)
  mission = { ...mission, nodes: [{ ...mission.nodes[0], status: 'COMPLETED' }] }
  assert.throws(
    () => markResearchNodeReady(mission, 'node:x', clock, mission.revision),
    /invalid research node transition: COMPLETED -> READY/
  )
})

test('duplicate delivery of an already-admitted result remains harmless during a multi-cycle node', () => {
  let mission = dispatchAndAdmit(baseMission(), 'PROVIDER_A', 100)
  mission = dispatchAndAdmit(mission, 'PROVIDER_B', 150)
  const revisionBefore = mission.revision
  const claimCountBefore = mission.nodes[0].claims.length
  // Redeliver the FIRST cycle's already-admitted digest again.
  const firstDigest = mission.nodes[0].rawResults[0].digest
  const replay = admitBoundedResearchResult(mission, 'node:x', firstDigest, clock, mission.revision)
  assert.equal(replay.revision, revisionBefore, 'a true no-op replay never bumps revision, even mid-multi-cycle')
  assert.equal(replay.nodes[0].claims.length, claimCountBefore, 'no duplicate claim from redelivering an already-admitted result')
})

// Phase 3 Wave 2 (3F): the remaining genuinely-deferred richer
// SourceSnapshotReference fields (schemaFingerprint/selectorOrAdapterVersion/
// transformationVersion, per DATASET_RESEARCH_ENGINE_V0_FINAL_
// RECONCILIATION.md's own "not implemented" list) reach durable admission
// additively, backward-compatibly.
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

function buildResult(request, provider, snapshotOverrides = {}) {
  return {
    schemaVersion: 'TSF_BOUNDED_RESEARCH_RESULT_V1',
    nodeId: request.nodeId,
    taskFingerprint: request.taskFingerprint,
    provider,
    providerRunRef: { provider, providerRunId: `run-${provider}`, dispatchedAt: clock().toISOString() },
    status: 'SUCCEEDED',
    observations: [{ rawContent: 'raw', extractedAt: clock().toISOString(), providerConfidence: 0.9, providerReasoning: 'r' }],
    proposedClaims: [{ fieldName: 'yards', proposedValue: 100, providerConfidence: 0.9, providerReasoning: 'r' }],
    evidence: [{ claimFieldName: 'yards', sourceRef: 'src:stable', snippet: 'from source', supportsClaim: true }],
    sourceReferences: [{ sourceRef: 'src:stable', url: 'https://example.invalid/stable', publisher: 'pub', retrievedAt: clock().toISOString() }],
    sourceSnapshotsOrSnapshotRefs: [{ sourceRef: 'src:stable', contentHash: 'sha256:h1', rawContentRef: `fixture://${provider}`, ...snapshotOverrides }],
    newGapProposals: [],
    warnings: [],
    unresolvedQuestions: [],
    usage: { requestCount: 1, tokensOrUnits: 1, providerReportedCostUsd: 0 },
    failureDetails: null
  }
}

function dispatchAndAdmit(mission, provider, snapshotOverrides) {
  const request = buildBoundedResearchRequest(mission, mission.nodes.find((n) => n.id === 'node:x'), provider, clock)
  let next = markResearchNodeReady(mission, 'node:x', clock, mission.revision)
  const r = buildResult(request, provider, snapshotOverrides)
  next = recordResearchNodeDispatch(next, 'node:x', { taskFingerprint: request.taskFingerprint, workerRunRef: r.providerRunRef }, clock, next.revision)
  next = recordResearchNodeResult(next, 'node:x', r, clock, next.revision)
  const digest = next.nodes[0].rawResults.at(-1).digest
  next = admitBoundedResearchResult(next, 'node:x', digest, clock, next.revision)
  return next
}

test('a caller supplying the richer metadata fields sees them reach the durable SourceSnapshotReference verbatim', () => {
  const mission = dispatchAndAdmit(baseMission(), 'CYCLE_1', {
    schemaFingerprint: 'sha256:schema-abc',
    selectorOrAdapterVersion: 'some-adapter@2.0.0',
    transformationVersion: '3.1.0'
  })
  const snap = mission.nodes[0].sourceSnapshots.at(-1)
  assert.equal(snap.schemaFingerprint, 'sha256:schema-abc')
  assert.equal(snap.selectorOrAdapterVersion, 'some-adapter@2.0.0')
  assert.equal(snap.transformationVersion, '3.1.0')
})

test('backward compatible: a caller that never sets these fields (every pre-Wave-2 caller) is byte-for-byte unaffected -- honest null, never fabricated', () => {
  const mission = dispatchAndAdmit(baseMission(), 'CYCLE_1', {})
  const snap = mission.nodes[0].sourceSnapshots.at(-1)
  assert.equal(snap.schemaFingerprint, null)
  assert.equal(snap.selectorOrAdapterVersion, null)
  assert.equal(snap.transformationVersion, null)
  // The rest of the pre-existing shape is completely unchanged.
  assert.equal(snap.acquisitionMethod, null)
  assert.equal(snap.acquisitionMode, null)
})

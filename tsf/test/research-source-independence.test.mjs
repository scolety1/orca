// Phase 1 (Trust + Scale Hardening): source-independence hardening.
// Scenarios A-H exactly as specified by HQ.
import assert from 'node:assert/strict'
import test from 'node:test'
import { admitBoundedResearchResult } from '../domain/research-admission.mjs'
import { addResearchNode, createResearchMission } from '../domain/research-mission.mjs'
import { markResearchNodeReady, recordResearchNodeDispatch, recordResearchNodeResult } from '../domain/research-node.mjs'
import { decideReconciliation } from '../domain/research-reconciliation.mjs'
import {
  computeConflictIndependenceGuidance,
  computeIndependentEvidenceLineage,
  recordSourceIndependenceMetadata
} from '../domain/research-source-independence.mjs'
import { detectResearchConflicts, verifyResearchClaim } from '../domain/research-verification.mjs'
import { buildNflQb2001Specification } from '../fixtures/nfl-2001-qb-research-fixture.mjs'
import { sha256 } from '../domain/canonical.mjs'

const fp = (label) => sha256(label)

const clock = () => new Date('2026-10-01T09:00:00.000Z')

function baseMission() {
  const specification = buildNflQb2001Specification()
  let mission = createResearchMission({ id: 'm', projectId: 'p', specification, expectedUniverse: specification.expectedUniverse }, clock)
  mission = addResearchNode(mission, { id: 'node:x', nodeRole: 'PRIMARY_RESEARCH', requestedFields: [{ fieldName: 'yards', valueType: 'number', required: true }], requestedOutputSchema: { type: 'object' } }, clock)
  return mission
}

function resultWith(provider, taskFingerprint, proposedValue, sourceRefs) {
  return {
    schemaVersion: 'TSF_BOUNDED_RESEARCH_RESULT_V1',
    nodeId: 'node:x',
    taskFingerprint,
    provider,
    providerRunRef: { provider, providerRunId: `run-${provider}`, dispatchedAt: clock().toISOString() },
    status: 'SUCCEEDED',
    observations: [{ rawContent: 'raw', extractedAt: clock().toISOString(), providerConfidence: 0.9, providerReasoning: 'r' }],
    proposedClaims: [{ fieldName: 'yards', proposedValue, temporalScope: '2001-regular-season', providerConfidence: 0.9, providerReasoning: 'r' }],
    evidence: sourceRefs.map((s) => ({ claimFieldName: 'yards', sourceRef: s, snippet: 's', supportsClaim: true })),
    sourceReferences: sourceRefs.map((s) => ({ sourceRef: s, url: `https://${s}`, publisher: s, retrievedAt: clock().toISOString() })),
    sourceSnapshotsOrSnapshotRefs: [],
    newGapProposals: [],
    warnings: [],
    unresolvedQuestions: [],
    usage: { requestCount: 1, tokensOrUnits: 1, providerReportedCostUsd: 0 },
    failureDetails: null
  }
}

function dispatchAndAdmit(mission, provider, taskFingerprint, proposedValue, sourceRefs) {
  let next = markResearchNodeReady(mission, 'node:x', clock, mission.revision)
  next = recordResearchNodeDispatch(next, 'node:x', { taskFingerprint, workerRunRef: { provider, providerRunId: `run-${provider}`, dispatchedAt: clock().toISOString() } }, clock, next.revision)
  next = recordResearchNodeResult(next, 'node:x', resultWith(provider, taskFingerprint, proposedValue, sourceRefs), clock, next.revision)
  const digest = next.nodes[0].rawResults.at(-1).digest
  return admitBoundedResearchResult(next, 'node:x', digest, clock, next.revision)
}

function sourceRefIdByUrl(mission, sourceRef) {
  return mission.nodes[0].sourceReferences.find((s) => s.sourceRef === sourceRef).id
}

test('A: two genuinely independent agreeing sources -> 2 independent lineages', () => {
  let mission = dispatchAndAdmit(baseMission(), 'A', fp('fp1'), 100, ['host-alpha.example', 'host-beta.example'])
  const claimId = mission.nodes[0].claims[0].id
  const lineage = computeIndependentEvidenceLineage(mission.nodes[0], claimId)
  assert.equal(lineage.sourceCount, 2)
  assert.equal(lineage.independentLineageCount, 2)
})

test('B: two mirrors of one upstream -> 2 sources but 1 independent evidence lineage', () => {
  let mission = dispatchAndAdmit(baseMission(), 'A', fp('fp1'), 100, ['mirror-1.example', 'mirror-2.example'])
  const upstreamId = sourceRefIdByUrl(mission, 'mirror-1.example')
  const mirrorId = sourceRefIdByUrl(mission, 'mirror-2.example')
  mission = recordSourceIndependenceMetadata(mission, 'node:x', mirrorId, { upstreamSourceId: upstreamId, independenceState: 'KNOWN_SHARED_UPSTREAM' }, clock, mission.revision)
  const claimId = mission.nodes[0].claims[0].id
  const lineage = computeIndependentEvidenceLineage(mission.nodes[0], claimId)
  assert.equal(lineage.sourceCount, 2, 'raw source count is still 2')
  assert.equal(lineage.independentLineageCount, 1, 'but only 1 independent evidence lineage -- the core guard')
  assert.equal(lineage.knownSharedUpstreamCount, 1)
})

test('C: three aggregators sharing an upstream vs one primary source -- guidance never lets raw count win', () => {
  let mission = baseMission()
  mission = dispatchAndAdmit(mission, 'AGG', fp('fp-agg'), 999, ['agg-1.example', 'agg-2.example', 'agg-3.example'])
  mission = markResearchNodeReady(mission, 'node:x', clock, mission.revision)
  mission = dispatchAndAdmit(mission, 'PRIMARY', fp('fp-primary'), 100, ['official-league-source.example'])

  const rootId = sourceRefIdByUrl(mission, 'agg-1.example')
  for (const url of ['agg-2.example', 'agg-3.example']) {
    mission = recordSourceIndependenceMetadata(mission, 'node:x', sourceRefIdByUrl(mission, url), { upstreamSourceId: rootId, independenceState: 'KNOWN_SHARED_UPSTREAM' }, clock, mission.revision)
  }
  mission = recordSourceIndependenceMetadata(mission, 'node:x', sourceRefIdByUrl(mission, 'official-league-source.example'), { sourceQualityClass: 'PRIMARY_SOURCE', independenceState: 'INDEPENDENT' }, clock, mission.revision)

  mission = detectResearchConflicts(mission, 'node:x', clock, mission.revision)
  const conflict = mission.nodes[0].conflicts[0]
  const guidance = computeConflictIndependenceGuidance(mission.nodes[0], conflict.id)
  const aggClaim = guidance.perClaim.find((c) => c.proposedValue === 999)
  const primaryClaim = guidance.perClaim.find((c) => c.proposedValue === 100)
  assert.equal(aggClaim.sourceCount, 3)
  assert.equal(aggClaim.independentLineageCount, 1, 'three mirrored aggregators collapse to ONE lineage')
  assert.equal(aggClaim.hasPrimarySource, false)
  assert.equal(primaryClaim.independentLineageCount, 1)
  assert.equal(primaryClaim.hasPrimarySource, true, 'the guidance surfaces the primary-source flag so lineage-count alone cannot make the aggregator claim look stronger')
})

test('D: unresolved upstream relationship is flagged, not silently assumed independent', () => {
  let mission = dispatchAndAdmit(baseMission(), 'A', fp('fp1'), 100, ['unknown-status.example'])
  const claimId = mission.nodes[0].claims[0].id
  const lineage = computeIndependentEvidenceLineage(mission.nodes[0], claimId)
  assert.equal(lineage.unresolvedSourceCount, 1, 'a source with no independence metadata at all must be flagged unresolved')
})

test('E: conflicting primary sources -- lineage tricks do not resolve a genuine disagreement', () => {
  let mission = baseMission()
  mission = dispatchAndAdmit(mission, 'A', fp('fp-a'), 100, ['primary-a.example'])
  mission = markResearchNodeReady(mission, 'node:x', clock, mission.revision)
  mission = dispatchAndAdmit(mission, 'B', fp('fp-b'), 200, ['primary-b.example'])
  mission = recordSourceIndependenceMetadata(mission, 'node:x', sourceRefIdByUrl(mission, 'primary-a.example'), { sourceQualityClass: 'PRIMARY_SOURCE', independenceState: 'INDEPENDENT' }, clock, mission.revision)
  mission = recordSourceIndependenceMetadata(mission, 'node:x', sourceRefIdByUrl(mission, 'primary-b.example'), { sourceQualityClass: 'PRIMARY_SOURCE', independenceState: 'INDEPENDENT' }, clock, mission.revision)
  mission = detectResearchConflicts(mission, 'node:x', clock, mission.revision)
  assert.equal(mission.nodes[0].conflicts.length, 1, 'two disagreeing primary sources are a real, unresolved conflict -- lineage/quality metadata cannot silently fix this')
  const guidance = computeConflictIndependenceGuidance(mission.nodes[0], mission.nodes[0].conflicts[0].id)
  assert.ok(guidance.perClaim.every((c) => c.hasPrimarySource), 'both sides are genuinely primary -- guidance must not fabricate a tiebreaker')
})

test('F: a real, deliberate conflict still requires an explicit human/authority decision -- never auto-resolved by lineage math alone', () => {
  let mission = baseMission()
  mission = dispatchAndAdmit(mission, 'A', fp('fp-a'), 100, ['s-a.example'])
  mission = markResearchNodeReady(mission, 'node:x', clock, mission.revision)
  mission = dispatchAndAdmit(mission, 'B', fp('fp-b'), 200, ['s-b.example'])
  mission = detectResearchConflicts(mission, 'node:x', clock, mission.revision)
  // decideReconciliation always requires an explicit selectedClaimId + a
  // real, non-empty rationale from the calling authority -- there is no
  // code path anywhere in this module that picks a "winner" by counting
  // votes or lineage automatically.
  assert.throws(
    () => decideReconciliation(mission, 'node:x', { fieldName: 'yards', decisionType: 'RESOLVE_CONFLICT', conflictId: mission.nodes[0].conflicts[0].id, decidedValue: 100, rationale: '', decidedBy: 'TIM' }, clock, mission.revision),
    /rationale/
  )
})

test('G: source independence becoming known AFTER initial verification produces a NEW verification, never a silent mutation of the old one', () => {
  let mission = dispatchAndAdmit(baseMission(), 'A', fp('fp1'), 100, ['mirror-1.example', 'mirror-2.example'])
  const claimId = mission.nodes[0].claims[0].id
  mission = verifyResearchClaim(mission, 'node:x', claimId, clock, mission.revision)
  const firstVerification = mission.nodes[0].verifications[0]
  assert.equal(firstVerification.evidenceLineage.independentLineageCount, 2, 'before independence metadata exists, both mirrors count as separate lineages')

  const upstreamId = sourceRefIdByUrl(mission, 'mirror-1.example')
  const mirrorId = sourceRefIdByUrl(mission, 'mirror-2.example')
  mission = recordSourceIndependenceMetadata(mission, 'node:x', mirrorId, { upstreamSourceId: upstreamId, independenceState: 'KNOWN_SHARED_UPSTREAM' }, clock, mission.revision)

  mission = verifyResearchClaim(mission, 'node:x', claimId, clock, mission.revision)
  assert.equal(mission.nodes[0].verifications.length, 2, 'a genuinely new verification is appended, the first is never deleted/mutated')
  assert.deepEqual(mission.nodes[0].verifications[0], firstVerification, 'the original verification record is byte-identical to before -- immutable history')
  assert.equal(mission.nodes[0].verifications[1].evidenceLineage.independentLineageCount, 1, 'the new verification reflects the corrected lineage')
})

test('H: verification recalculation after independence metadata changes updates the claim\'s LATEST status without erasing prior history', () => {
  let mission = dispatchAndAdmit(baseMission(), 'A', fp('fp1'), 100, ['solo-source.example'])
  const claimId = mission.nodes[0].claims[0].id
  mission = verifyResearchClaim(mission, 'node:x', claimId, clock, mission.revision)
  assert.equal(mission.nodes[0].claims[0].status, 'VERIFIED')
  const sourceId = sourceRefIdByUrl(mission, 'solo-source.example')
  // Independence metadata changes (e.g. later discovered to be an
  // aggregator, not primary) -- re-verifying must still work and the
  // claim's status reflects the LATEST verification.
  mission = recordSourceIndependenceMetadata(mission, 'node:x', sourceId, { sourceQualityClass: 'AGGREGATOR', independenceState: 'INDEPENDENT' }, clock, mission.revision)
  mission = verifyResearchClaim(mission, 'node:x', claimId, clock, mission.revision)
  assert.equal(mission.nodes[0].verifications.length, 2)
  assert.equal(mission.nodes[0].claims[0].status, 'VERIFIED', 'still independently supported (1 lineage, quality class alone does not fail verification)')
})

test('recordSourceIndependenceMetadata rejects an unknown quality class or independence state', () => {
  const mission = dispatchAndAdmit(baseMission(), 'A', fp('fp1'), 100, ['s.example'])
  const sourceId = sourceRefIdByUrl(mission, 's.example')
  assert.throws(() => recordSourceIndependenceMetadata(mission, 'node:x', sourceId, { sourceQualityClass: 'NOT_REAL' }, clock, mission.revision), /unknown source quality class/)
  assert.throws(() => recordSourceIndependenceMetadata(mission, 'node:x', sourceId, { independenceState: 'NOT_REAL' }, clock, mission.revision), /unknown independence state/)
})

test('recordSourceIndependenceMetadata is idempotent -- identical metadata twice does not bump revision', () => {
  let mission = dispatchAndAdmit(baseMission(), 'A', fp('fp1'), 100, ['s.example'])
  const sourceId = sourceRefIdByUrl(mission, 's.example')
  const once = recordSourceIndependenceMetadata(mission, 'node:x', sourceId, { sourceQualityClass: 'PRIMARY_SOURCE', independenceState: 'INDEPENDENT' }, clock, mission.revision)
  const twice = recordSourceIndependenceMetadata(once, 'node:x', sourceId, { sourceQualityClass: 'PRIMARY_SOURCE', independenceState: 'INDEPENDENT' }, clock, once.revision)
  assert.equal(twice.revision, once.revision)
})

test('a claim referencing a nonexistent upstream source id is rejected, not silently accepted', () => {
  const mission = dispatchAndAdmit(baseMission(), 'A', fp('fp1'), 100, ['s.example'])
  const sourceId = sourceRefIdByUrl(mission, 's.example')
  assert.throws(() => recordSourceIndependenceMetadata(mission, 'node:x', sourceId, { upstreamSourceId: 'sha256-of-nothing' }, clock, mission.revision), /unknown upstream source reference/)
})

// Independent-verification finding: reference equality (===) on
// independenceEvidence would have treated two structurally-identical
// object payloads as "changed" and bumped the revision on a true replay.
test('recordSourceIndependenceMetadata is idempotent for an OBJECT-valued independenceEvidence, not just primitives', () => {
  let mission = dispatchAndAdmit(baseMission(), 'A', fp('fp1'), 100, ['s.example'])
  const sourceId = sourceRefIdByUrl(mission, 's.example')
  const evidence = { checkedRegistrar: 'whois.example', matchedIp: '203.0.113.5' }
  const once = recordSourceIndependenceMetadata(mission, 'node:x', sourceId, { independenceState: 'KNOWN_SHARED_UPSTREAM', independenceEvidence: evidence }, clock, mission.revision)
  const twice = recordSourceIndependenceMetadata(once, 'node:x', sourceId, { independenceState: 'KNOWN_SHARED_UPSTREAM', independenceEvidence: { ...evidence } }, clock, once.revision)
  assert.equal(twice.revision, once.revision, 'a distinct-but-structurally-identical evidence object must be a true no-op')
})

// Independent-verification finding: knownSharedUpstreamCount previously
// only checked independenceState, so a source with a real upstreamSourceId
// but a stale/unset independenceState under-reported this diagnostic count
// even though lineage merging (which keys off upstreamSourceId alone) was
// already correct.
test('knownSharedUpstreamCount reflects a recorded upstreamSourceId even when independenceState was not also updated to match', () => {
  let mission = dispatchAndAdmit(baseMission(), 'A', fp('fp1'), 100, ['mirror-1.example', 'mirror-2.example'])
  const upstreamId = sourceRefIdByUrl(mission, 'mirror-1.example')
  const mirrorId = sourceRefIdByUrl(mission, 'mirror-2.example')
  // Deliberately leave independenceState at its default (UNKNOWN) while
  // still recording the real upstream relationship.
  mission = recordSourceIndependenceMetadata(mission, 'node:x', mirrorId, { upstreamSourceId: upstreamId }, clock, mission.revision)
  const claimId = mission.nodes[0].claims[0].id
  const lineage = computeIndependentEvidenceLineage(mission.nodes[0], claimId)
  assert.equal(lineage.independentLineageCount, 1, 'lineage merging already worked correctly')
  assert.equal(lineage.knownSharedUpstreamCount, 1, 'the diagnostic count must not silently disagree with the real upstreamSourceId fact')
})

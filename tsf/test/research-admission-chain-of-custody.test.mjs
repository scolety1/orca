// REQ-003 real wiring proof: source-chain-of-custody.mjs and
// evidence-gated-status-upgrade.mjs, both previously ported but never
// called by any real dispatch/admission path, now genuinely affect what
// admitBoundedResearchResult (domain/research-admission.mjs) durably
// records. Before/after: without the evidence gate, a later admission
// cycle claiming stronger provenance would silently report a stronger
// chain-of-custody tier; with it wired in, that upgrade is refused absent
// real evidence, and only applied once evidence is genuinely supplied. A
// real degradation (hash instability) is always applied immediately,
// proving the gate protects upgrades only, never hides a real regression.
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

function buildResult(request, provider, { contentHash, provenanceStrength, chainOfCustodyEvidence } = {}) {
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
    sourceSnapshotsOrSnapshotRefs: [{ sourceRef: 'src:stable', contentHash, rawContentRef: `fixture://${provider}`, provenanceStrength, chainOfCustodyEvidence }],
    newGapProposals: [],
    warnings: [],
    unresolvedQuestions: [],
    usage: { requestCount: 1, tokensOrUnits: 1, providerReportedCostUsd: 0 },
    failureDetails: null
  }
}

function dispatchAndAdmit(mission, provider, snapOptions) {
  const request = buildBoundedResearchRequest(mission, mission.nodes.find((n) => n.id === 'node:x'), provider, clock)
  let next = markResearchNodeReady(mission, 'node:x', clock, mission.revision)
  const r = buildResult(request, provider, snapOptions)
  next = recordResearchNodeDispatch(next, 'node:x', { taskFingerprint: request.taskFingerprint, workerRunRef: r.providerRunRef }, clock, next.revision)
  next = recordResearchNodeResult(next, 'node:x', r, clock, next.revision)
  const digest = next.nodes[0].rawResults.at(-1).digest
  next = admitBoundedResearchResult(next, 'node:x', digest, clock, next.revision)
  return next
}

function latestSnapshot(mission) {
  return mission.nodes[0].sourceSnapshots.at(-1)
}

test('a single observation is UNCHECKED filesystem stability -- honestly RED, never STABLE from one sighting', () => {
  const mission = dispatchAndAdmit(baseMission(), 'CYCLE_1', { contentHash: 'sha256:h1' })
  const snap = latestSnapshot(mission)
  assert.equal(snap.chainOfCustody.filesystemStability, 'UNCHECKED')
  assert.equal(snap.chainOfCustody.overallChainOfCustody, 'RED')
  assert.equal(snap.chainOfCustody.appliedChainOfCustody, 'RED')
})

test('WIRING PROOF: a later admission claiming a stronger tier for the SAME sourceRef is refused without real evidence, and only applied with it', () => {
  let mission = dispatchAndAdmit(baseMission(), 'CYCLE_1', { contentHash: 'sha256:h1' })
  assert.equal(latestSnapshot(mission).chainOfCustody.appliedChainOfCustody, 'RED')

  // Cycle 2: the SAME bytes seen again (hash sequence now stable) AND a
  // strong provenance claim -- WITHOUT attaching real evidence. The raw
  // computed tier for this observation alone is GREEN (STABLE +
  // INDEPENDENTLY_VERIFIED); the wiring must refuse to silently apply it.
  mission = dispatchAndAdmit(mission, 'CYCLE_2', { contentHash: 'sha256:h1', provenanceStrength: 'INDEPENDENTLY_VERIFIED' })
  const cycle2 = latestSnapshot(mission)
  assert.equal(cycle2.chainOfCustody.filesystemStability, 'STABLE', 'two matching observations really are stable now')
  assert.equal(cycle2.chainOfCustody.overallChainOfCustody, 'GREEN', 'what the raw evidence for THIS observation alone would support')
  assert.equal(cycle2.chainOfCustody.appliedChainOfCustody, 'RED', 'BEFORE/AFTER: without the evidence-gate wiring this would have silently become GREEN -- gated back to the prior recorded tier absent real evidence')
  assert.match(cycle2.chainOfCustody.upgradeReason, /REFUSED/)

  // Cycle 3: the same strong claim, this time WITH real evidence attached.
  // The gate must now allow the upgrade.
  mission = dispatchAndAdmit(mission, 'CYCLE_3', {
    contentHash: 'sha256:h1',
    provenanceStrength: 'INDEPENDENTLY_VERIFIED',
    chainOfCustodyEvidence: { evidenceProvided: true, evidenceDescription: 'independently cross-checked against a second, unrelated source' }
  })
  const cycle3 = latestSnapshot(mission)
  assert.equal(cycle3.chainOfCustody.appliedChainOfCustody, 'GREEN', 'real evidence legitimately unlocks the upgrade')
})

test('a real degradation (hash instability) is applied immediately, never gated or hidden', () => {
  let mission = dispatchAndAdmit(baseMission(), 'CYCLE_1', { contentHash: 'sha256:h1' })
  mission = dispatchAndAdmit(mission, 'CYCLE_2', {
    contentHash: 'sha256:h1',
    provenanceStrength: 'INDEPENDENTLY_VERIFIED',
    chainOfCustodyEvidence: { evidenceProvided: true, evidenceDescription: 'verified' }
  })
  assert.equal(latestSnapshot(mission).chainOfCustody.appliedChainOfCustody, 'GREEN', 'precondition: a real GREEN tier is on record')

  // A DIFFERENT hash observed now -- the bytes actually changed.
  mission = dispatchAndAdmit(mission, 'CYCLE_3', { contentHash: 'sha256:DIFFERENT' })
  const degraded = latestSnapshot(mission)
  assert.equal(degraded.chainOfCustody.filesystemStability, 'UNSTABLE')
  assert.equal(degraded.chainOfCustody.overallChainOfCustody, 'RED')
  assert.equal(degraded.chainOfCustody.appliedChainOfCustody, 'RED', 'a real degradation must never be hidden behind the previously-recorded stronger tier, evidence or not')
  assert.match(degraded.chainOfCustody.upgradeReason, /not an upgrade/)
})

test('provenanceStrength is never inferred -- an unsupplied claim is honestly NONE, not defaulted to something stronger', () => {
  const mission = dispatchAndAdmit(baseMission(), 'CYCLE_1', { contentHash: 'sha256:h1' })
  assert.equal(latestSnapshot(mission).chainOfCustody.provenanceStrength, 'NONE')
})

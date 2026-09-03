import assert from 'node:assert/strict'
import test from 'node:test'
import { admitBoundedResearchResult, recordIdentityResolutionState } from '../domain/research-admission.mjs'
import { addResearchNode, createResearchMission } from '../domain/research-mission.mjs'
import { buildBoundedResearchRequest, markResearchNodeReady, recordResearchNodeDispatch, recordResearchNodeResult } from '../domain/research-node.mjs'
import { admitReconciliationDecision, decideDerivedFieldReconciliation, decideReconciliation } from '../domain/research-reconciliation.mjs'
import { detectResearchConflicts, verifyResearchClaim } from '../domain/research-verification.mjs'
import { buildNflQb2001Specification } from '../fixtures/nfl-2001-qb-research-fixture.mjs'

const clock = () => new Date('2026-09-10T12:00:00.000Z')

function missionWithNode(id = 'node:x') {
  const specification = buildNflQb2001Specification()
  let mission = createResearchMission({ id: 'mission:ladder', projectId: 'fixture:proj', specification, expectedUniverse: specification.expectedUniverse }, clock)
  mission = addResearchNode(
    mission,
    { id, nodeRole: 'PRIMARY_RESEARCH', targetEntity: { entityId: 'entity:x' }, requestedFields: [{ fieldName: 'yards', valueType: 'number', required: true }], requestedOutputSchema: { type: 'object' } },
    clock
  )
  return mission
}

function successResult(request, overrides = {}) {
  return {
    schemaVersion: 'TSF_BOUNDED_RESEARCH_RESULT_V1',
    nodeId: request.nodeId,
    taskFingerprint: request.taskFingerprint,
    provider: 'FAKE',
    providerRunRef: { provider: 'FAKE', providerRunId: 'run-1', dispatchedAt: '2026-09-10T12:00:00.000Z' },
    status: 'SUCCEEDED',
    observations: [{ rawContent: 'raw', extractedAt: '2026-09-10T12:00:00.000Z', providerConfidence: 0.9, providerReasoning: 'r' }],
    proposedClaims: [{ fieldName: 'yards', proposedValue: 100, temporalScope: '2001-regular-season', providerConfidence: 0.9, providerReasoning: 'r' }],
    evidence: [{ claimFieldName: 'yards', sourceRef: 'src:1', snippet: 's', supportsClaim: true }],
    sourceReferences: [{ sourceRef: 'src:1', url: 'https://example.invalid', publisher: 'pub', retrievedAt: '2026-09-10T12:00:00.000Z' }],
    sourceSnapshotsOrSnapshotRefs: [{ sourceRef: 'src:1', contentHash: 'sha256:x', rawContentRef: 'fixture://x' }],
    newGapProposals: [],
    warnings: [],
    unresolvedQuestions: [],
    usage: { requestCount: 1, tokensOrUnits: 10, providerReportedCostUsd: 0 },
    failureDetails: null,
    ...overrides
  }
}

function dispatchAndAdmit(mission, node, overrides = {}) {
  const request = buildBoundedResearchRequest(mission, node, 'FAKE', clock)
  const workerRunRef = { provider: 'FAKE', providerRunId: 'run-1', dispatchedAt: '2026-09-10T12:00:00.000Z' }
  let next = markResearchNodeReady(mission, node.id, clock, mission.revision)
  next = recordResearchNodeDispatch(next, node.id, { taskFingerprint: request.taskFingerprint, workerRunRef }, clock, next.revision)
  const result = successResult(request, overrides)
  next = recordResearchNodeResult(next, node.id, result, clock, next.revision)
  const digest = next.nodes.find((n) => n.id === node.id).rawResults.at(-1).digest
  next = admitBoundedResearchResult(next, node.id, digest, clock, next.revision)
  return { mission: next, digest, request }
}

test('admission creates Observation/Claim/Evidence/SourceReference/SourceSnapshot and transitions the node to ADMITTED', () => {
  let mission = missionWithNode()
  const node = mission.nodes[0]
  const { mission: next } = dispatchAndAdmit(mission, node)
  const admittedNode = next.nodes[0]
  assert.equal(admittedNode.status, 'ADMITTED')
  assert.equal(admittedNode.observations.length, 1)
  assert.equal(admittedNode.claims.length, 1)
  assert.equal(admittedNode.evidence.length, 1)
  assert.equal(admittedNode.sourceReferences.length, 1)
  assert.equal(admittedNode.sourceSnapshots.length, 1)
  // EXECUTION STATE (ADMITTED) must never imply RESEARCH EPISTEMIC STATE
  // (VERIFIED/CANONICAL). This is the core invariant §2/§3 require.
  assert.equal(admittedNode.claims[0].status, 'UNVERIFIED')
  assert.equal(admittedNode.canonicalFacts.length, 0)
})

test('admission is idempotent: re-admitting the same result digest changes nothing', () => {
  let mission = missionWithNode()
  const node = mission.nodes[0]
  const { mission: once, digest } = dispatchAndAdmit(mission, node)
  const revisionAfterOnce = once.revision
  const claimCountAfterOnce = once.nodes[0].claims.length
  const twice = admitBoundedResearchResult(once, node.id, digest, clock, once.revision)
  assert.equal(twice.revision, revisionAfterOnce, 'a true no-op replay must not bump revision')
  assert.equal(twice.nodes[0].claims.length, claimCountAfterOnce)
  assert.equal(twice.nodes[0].observations.length, once.nodes[0].observations.length)
})

test('a proposedValue of null is admitted as TypedMissingness, not a Claim -- missingness honesty', () => {
  let mission = missionWithNode()
  const node = mission.nodes[0]
  const { mission: next } = dispatchAndAdmit(mission, node, {
    proposedClaims: [{ fieldName: 'yards', proposedValue: null, providerConfidence: null, providerReasoning: 'not found' }],
    evidence: []
  })
  const admittedNode = next.nodes[0]
  assert.equal(admittedNode.claims.length, 0)
  assert.equal(admittedNode.typedMissingness.length, 1)
  assert.equal(admittedNode.typedMissingness[0].fieldName, 'yards')
  // Unknown/absent confidence must stay null, never coerced to 0.
  assert.equal(admittedNode.typedMissingness[0].reason, 'not found')
})

test('null providerConfidence is never coerced to 0 anywhere in the ladder', () => {
  let mission = missionWithNode()
  const node = mission.nodes[0]
  const { mission: next } = dispatchAndAdmit(mission, node, {
    proposedClaims: [{ fieldName: 'yards', proposedValue: 100, providerConfidence: null, providerReasoning: null }]
  })
  assert.equal(next.nodes[0].claims[0].providerConfidence, null)
  assert.notEqual(next.nodes[0].claims[0].providerConfidence, 0)
})

test('SECURITY BOUNDARY: gap proposals are stored as proposals only, never auto-admitted as a new node', () => {
  let mission = missionWithNode()
  const node = mission.nodes[0]
  const nodeCountBefore = mission.nodes.length
  const { mission: next } = dispatchAndAdmit(mission, node, {
    newGapProposals: [{ fieldName: 'someOtherField', reason: 'worker thinks more research is needed' }]
  })
  assert.equal(next.nodes.length, nodeCountBefore, 'admission must never call addResearchNode')
  assert.equal(next.nodes[0].gapProposals.length, 1)
  assert.equal(next.nodes[0].gapProposals[0].admittedAsNode, false)
})

test('SECURITY BOUNDARY: extra worker-supplied fields (scope/toolPermissions/canonicalFact) have zero effect on durable state', () => {
  let mission = missionWithNode()
  const node = mission.nodes[0]
  const request = buildBoundedResearchRequest(mission, node, 'FAKE', clock)
  const adversarialResult = successResult(request, {
    // None of these are real BoundedResearchResult fields -- admission code
    // never reads them because it destructures only the documented shape.
    scope: ['*'],
    toolPermissions: ['shell-exec'],
    canonicalFact: { fieldName: 'yards', value: 999999 },
    sourcePolicy: { disallowedSources: [] }
  })
  const workerRunRef = { provider: 'FAKE', providerRunId: 'run-1', dispatchedAt: '2026-09-10T12:00:00.000Z' }
  let next = markResearchNodeReady(mission, node.id, clock, mission.revision)
  next = recordResearchNodeDispatch(next, node.id, { taskFingerprint: request.taskFingerprint, workerRunRef }, clock, next.revision)
  next = recordResearchNodeResult(next, node.id, adversarialResult, clock, next.revision)
  const digest = next.nodes[0].rawResults.at(-1).digest
  next = admitBoundedResearchResult(next, node.id, digest, clock, next.revision)
  assert.equal(next.nodes[0].canonicalFacts.length, 0, 'a worker-supplied canonicalFact-shaped field must never become a real CanonicalFact')
  assert.deepEqual(next.specification.toolPermissions, mission.specification.toolPermissions, 'mission-level toolPermissions must be unaffected by worker input')
  assert.deepEqual(next.specification.sourcePolicy, mission.specification.sourcePolicy, 'mission-level sourcePolicy must be unaffected by worker input')
})

test('verifyResearchClaim: supporting evidence + matching temporal scope -> PASS -> claim VERIFIED', () => {
  let mission = missionWithNode()
  const node = mission.nodes[0]
  const { mission: next } = dispatchAndAdmit(mission, node)
  const claimId = next.nodes[0].claims[0].id
  const verified = verifyResearchClaim(next, node.id, claimId, clock, next.revision)
  assert.equal(verified.nodes[0].verifications[0].verdict, 'PASS')
  assert.equal(verified.nodes[0].claims[0].status, 'VERIFIED')
})

test('verifyResearchClaim: contradicting evidence -> FAIL -> claim REJECTED', () => {
  let mission = missionWithNode()
  const node = mission.nodes[0]
  const { mission: next } = dispatchAndAdmit(mission, node, {
    evidence: [{ claimFieldName: 'yards', sourceRef: 'src:1', snippet: 'contradicts', supportsClaim: false }]
  })
  const claimId = next.nodes[0].claims[0].id
  const verified = verifyResearchClaim(next, node.id, claimId, clock, next.revision)
  assert.equal(verified.nodes[0].verifications[0].verdict, 'FAIL')
  assert.equal(verified.nodes[0].claims[0].status, 'REJECTED')
})

test('verifyResearchClaim: temporal-scope mismatch fails verification -- temporal correctness', () => {
  let mission = missionWithNode()
  const node = mission.nodes[0]
  const { mission: next } = dispatchAndAdmit(mission, node, {
    proposedClaims: [{ fieldName: 'yards', proposedValue: 100, temporalScope: 'career-total', providerConfidence: 0.9, providerReasoning: 'r' }]
  })
  const claimId = next.nodes[0].claims[0].id
  const verified = verifyResearchClaim(next, node.id, claimId, clock, next.revision)
  assert.equal(verified.nodes[0].verifications[0].verdict, 'FAIL')
  assert.equal(verified.nodes[0].verifications[0].assertionResults.find((a) => a.path === 'temporalMatches').passed, false)
})

test('verifyResearchClaim with no evidence at all is INCONCLUSIVE, never silently PASS', () => {
  let mission = missionWithNode()
  const node = mission.nodes[0]
  const { mission: next } = dispatchAndAdmit(mission, node, { evidence: [] })
  const claimId = next.nodes[0].claims[0].id
  const verified = verifyResearchClaim(next, node.id, claimId, clock, next.revision)
  assert.equal(verified.nodes[0].verifications[0].verdict, 'INCONCLUSIVE')
  assert.equal(verified.nodes[0].claims[0].status, 'UNVERIFIED')
})

test('detectResearchConflicts raises a Conflict when two non-rejected claims disagree on the same field', () => {
  let mission = missionWithNode()
  const node = mission.nodes[0]
  const requestA = buildBoundedResearchRequest(mission, node, 'FAKE_A', clock)
  const requestB = buildBoundedResearchRequest(mission, node, 'FAKE_B', clock)
  let next = markResearchNodeReady(mission, node.id, clock, mission.revision)
  next = recordResearchNodeDispatch(next, node.id, { taskFingerprint: requestA.taskFingerprint, workerRunRef: { provider: 'FAKE_A', providerRunId: 'a', dispatchedAt: clock().toISOString() } }, clock, next.revision)
  next = recordResearchNodeResult(next, node.id, successResult(requestA, { proposedClaims: [{ fieldName: 'yards', proposedValue: 100, providerConfidence: 0.9, providerReasoning: 'r' }] }), clock, next.revision)
  let digest = next.nodes[0].rawResults.at(-1).digest
  next = admitBoundedResearchResult(next, node.id, digest, clock, next.revision)

  next = markResearchNodeReady(next, node.id, clock, next.revision)
  next = recordResearchNodeDispatch(next, node.id, { taskFingerprint: requestB.taskFingerprint, workerRunRef: { provider: 'FAKE_B', providerRunId: 'b', dispatchedAt: clock().toISOString() } }, clock, next.revision)
  next = recordResearchNodeResult(next, node.id, successResult(requestB, { provider: 'FAKE_B', taskFingerprint: requestB.taskFingerprint, proposedClaims: [{ fieldName: 'yards', proposedValue: 150, providerConfidence: 0.8, providerReasoning: 'r' }] }), clock, next.revision)
  digest = next.nodes[0].rawResults.at(-1).digest
  next = admitBoundedResearchResult(next, node.id, digest, clock, next.revision)

  next = detectResearchConflicts(next, node.id, clock, next.revision)
  assert.equal(next.nodes[0].conflicts.length, 1)
  assert.equal(next.nodes[0].conflicts[0].status, 'OPEN')
  assert.equal(next.nodes[0].claims.every((c) => c.status === 'CONFLICTED'), true)
})

// Trust + Scale Hardening (temporal semantics): two claims for the same
// field but genuinely DIFFERENT time periods are not a real conflict --
// an apparent disagreement fully explained by temporal difference, not a
// source disagreement. Grouping used to be by fieldName alone; this proves
// the temporalScope-aware fix.
test('detectResearchConflicts does NOT flag two claims for the same field with genuinely different temporalScope -- temporal difference explains the apparent conflict', () => {
  let mission = missionWithNode()
  const node = mission.nodes[0]
  const requestA = buildBoundedResearchRequest(mission, node, 'FAKE_A', clock)
  const requestB = buildBoundedResearchRequest(mission, node, 'FAKE_B', clock)
  let next = markResearchNodeReady(mission, node.id, clock, mission.revision)
  next = recordResearchNodeDispatch(next, node.id, { taskFingerprint: requestA.taskFingerprint, workerRunRef: { provider: 'FAKE_A', providerRunId: 'a', dispatchedAt: clock().toISOString() } }, clock, next.revision)
  next = recordResearchNodeResult(next, node.id, successResult(requestA, { proposedClaims: [{ fieldName: 'yards', proposedValue: 100, temporalScope: '2001-regular-season', providerConfidence: 0.9, providerReasoning: 'r' }] }), clock, next.revision)
  let digest = next.nodes[0].rawResults.at(-1).digest
  next = admitBoundedResearchResult(next, node.id, digest, clock, next.revision)

  next = markResearchNodeReady(next, node.id, clock, next.revision)
  next = recordResearchNodeDispatch(next, node.id, { taskFingerprint: requestB.taskFingerprint, workerRunRef: { provider: 'FAKE_B', providerRunId: 'b', dispatchedAt: clock().toISOString() } }, clock, next.revision)
  next = recordResearchNodeResult(next, node.id, successResult(requestB, { provider: 'FAKE_B', taskFingerprint: requestB.taskFingerprint, proposedClaims: [{ fieldName: 'yards', proposedValue: 12, temporalScope: '2001-preseason', providerConfidence: 0.8, providerReasoning: 'r' }] }), clock, next.revision)
  digest = next.nodes[0].rawResults.at(-1).digest
  next = admitBoundedResearchResult(next, node.id, digest, clock, next.revision)

  next = detectResearchConflicts(next, node.id, clock, next.revision)
  assert.equal(next.nodes[0].conflicts.length, 0, 'different temporal scopes are different facts, not a disagreement')
  assert.equal(next.nodes[0].claims.every((c) => c.status === 'UNVERIFIED'), true, 'neither claim is wrongly marked CONFLICTED')
})

test('decideReconciliation ACCEPT_SINGLE_VERIFIED_CLAIM requires an actually VERIFIED claim', () => {
  let mission = missionWithNode()
  const node = mission.nodes[0]
  const { mission: next } = dispatchAndAdmit(mission, node)
  const claimId = next.nodes[0].claims[0].id
  assert.throws(
    () =>
      decideReconciliation(
        next,
        node.id,
        { fieldName: 'yards', decisionType: 'ACCEPT_SINGLE_VERIFIED_CLAIM', selectedClaimId: claimId, decidedValue: 100, rationale: 'r', decidedBy: 'TIM' },
        clock,
        next.revision
      ),
    /requires a VERIFIED claim/
  )
})

test('CANONICALIZATION INVARIANT: admitReconciliationDecision is the only path to a CanonicalFact', () => {
  let mission = missionWithNode()
  const node = mission.nodes[0]
  const { mission: afterAdmission } = dispatchAndAdmit(mission, node)
  // No shortcut: admission and verification alone never produce a
  // CanonicalFact.
  const claimId = afterAdmission.nodes[0].claims[0].id
  const afterVerification = verifyResearchClaim(afterAdmission, node.id, claimId, clock, afterAdmission.revision)
  assert.equal(afterVerification.nodes[0].canonicalFacts.length, 0)

  // Negative test: admitReconciliationDecision refuses a bogus/unknown id.
  assert.throws(
    () => admitReconciliationDecision(afterVerification, node.id, 'sha256-of-nothing', clock, afterVerification.revision),
    /TSF_RECONCILIATION_DECISION_REQUIRED|unknown reconciliation decision/
  )
  assert.equal(afterVerification.nodes[0].canonicalFacts.length, 0)

  // The real path: decide, then admit -- exactly two durable steps, never
  // collapsed into one.
  const decided = decideReconciliation(
    afterVerification,
    node.id,
    { fieldName: 'yards', decisionType: 'ACCEPT_SINGLE_VERIFIED_CLAIM', selectedClaimId: claimId, consideredClaimIds: [claimId], verificationIds: [afterVerification.nodes[0].verifications[0].id], decidedValue: 100, rationale: 'single independently verified claim, no competing claim exists', decidedBy: 'TIM' },
    clock,
    afterVerification.revision
  )
  assert.equal(decided.nodes[0].canonicalFacts.length, 0, 'deciding must not itself create a CanonicalFact')
  const decisionId = decided.nodes[0].reconciliationDecisions[0].id
  const admitted = admitReconciliationDecision(decided, node.id, decisionId, clock, decided.revision)
  assert.equal(admitted.nodes[0].canonicalFacts.length, 1)
  assert.equal(admitted.nodes[0].canonicalFacts[0].value, 100)
  assert.equal(admitted.nodes[0].canonicalFacts[0].reconciliationDecisionId, decisionId)

  // Idempotent: admitting the same decision again produces no duplicate.
  const admittedAgain = admitReconciliationDecision(admitted, node.id, decisionId, clock, admitted.revision)
  assert.equal(admittedAgain.nodes[0].canonicalFacts.length, 1)
  assert.equal(admittedAgain.revision, admitted.revision)
})

// Trust + Scale Hardening (temporal semantics): admitReconciliationDecision
// already lets the SAME fieldName carry multiple CanonicalFacts across
// different temporalScope values (correct for a multi-period mission).
// decideDerivedFieldReconciliation must never silently pick one of them --
// an explicit temporalScope is required to disambiguate, or a fail-closed
// error if the caller doesn't supply one.
function plantCanonicalFact(mission, nodeId, { fieldName, decidedValue, temporalScope }, clock) {
  let next = decideReconciliation(
    mission,
    nodeId,
    { fieldName, decisionType: 'ACCEPT_DERIVED_VALUE', decidedValue, temporalScope, rationale: 'test setup: planting a canonical input fact', decidedBy: 'TEST' },
    clock,
    mission.revision
  )
  const decisionId = next.nodes.find((n) => n.id === nodeId).reconciliationDecisions.at(-1).id
  return admitReconciliationDecision(next, nodeId, decisionId, clock, next.revision)
}

test('decideDerivedFieldReconciliation refuses to guess between multiple temporalScope-differentiated CanonicalFacts for the same input field', () => {
  let mission = missionWithNode()
  const node = mission.nodes[0]
  mission = plantCanonicalFact(mission, node.id, { fieldName: 'yards', decidedValue: 100, temporalScope: '2001-regular-season' }, clock)
  mission = plantCanonicalFact(mission, node.id, { fieldName: 'yards', decidedValue: 12, temporalScope: '2001-preseason' }, clock)
  assert.throws(
    () =>
      decideDerivedFieldReconciliation(
        mission,
        node.id,
        { fieldName: 'doubled', derivationRule: 'DOUBLE', inputFieldNames: ['yards'], computeFn: (y) => y * 2 },
        clock,
        mission.revision
      ),
    (error) => {
      assert.equal(error.code, 'TSF_DERIVATION_INPUT_AMBIGUOUS_TEMPORAL_SCOPE')
      return true
    }
  )
})

test('decideDerivedFieldReconciliation with an explicit temporalScope picks the correct input and stamps it onto the derived CanonicalFact', () => {
  let mission = missionWithNode()
  const node = mission.nodes[0]
  mission = plantCanonicalFact(mission, node.id, { fieldName: 'yards', decidedValue: 100, temporalScope: '2001-regular-season' }, clock)
  mission = plantCanonicalFact(mission, node.id, { fieldName: 'yards', decidedValue: 12, temporalScope: '2001-preseason' }, clock)
  mission = decideDerivedFieldReconciliation(
    mission,
    node.id,
    { fieldName: 'doubled', derivationRule: 'DOUBLE', inputFieldNames: ['yards'], computeFn: (y) => y * 2, temporalScope: '2001-preseason' },
    clock,
    mission.revision
  )
  const decisionId = mission.nodes[0].reconciliationDecisions.at(-1).id
  mission = admitReconciliationDecision(mission, node.id, decisionId, clock, mission.revision)
  const derived = mission.nodes[0].canonicalFacts.find((f) => f.fieldName === 'doubled')
  assert.equal(derived.value, 24, 'must derive from the preseason (12), never the regular-season (100), input')
  assert.equal(derived.temporalScope, '2001-preseason', 'the derived fact carries the explicit disambiguating scope, not null')
})

test('decideDerivedFieldReconciliation infers the derived temporalScope when every input already agrees, with no explicit override', () => {
  let mission = missionWithNode()
  const node = mission.nodes[0]
  mission = plantCanonicalFact(mission, node.id, { fieldName: 'completions', decidedValue: 10, temporalScope: '2001-regular-season' }, clock)
  mission = plantCanonicalFact(mission, node.id, { fieldName: 'attempts', decidedValue: 20, temporalScope: '2001-regular-season' }, clock)
  mission = decideDerivedFieldReconciliation(
    mission,
    node.id,
    { fieldName: 'completionPct', derivationRule: 'PCT', inputFieldNames: ['completions', 'attempts'], computeFn: (c, a) => c / a },
    clock,
    mission.revision
  )
  const decisionId = mission.nodes[0].reconciliationDecisions.at(-1).id
  mission = admitReconciliationDecision(mission, node.id, decisionId, clock, mission.revision)
  const derived = mission.nodes[0].canonicalFacts.find((f) => f.fieldName === 'completionPct')
  assert.equal(derived.value, 0.5)
  assert.equal(derived.temporalScope, '2001-regular-season', 'both inputs agreed on this scope -- inferred, not guessed')
})

test('identity resolution state is recorded per node and is independent of claim/verification state', () => {
  let mission = missionWithNode()
  const node = mission.nodes[0]
  const withIdentity = recordIdentityResolutionState(
    mission,
    node.id,
    { candidateEntityRefs: [{ id: 'a' }, { id: 'b' }], resolvedEntityId: 'a', status: 'RESOLVED', rationale: 'matched by team+era' },
    clock,
    mission.revision
  )
  assert.equal(withIdentity.nodes[0].identityResolutionState.status, 'RESOLVED')
  assert.equal(withIdentity.nodes[0].identityResolutionState.resolvedEntityId, 'a')
})

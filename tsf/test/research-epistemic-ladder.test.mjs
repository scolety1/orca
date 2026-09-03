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

// Trust + Scale Hardening (human review integration): a clean, honest
// FAILED provider result must produce an honest FAILED node, never a
// disguised ADMITTED-with-nothing-in-it.
test('a FAILED provider result produces an honest FAILED node, not a silent empty ADMITTED', () => {
  let mission = missionWithNode()
  const node = mission.nodes[0]
  let next = markResearchNodeReady(mission, node.id, clock, mission.revision)
  const request = buildBoundedResearchRequest(next, node, 'FAKE', clock)
  next = recordResearchNodeDispatch(next, node.id, { taskFingerprint: request.taskFingerprint, workerRunRef: { provider: 'FAKE', providerRunId: 'r1', dispatchedAt: '2026-09-10T12:00:00.000Z' } }, clock, next.revision)
  next = recordResearchNodeResult(
    next,
    node.id,
    { ...successResult(request), status: 'FAILED', observations: [], proposedClaims: [], evidence: [], failureDetails: { reason: 'PROVIDER_REPORTED_FAILURE', detail: 'x' } },
    clock,
    next.revision
  )
  assert.equal(next.nodes[0].status, 'FAILED')
  assert.equal(next.nodes[0].lastResultOutcome, 'FAILED')
  const digest = next.nodes[0].rawResults.at(-1).digest
  next = admitBoundedResearchResult(next, node.id, digest, clock, next.revision)
  assert.equal(next.nodes[0].status, 'FAILED', 'admitting a FAILED result must not force it to look like a real ADMITTED admission')
  assert.equal(next.nodes[0].claims.length, 0)
  assert.equal(next.nodes[0].admittedResultDigests.includes(digest), true, 'still durably marked processed, for idempotency')
})

test('a FAILED result on a SECOND dispatch cycle never erases an earlier successful ADMITTED cycle\'s status', () => {
  let mission = missionWithNode()
  const node = mission.nodes[0]
  const { mission: afterFirstCycle } = dispatchAndAdmit(mission, node)
  assert.equal(afterFirstCycle.nodes[0].status, 'ADMITTED')
  assert.equal(afterFirstCycle.nodes[0].claims.length, 1)

  let next = markResearchNodeReady(afterFirstCycle, node.id, clock, afterFirstCycle.revision)
  const request2 = buildBoundedResearchRequest(next, node, 'FAKE_B', clock)
  next = recordResearchNodeDispatch(next, node.id, { taskFingerprint: request2.taskFingerprint, workerRunRef: { provider: 'FAKE_B', providerRunId: 'r2', dispatchedAt: '2026-09-10T12:00:00.000Z' } }, clock, next.revision)
  next = recordResearchNodeResult(
    next,
    node.id,
    { ...successResult(request2), status: 'FAILED', observations: [], proposedClaims: [], evidence: [], failureDetails: { reason: 'PROVIDER_REPORTED_FAILURE', detail: 'x' } },
    clock,
    next.revision
  )
  assert.equal(next.nodes[0].status, 'FAILED', 'the node execution status honestly reflects the most recent cycle')
  assert.equal(next.nodes[0].lastResultOutcome, 'FAILED')
  const digest2 = next.nodes[0].rawResults.at(-1).digest
  next = admitBoundedResearchResult(next, node.id, digest2, clock, next.revision)
  assert.equal(next.nodes[0].status, 'ADMITTED', 'existing real claims from the first cycle mean this must be restored to ADMITTED, never left looking like nothing was ever admitted')
  assert.equal(next.nodes[0].claims.length, 1, 'the first cycle\'s real claim is untouched')
})

// CONTINUATION 2 Priority Block 2: PARTIAL/NEEDS_INPUT are neither a
// failure nor a full success -- both admit their real content exactly
// like SUCCEEDED, but the raw outcome kind is durably distinguishable via
// lastResultOutcome so no reader can mistake either for full completion.
function partialResult(request, overrides = {}) {
  return { ...successResult(request), status: 'PARTIAL', unresolvedQuestions: ['still need career-total context'], ...overrides }
}
function needsInputResult(request, overrides = {}) {
  return { ...successResult(request), status: 'NEEDS_INPUT', unresolvedQuestions: ['which Jim Miller -- 2001 Bears or 2001 Saints roster?'], ...overrides }
}

test('PARTIAL first attempt: real content is admitted, node reaches ADMITTED, lastResultOutcome honestly stays PARTIAL', () => {
  let mission = missionWithNode()
  const node = mission.nodes[0]
  let next = markResearchNodeReady(mission, node.id, clock, mission.revision)
  const request = buildBoundedResearchRequest(next, node, 'FAKE', clock)
  next = recordResearchNodeDispatch(next, node.id, { taskFingerprint: request.taskFingerprint, workerRunRef: { provider: 'FAKE', providerRunId: 'r1', dispatchedAt: '2026-09-10T12:00:00.000Z' } }, clock, next.revision)
  next = recordResearchNodeResult(next, node.id, partialResult(request), clock, next.revision)
  assert.equal(next.nodes[0].status, 'RESULT_RECEIVED', 'PARTIAL is not a failure -- it flows to RESULT_RECEIVED exactly like SUCCEEDED')
  assert.equal(next.nodes[0].lastResultOutcome, 'PARTIAL')
  const digest = next.nodes[0].rawResults.at(-1).digest
  next = admitBoundedResearchResult(next, node.id, digest, clock, next.revision)
  assert.equal(next.nodes[0].status, 'ADMITTED')
  assert.equal(next.nodes[0].claims.length, 1, 'the real content PARTIAL actually returned is genuinely admitted')
  assert.equal(next.nodes[0].lastResultOutcome, 'PARTIAL', 'ADMITTED alone must never be mistaken for full completion -- this is the honest signal')
})

test('NEEDS_INPUT first attempt: real content is admitted, lastResultOutcome honestly stays NEEDS_INPUT', () => {
  let mission = missionWithNode()
  const node = mission.nodes[0]
  let next = markResearchNodeReady(mission, node.id, clock, mission.revision)
  const request = buildBoundedResearchRequest(next, node, 'FAKE', clock)
  next = recordResearchNodeDispatch(next, node.id, { taskFingerprint: request.taskFingerprint, workerRunRef: { provider: 'FAKE', providerRunId: 'r1', dispatchedAt: '2026-09-10T12:00:00.000Z' } }, clock, next.revision)
  next = recordResearchNodeResult(next, node.id, needsInputResult(request), clock, next.revision)
  assert.equal(next.nodes[0].status, 'RESULT_RECEIVED')
  assert.equal(next.nodes[0].lastResultOutcome, 'NEEDS_INPUT')
  const digest = next.nodes[0].rawResults.at(-1).digest
  next = admitBoundedResearchResult(next, node.id, digest, clock, next.revision)
  assert.equal(next.nodes[0].status, 'ADMITTED')
  assert.equal(next.nodes[0].claims.length, 1)
  assert.equal(next.nodes[0].lastResultOutcome, 'NEEDS_INPUT')
})

test('SUCCEEDED -> PARTIAL: a second, merely-partial cycle never erases the first cycle\'s real claim; prior evidence preserved', () => {
  let mission = missionWithNode()
  const node = mission.nodes[0]
  const { mission: afterFirstCycle } = dispatchAndAdmit(mission, node)
  assert.equal(afterFirstCycle.nodes[0].claims.length, 1)
  assert.equal(afterFirstCycle.nodes[0].lastResultOutcome, 'SUCCEEDED')

  let next = markResearchNodeReady(afterFirstCycle, node.id, clock, afterFirstCycle.revision)
  const request2 = buildBoundedResearchRequest(next, node, 'FAKE_B', clock)
  next = recordResearchNodeDispatch(next, node.id, { taskFingerprint: request2.taskFingerprint, workerRunRef: { provider: 'FAKE_B', providerRunId: 'r2', dispatchedAt: '2026-09-10T12:00:00.000Z' } }, clock, next.revision)
  next = recordResearchNodeResult(next, node.id, partialResult(request2, { proposedClaims: [{ fieldName: 'team', proposedValue: 'NE', providerConfidence: 0.5, providerReasoning: 'r' }], evidence: [] }), clock, next.revision)
  assert.equal(next.nodes[0].lastResultOutcome, 'PARTIAL')
  const digest2 = next.nodes[0].rawResults.at(-1).digest
  next = admitBoundedResearchResult(next, node.id, digest2, clock, next.revision)
  assert.equal(next.nodes[0].status, 'ADMITTED')
  assert.equal(next.nodes[0].claims.length, 2, 'the first cycle\'s claim is preserved, the second cycle\'s new claim is added -- prior evidence never lost')
  assert.equal(next.nodes[0].lastResultOutcome, 'PARTIAL', 'the most recent cycle\'s honest outcome, even though real content exists overall')
})

test('PARTIAL -> SUCCEEDED: a later fully-successful cycle correctly updates lastResultOutcome forward, prior partial evidence preserved', () => {
  let mission = missionWithNode()
  const node = mission.nodes[0]
  let next = markResearchNodeReady(mission, node.id, clock, mission.revision)
  const request = buildBoundedResearchRequest(next, node, 'FAKE', clock)
  next = recordResearchNodeDispatch(next, node.id, { taskFingerprint: request.taskFingerprint, workerRunRef: { provider: 'FAKE', providerRunId: 'r1', dispatchedAt: '2026-09-10T12:00:00.000Z' } }, clock, next.revision)
  next = recordResearchNodeResult(next, node.id, partialResult(request), clock, next.revision)
  let digest = next.nodes[0].rawResults.at(-1).digest
  next = admitBoundedResearchResult(next, node.id, digest, clock, next.revision)
  assert.equal(next.nodes[0].claims.length, 1)
  assert.equal(next.nodes[0].lastResultOutcome, 'PARTIAL')

  next = markResearchNodeReady(next, node.id, clock, next.revision)
  const request2 = buildBoundedResearchRequest(next, node, 'FAKE_B', clock)
  next = recordResearchNodeDispatch(next, node.id, { taskFingerprint: request2.taskFingerprint, workerRunRef: { provider: 'FAKE_B', providerRunId: 'r2', dispatchedAt: '2026-09-10T12:00:00.000Z' } }, clock, next.revision)
  next = recordResearchNodeResult(next, node.id, successResult(request2, { proposedClaims: [{ fieldName: 'team', proposedValue: 'NE', providerConfidence: 0.9, providerReasoning: 'r' }], evidence: [] }), clock, next.revision)
  assert.equal(next.nodes[0].lastResultOutcome, 'SUCCEEDED', 'the outcome marker moves forward to reflect the most recent, now-fully-successful cycle')
  digest = next.nodes[0].rawResults.at(-1).digest
  next = admitBoundedResearchResult(next, node.id, digest, clock, next.revision)
  assert.equal(next.nodes[0].claims.length, 2, 'the earlier PARTIAL cycle\'s claim is still there -- never erased by a later, different-field claim')
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

// Independent-verification follow-up on Priority Block 3 (temporal-aware
// completeness): TypedMissingness can now legitimately carry distinct
// per-period temporalScope values for the same fieldName -- a fieldName-
// only lookup in ACCEPT_TYPED_MISSING could silently reconcile the WRONG
// period's missingness record.
function plantTypedMissingness(mission, nodeId, fieldName, temporalScope) {
  const missing = { schemaVersion: 'TSF_TYPED_MISSINGNESS_V1', id: `missing:${fieldName}:${temporalScope}`, fieldName, temporalScope, missingnessType: 'NOT_PUBLICLY_AVAILABLE', reason: 'test', admittedAt: clock().toISOString() }
  return { ...mission, nodes: mission.nodes.map((n) => (n.id === nodeId ? { ...n, typedMissingness: [...n.typedMissingness, missing] } : n)) }
}

test('ACCEPT_TYPED_MISSING refuses to guess between multiple temporalScope-differentiated TypedMissingness records for the same field', () => {
  let mission = missionWithNode()
  const node = mission.nodes[0]
  mission = plantTypedMissingness(mission, node.id, 'yards', '2001-regular-season')
  mission = plantTypedMissingness(mission, node.id, 'yards', '2001-preseason')
  assert.throws(
    () => decideReconciliation(mission, node.id, { fieldName: 'yards', decisionType: 'ACCEPT_TYPED_MISSING', decidedValue: null, rationale: 'test', decidedBy: 'TEST' }, clock, mission.revision),
    (error) => {
      assert.equal(error.code, 'TSF_TYPED_MISSINGNESS_AMBIGUOUS_TEMPORAL_SCOPE')
      return true
    }
  )
})

test('ACCEPT_TYPED_MISSING with an explicit temporalScope reconciles the CORRECT record, never the other period\'s', () => {
  let mission = missionWithNode()
  const node = mission.nodes[0]
  mission = plantTypedMissingness(mission, node.id, 'yards', '2001-regular-season')
  mission = plantTypedMissingness(mission, node.id, 'yards', '2001-preseason')
  mission = decideReconciliation(mission, node.id, { fieldName: 'yards', decisionType: 'ACCEPT_TYPED_MISSING', decidedValue: null, temporalScope: '2001-preseason', rationale: 'test', decidedBy: 'TEST' }, clock, mission.revision)
  const decisionId = mission.nodes[0].reconciliationDecisions.at(-1).id
  mission = admitReconciliationDecision(mission, node.id, decisionId, clock, mission.revision)
  const regularSeason = mission.nodes[0].typedMissingness.find((m) => m.temporalScope === '2001-regular-season')
  const preseason = mission.nodes[0].typedMissingness.find((m) => m.temporalScope === '2001-preseason')
  assert.equal(preseason.reconciliationDecisionId, decisionId, 'the explicitly-requested period\'s record is reconciled')
  assert.equal(regularSeason.reconciliationDecisionId ?? null, null, 'the OTHER period\'s record must never be silently reconciled instead')
})

// Independent-verification finding on the ACCEPT_TYPED_MISSING temporal
// fix above: decideReconciliation's precondition and
// admitReconciliationDecision's write previously each independently
// RE-DERIVED which record to touch by (fieldName, temporalScope) --  not
// guaranteed to agree if a NEW same-field record was admitted in the
// window between decide and admit. resolvedTypedMissingnessId (recorded
// once, at decide time, used directly at admit time -- never re-derived)
// makes this structurally impossible instead of merely unlikely.
test('ACCEPT_TYPED_MISSING reconciles the record resolved at DECIDE time, even if a new same-field record is admitted before the ADMIT call', () => {
  let mission = missionWithNode()
  const node = mission.nodes[0]
  // A single candidate at decide time, with a temporalScope that does NOT
  // match the caller-supplied one (the compound trigger condition found).
  mission = plantTypedMissingness(mission, node.id, 'yards', '2001-regular-season')
  mission = decideReconciliation(mission, node.id, { fieldName: 'yards', decisionType: 'ACCEPT_TYPED_MISSING', decidedValue: null, temporalScope: null, rationale: 'test', decidedBy: 'TEST' }, clock, mission.revision)
  const decisionId = mission.nodes[0].reconciliationDecisions.at(-1).id
  assert.equal(mission.nodes[0].reconciliationDecisions[0].resolvedTypedMissingnessId, mission.nodes[0].typedMissingness[0].id, 'the exact record resolved at decide time is recorded on the decision itself')

  // A NEW, unrelated same-field record with temporalScope null (matching
  // the decision's OWN temporalScope) arrives in the decide->admit window
  // -- the old re-derivation logic would match THIS one instead.
  mission = plantTypedMissingness(mission, node.id, 'yards', null)

  mission = admitReconciliationDecision(mission, node.id, decisionId, clock, mission.revision)
  const original = mission.nodes[0].typedMissingness.find((m) => m.temporalScope === '2001-regular-season')
  const interloper = mission.nodes[0].typedMissingness.find((m) => m.temporalScope === null)
  assert.equal(original.reconciliationDecisionId, decisionId, 'the record actually resolved at decide time is reconciled')
  assert.equal(interloper.reconciliationDecisionId ?? null, null, 'the later-arriving, unrelated record must never be silently reconciled instead')
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

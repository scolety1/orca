// Pure unit coverage for domain/research-autonomy-policy.mjs -- the
// ResearchMission Autonomy Driver V0's decision logic in isolation, no
// store/HTTP/worker required. Complements
// research-mission-autonomy-driver-zero-relay.test.mjs's real end-to-end
// proof with fast, precise coverage of every branch, including ones the
// zero-relay golden path never happens to exercise (budget exhaustion,
// an explicit unresolved Needs You, a dependency-blocked PENDING node).
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DEFAULT_RESEARCH_RETRY_BUDGET,
  decideNextMissionAction,
  decideNextNodeAction
} from '../domain/research-autonomy-policy.mjs'

function baseNode(overrides = {}) {
  return {
    id: 'node:x',
    status: 'PENDING',
    dependencies: [],
    requestedFields: [{ fieldName: 'value' }],
    claims: [],
    verifications: [],
    conflicts: [],
    canonicalFacts: [],
    typedMissingness: [],
    retryCount: 0,
    dispatchRecords: [],
    ...overrides
  }
}

function baseMission(nodes, overrides = {}) {
  return { state: 'ACTIVE', needsYou: [], nodes, ...overrides }
}

test('a PENDING node with satisfied dependencies dispatches; one with an unsatisfied dependency does nothing', () => {
  assert.deepEqual(decideNextNodeAction(baseNode(), true), { type: 'DISPATCH', nodeId: 'node:x' })
  assert.equal(decideNextNodeAction(baseNode(), false), null)
})

test('an explicit READY node dispatches regardless of the isReady flag', () => {
  assert.deepEqual(decideNextNodeAction(baseNode({ status: 'READY' }), false), { type: 'DISPATCH', nodeId: 'node:x' })
})

test('a DISPATCHED node polls', () => {
  assert.deepEqual(decideNextNodeAction(baseNode({ status: 'DISPATCHED' }), false), { type: 'POLL', nodeId: 'node:x' })
})

test('a FAILED node retries while budget remains, escalates once exhausted', () => {
  const underBudget = decideNextNodeAction(baseNode({ status: 'FAILED', retryCount: 1 }), false)
  assert.deepEqual(underBudget, { type: 'RETRY_DISPATCH', nodeId: 'node:x' })

  const exhausted = decideNextNodeAction(baseNode({ status: 'FAILED', retryCount: 2 }), false)
  assert.equal(exhausted.type, 'ESCALATE')
  assert.equal(exhausted.category, 'SOURCE_UNAVAILABLE')
})

test('COMPLETED, BLOCKED, CANCELLED nodes have nothing to do', () => {
  for (const status of ['COMPLETED', 'BLOCKED', 'CANCELLED']) {
    assert.equal(decideNextNodeAction(baseNode({ status }), false), null)
  }
})

test('an ADMITTED node with an unresolved field (claim exists, not yet verified) needs verify-and-reconcile', () => {
  const node = baseNode({
    status: 'ADMITTED',
    claims: [{ id: 'c1', fieldName: 'value', status: 'UNVERIFIED', proposedValue: 1 }]
  })
  assert.deepEqual(decideNextNodeAction(node, false), {
    type: 'VERIFY_AND_RECONCILE_FIELD',
    nodeId: 'node:x',
    fieldName: 'value'
  })
})

test('an ADMITTED node whose field is already canonical or typed-missing has nothing further to do', () => {
  const canonical = baseNode({ status: 'ADMITTED', canonicalFacts: [{ fieldName: 'value' }] })
  assert.equal(decideNextNodeAction(canonical, false), null)
  const missing = baseNode({ status: 'ADMITTED', typedMissingness: [{ fieldName: 'value' }] })
  assert.equal(decideNextNodeAction(missing, false), null)
})

test('an ADMITTED node with a resolved (PASS-verified, non-conflicting) field has nothing further to do', () => {
  const node = baseNode({
    status: 'ADMITTED',
    claims: [{ id: 'c1', fieldName: 'value', status: 'RECONCILED', proposedValue: 1 }],
    verifications: [{ claimId: 'c1', verdict: 'PASS' }]
  })
  assert.equal(decideNextNodeAction(node, false), null)
})

test('REQUIRED PROOF: an ADMITTED node with an open conflict on its field needs verify-and-reconcile (escalation happens inside that call, never guessed here)', () => {
  const node = baseNode({
    status: 'ADMITTED',
    claims: [
      { id: 'c1', fieldName: 'value', status: 'CONFLICTED', proposedValue: 1 },
      { id: 'c2', fieldName: 'value', status: 'CONFLICTED', proposedValue: 2 }
    ],
    verifications: [
      { claimId: 'c1', verdict: 'PASS' },
      { claimId: 'c2', verdict: 'PASS' }
    ],
    conflicts: [{ fieldName: 'value', status: 'OPEN' }]
  })
  assert.deepEqual(decideNextNodeAction(node, false), {
    type: 'VERIFY_AND_RECONCILE_FIELD',
    nodeId: 'node:x',
    fieldName: 'value'
  })
})

test('REQUIRED PROOF: a field where every claim was verified and none passed (REJECTED or INCONCLUSIVE-but-unverified) retries within budget, escalates once exhausted', () => {
  const rejected = baseNode({
    status: 'ADMITTED',
    claims: [{ id: 'c1', fieldName: 'value', status: 'REJECTED', proposedValue: 1 }],
    verifications: [{ claimId: 'c1', verdict: 'FAIL' }]
  })
  assert.deepEqual(decideNextNodeAction(rejected, false), { type: 'RETRY_DISPATCH', nodeId: 'node:x' })

  const exhausted = baseNode({
    status: 'ADMITTED',
    retryCount: DEFAULT_RESEARCH_RETRY_BUDGET.maxRetriesPerNode,
    claims: [{ id: 'c1', fieldName: 'value', status: 'REJECTED', proposedValue: 1 }],
    verifications: [{ claimId: 'c1', verdict: 'FAIL' }]
  })
  const escalated = decideNextNodeAction(exhausted, false)
  assert.equal(escalated.type, 'ESCALATE')
  assert.equal(escalated.category, 'SOURCE_UNAVAILABLE')

  // INCONCLUSIVE (e.g. zero supporting evidence) deliberately leaves the
  // claim's own status UNVERIFIED, not REJECTED (verifyResearchClaim's
  // documented behavior) -- the policy must still recognize "verified,
  // none passed" via the real verdict, not claim.status alone.
  const inconclusive = baseNode({
    status: 'ADMITTED',
    claims: [{ id: 'c1', fieldName: 'value', status: 'UNVERIFIED', proposedValue: 1 }],
    verifications: [{ claimId: 'c1', verdict: 'INCONCLUSIVE' }]
  })
  assert.deepEqual(decideNextNodeAction(inconclusive, false), { type: 'RETRY_DISPATCH', nodeId: 'node:x' })
})

test('mission-level: not ACTIVE, or an unresolved Needs You, is NOTHING_TO_DO -- this driver never acts past a genuine open question', () => {
  assert.deepEqual(decideNextMissionAction(baseMission([], { state: 'PAUSED' })), {
    type: 'NOTHING_TO_DO',
    reason: 'mission state is PAUSED'
  })
  assert.deepEqual(
    decideNextMissionAction(baseMission([], { needsYou: [{ resolvedAt: null }] })),
    { type: 'NOTHING_TO_DO', reason: 'an open Needs You question is unresolved' }
  )
})

test('mission-level: the first actionable node in declared order wins, never a later one', () => {
  const first = baseNode({ id: 'node:first', status: 'READY' })
  const second = baseNode({ id: 'node:second', status: 'DISPATCHED' })
  assert.deepEqual(decideNextMissionAction(baseMission([first, second])), { type: 'DISPATCH', nodeId: 'node:first' })
})

test('mission-level: every node terminal -> CHECK_COMPLETE; a genuinely stuck-but-not-terminal node -> NOTHING_TO_DO, never fabricated as complete', () => {
  const allAdmitted = baseMission([baseNode({ status: 'ADMITTED', canonicalFacts: [{ fieldName: 'value' }] })])
  assert.deepEqual(decideNextMissionAction(allAdmitted), { type: 'CHECK_COMPLETE' })

  // A PENDING node whose dependency will never resolve (the dependency
  // node is BLOCKED, not COMPLETED/CANCELLED) is neither actionable nor
  // terminal -- honestly reported, never silently treated as complete.
  const stuck = baseMission([
    baseNode({ id: 'node:dep', status: 'BLOCKED' }),
    baseNode({ id: 'node:dependent', status: 'PENDING', dependencies: ['node:dep'] })
  ])
  assert.deepEqual(decideNextMissionAction(stuck), { type: 'NOTHING_TO_DO', reason: 'no node is currently actionable' })
})

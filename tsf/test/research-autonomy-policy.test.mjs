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

// Phase 9 research-autonomy soak test: a READY node with retryCount > 0
// (recordResearchNodeAttempt's own RETRY branch sets status back to READY,
// not just PENDING/first-attempt READY) must go through the SAME
// budget-tracked path a FAILED node does -- reproduced generically (a
// plain rejected/inconclusive claim, no specific provider) as an
// unbounded-retry gap before this fix: retryCount froze at 1 forever and
// ESCALATE was structurally unreachable.
test('a READY node with retryCount > 0 retries while budget remains, escalates once exhausted -- never a fresh, unbudgeted DISPATCH again', () => {
  const underBudget = decideNextNodeAction(baseNode({ status: 'READY', retryCount: 1 }), false)
  assert.deepEqual(underBudget, { type: 'RETRY_DISPATCH', nodeId: 'node:x' })

  const exhausted = decideNextNodeAction(baseNode({ status: 'READY', retryCount: 2 }), false)
  assert.equal(exhausted.type, 'ESCALATE')
  assert.equal(exhausted.category, 'SOURCE_UNAVAILABLE')
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
  // canonicalFacts is real production state here, not incidental -- a
  // RECONCILED claim is always accompanied by its CanonicalFact (the SAME
  // durable admitReconciliationDecision write creates both). Phase 9
  // research-autonomy soak test finding: the "already canonical" check at
  // the TOP of decideVerificationAction (not the PASS-verdict inference
  // this test used to rely on alone) is what actually makes this null --
  // see the sibling test below for the real, previously-unhandled case
  // this distinction matters for.
  const node = baseNode({
    status: 'ADMITTED',
    claims: [{ id: 'c1', fieldName: 'value', status: 'RECONCILED', proposedValue: 1 }],
    verifications: [{ claimId: 'c1', verdict: 'PASS' }],
    canonicalFacts: [{ fieldName: 'value', value: 1 }]
  })
  assert.equal(decideNextNodeAction(node, false), null)
})

// Phase 9 research-autonomy soak test (real generic gap): a claim can be
// independently PASS-verified with no open conflict yet STILL not be
// canonical -- e.g. admitReconciliationDecision refused because the node's
// OWN identity is recorded AMBIGUOUS/UNRESOLVED (research-reconciliation.mjs's
// TSF_IDENTITY_AMBIGUOUS_CANNOT_CANONICALIZE guard). The OLD behavior
// (return null, "nothing further to do") silently gave up on this field
// forever, even after identity was later resolved -- nothing would ever
// re-attempt it. verifyAndReconcileResearchNodeFieldDurable is fully
// idempotent, so asking it again is always safe and is what actually
// converges once genuinely unblocked.
test('an ADMITTED node with a PASS-verified, non-conflicting field that is STILL not canonical asks to verify-and-reconcile again, never silently gives up', () => {
  const node = baseNode({
    status: 'ADMITTED',
    claims: [{ id: 'c1', fieldName: 'value', status: 'UNVERIFIED', proposedValue: 1 }],
    verifications: [{ claimId: 'c1', verdict: 'PASS' }]
  })
  assert.deepEqual(decideNextNodeAction(node, false), {
    type: 'VERIFY_AND_RECONCILE_FIELD',
    nodeId: 'node:x',
    fieldName: 'value'
  })
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

// REQUIRED PROOF (Main TSF Governor x Research Autonomy interaction
// review): cheap, non-dispatch work (POLL/VERIFY_AND_RECONCILE_FIELD/
// ESCALATE) is preferred mission-wide over a dispatch-class action, even
// when the dispatch-class node comes first in declared order -- this is
// what prevents a resource-blocked dispatch from permanently starving a
// later node's ungated work under sustained CRITICAL/EMERGENCY pressure
// (the resource gate lives in the server driver, which never even sees a
// node this policy didn't select).
test('mission-level: cheap non-dispatch work is preferred mission-wide over a dispatch-class action, regardless of declared order', () => {
  const dispatchable = baseNode({ id: 'node:dispatchable', status: 'READY' })
  const pollable = baseNode({ id: 'node:pollable', status: 'DISPATCHED' })
  assert.deepEqual(decideNextMissionAction(baseMission([dispatchable, pollable])), {
    type: 'POLL',
    nodeId: 'node:pollable'
  })
})

test('mission-level: among two non-dispatch actions, declared order still wins', () => {
  const first = baseNode({ id: 'node:first', status: 'DISPATCHED' })
  const second = baseNode({ id: 'node:second', status: 'DISPATCHED' })
  assert.deepEqual(decideNextMissionAction(baseMission([first, second])), { type: 'POLL', nodeId: 'node:first' })
})

test('mission-level: a dispatch-class action is only chosen when no cheaper work exists anywhere in the mission', () => {
  const first = baseNode({ id: 'node:first', status: 'READY' })
  const second = baseNode({ id: 'node:second', status: 'READY' })
  assert.deepEqual(decideNextMissionAction(baseMission([first, second])), { type: 'DISPATCH', nodeId: 'node:first' })
})

// REQUIRED PROOF (independent adversarial review finding on the fix
// above): ESCALATE must NEVER preempt an earlier-declared, unblocked
// DISPATCH -- ESCALATE raises mission.needsYou, and this function's own
// top-of-function guard then blocks the ENTIRE mission (every node, not
// just the escalated one) on every subsequent tick. Letting a later
// node's exhausted-retry ESCALATE win ahead of an independent, healthy,
// ready DISPATCH would freeze that unrelated real progress sooner than
// the original declared-order-only policy ever would have -- worse than
// the starvation bug this whole fix exists to prevent, just inverted.
test('mission-level: ESCALATE never preempts an earlier, unblocked DISPATCH -- real progress happens before any escalation can freeze the mission', () => {
  const readyToDispatch = baseNode({ id: 'node:ready', status: 'READY' })
  const exhausted = baseNode({
    id: 'node:exhausted',
    status: 'FAILED',
    retryCount: DEFAULT_RESEARCH_RETRY_BUDGET.maxRetriesPerNode
  })
  assert.deepEqual(decideNextMissionAction(baseMission([readyToDispatch, exhausted])), {
    type: 'DISPATCH',
    nodeId: 'node:ready'
  })
  // Only once nothing dispatchable/pollable/verifiable exists anywhere
  // does ESCALATE finally win.
  assert.deepEqual(decideNextMissionAction(baseMission([exhausted])).type, 'ESCALATE')
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

test('adversarial-review finding: a mission with ZERO nodes must never read as CHECK_COMPLETE -- Array.every on an empty array is vacuously true, and this exact gap let a 0-node draft-scaffold mission auto-complete with a fabricated "dataset ready" claim once a real driver was ever wired to run automatically', () => {
  const zeroNodes = baseMission([])
  assert.deepEqual(decideNextMissionAction(zeroNodes), { type: 'NOTHING_TO_DO', reason: 'no node is currently actionable' })
})

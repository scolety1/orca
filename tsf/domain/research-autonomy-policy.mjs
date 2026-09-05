// ResearchMission Autonomy Driver V0 -- pure decision logic only. Given a
// mission's current durable state, decides the ONE next bounded action a
// single tick should take -- mirrors keep-going-fleet-driver.mjs's own
// restraint (mechanically executes already-decided, already-real policy;
// never invents new research judgment, never picks a provider, never
// fabricates a canonical value). No I/O, no clock reads -- fully
// unit-testable against plain mission fixtures. server/research-mission-
// fleet-driver.mjs is the only caller.
//
// Deliberately delegates ALL verify -> detect-conflicts -> reconcile-or-
// escalate logic for one field to the ALREADY-REAL, already-tested
// server/research-mission-driver.mjs's verifyAndReconcileResearchNodeFieldDurable
// -- this policy module only decides WHICH field needs that call next, not
// how verification/reconciliation itself works (no second implementation
// of an already-correct sequence).
//
// One action per tick, exactly like keep-going-fleet-driver.mjs's
// advanceOneProject: settle-or-dispatch, never both in the same cycle.
// Nodes are scanned in stable declared order so behavior is deterministic
// and reproducible, never ordering-dependent on object iteration quirks.

import { readyResearchNodes } from './research-mission.mjs'

// Mirrors research-node.mjs's recordResearchNodeAttempt default budget --
// deliberately the SAME constant, not redeclared, so a caller changing one
// changes both; imported by the driver only for its default value (this
// module doesn't call recordResearchNodeAttempt itself, only decides that
// a retry is warranted).
export const DEFAULT_RESEARCH_RETRY_BUDGET = { maxRetriesPerNode: 2 }

// Shared by both "a dispatch cleanly failed" and "a dispatch succeeded but
// every resulting claim was independently verified and rejected" -- both
// are the same real signal (this attempt produced nothing usable) and get
// the SAME bounded, mechanical correction-loop policy: retry up to the
// small shared budget, then escalate once genuinely exhausted. Matches the
// governing directive's own required behavior ("automatic correction/
// research re-dispatch after failed verification where policy allows").
function decideRetryOrEscalate(node, budget, reason) {
  const attempts = node.retryCount ?? 0
  if (attempts >= budget.maxRetriesPerNode) {
    return {
      type: 'ESCALATE',
      nodeId: node.id,
      category: 'SOURCE_UNAVAILABLE',
      question: `Research node ${node.id}: ${reason}, exceeding the auto-retry budget of ${budget.maxRetriesPerNode} -- a human decision is required before further dispatch.`
    }
  }
  return { type: 'RETRY_DISPATCH', nodeId: node.id }
}

// Decides the next verification/reconciliation step for one already-
// ADMITTED node's requested fields, in declared order. Returns null once
// every field is either resolved (canonical fact or typed missingness) or
// has nothing further this driver can safely decide on its own.
function decideVerificationAction(node, budget) {
  for (const field of node.requestedFields) {
    const alreadyCanonical = node.canonicalFacts.some((f) => f.fieldName === field.fieldName)
    const alreadyMissing = node.typedMissingness.some((m) => m.fieldName === field.fieldName)
    if (alreadyCanonical || alreadyMissing) {
      continue
    }

    const claimsForField = node.claims.filter((c) => c.fieldName === field.fieldName)
    if (claimsForField.length === 0) {
      continue // no research has produced a claim for this field yet
    }

    const nonRejected = claimsForField.filter((c) => c.status !== 'REJECTED')
    const verificationFor = (claimId) => node.verifications.find((v) => v.claimId === claimId)
    const hasUnverified = nonRejected.some((c) => !verificationFor(c.id))
    const hasOpenConflict = node.conflicts.some((c) => c.fieldName === field.fieldName && c.status === 'OPEN')
    if (hasUnverified || hasOpenConflict) {
      // Real work remains for this field: newly-produced claims need
      // verifying, or conflict detection/escalation hasn't run yet against
      // the current claim set. verifyAndReconcileResearchNodeFieldDurable
      // is idempotent (its own claim/conflict-dedup checks), safe to call
      // repeatedly.
      return { type: 'VERIFY_AND_RECONCILE_FIELD', nodeId: node.id, fieldName: field.fieldName }
    }
    // Every non-rejected claim now has a verification record. A verdict of
    // FAIL sets claim.status REJECTED; a verdict of INCONCLUSIVE (e.g. zero
    // supporting evidence -- exactly the "deliberately bad evidence" case)
    // deliberately leaves the claim UNVERIFIED per verifyResearchClaim's
    // own documented behavior, so REJECTED status alone is not a complete
    // "nothing usable" signal -- checking the real verdict directly is.
    const anyPassed = nonRejected.some((c) => verificationFor(c.id)?.verdict === 'PASS')
    if (!anyPassed) {
      // Every attempt so far for this field produced nothing usable
      // (rejected or inconclusive, never independently verified as PASS).
      // This driver never guesses at a value nothing supports, but it DOES
      // automatically correct: the exact "independent verifier catches a
      // bad result -> automatic correction/research re-dispatch" loop the
      // governing directive requires, bounded by the same small retry
      // budget a clean dispatch failure uses.
      return decideRetryOrEscalate(
        node,
        budget,
        `field "${field.fieldName}" produced ${claimsForField.length} claim(s), none independently verified as PASS`
      )
    }
    // At least one claim passed verification, no open conflict --
    // verifyAndReconcileResearchNodeFieldDurable already canonicalized it
    // (or would on the next call, a safe idempotent no-op) -- nothing
    // further for THIS field; check the next one.
  }
  return null
}

// One node's next action, or null if this node has nothing to do this
// tick (already progressing correctly, or genuinely terminal). `isReady`
// is true when this PENDING node's own dependencies are all satisfied --
// research-mission.mjs's readyResearchNodes is the one real definition of
// that, computed once per mission by the caller, never re-derived here.
export function decideNextNodeAction(node, isReady, budget = DEFAULT_RESEARCH_RETRY_BUDGET) {
  if (node.status === 'DISPATCHED') {
    return { type: 'POLL', nodeId: node.id }
  }
  if (node.status === 'FAILED') {
    return decideRetryOrEscalate(node, budget, `dispatch failed ${node.retryCount ?? 0} time(s)`)
  }
  if (node.status === 'ADMITTED') {
    return decideVerificationAction(node, budget)
  }
  // A node starts PENDING; markResearchNodeReady's own READY status is set
  // by dispatchResearchNodeDurable itself as the first step of dispatch,
  // not a separate transition this driver performs -- so "dispatchable"
  // means PENDING-with-dependencies-satisfied OR an already-explicit
  // READY (e.g. a caller-driven flow that marked it ready without
  // dispatching yet).
  if (node.status === 'READY' || (node.status === 'PENDING' && isReady)) {
    return { type: 'DISPATCH', nodeId: node.id }
  }
  // PENDING-but-blocked-on-a-dependency, COMPLETED, BLOCKED, CANCELLED,
  // RESULT_RECEIVED (a transient state the durable poll-and-admit primitive
  // already collapses within one call -- never observed at rest between
  // ticks) -- nothing for this driver to decide.
  return null
}

// Actions that result in a real, resource-pressure-gated dispatch call in
// the server driver. Main TSF Governor x Research Autonomy interaction
// review finding: a naive single-pass "first actionable node in declared
// order" scan let a resource-blocked DISPATCH candidate permanently starve
// a LATER node's cheap, ungated work (POLL/VERIFY_AND_RECONCILE_FIELD/
// ESCALATE) -- that later node's action never changes tick over tick since
// the blocked dispatch candidate's own state never advances either, so it
// would keep "winning" first place forever. The governing requirement is
// explicit: "CRITICAL -> heavy research waits, lightweight reconciliation
// continues where possible." Cheap work is now preferred mission-wide,
// dispatch-class work only falls back to when nothing cheaper exists
// anywhere in the mission -- this changes ordering for every tier, not
// just constrained ones, which is also the more sensible general default
// (finish what's already in flight before starting new work).
const DISPATCH_ACTION_TYPES = new Set(['DISPATCH', 'RETRY_DISPATCH'])

// The one bounded action for this entire mission this tick -- the first
// non-dispatch (cheap) actionable node in declared order, falling back to
// the first dispatch-class one only when no cheaper work exists anywhere;
// or a mission-level verdict once no node has anything left to do.
export function decideNextMissionAction(mission, budget = DEFAULT_RESEARCH_RETRY_BUDGET) {
  if (mission.state !== 'ACTIVE') {
    return { type: 'NOTHING_TO_DO', reason: `mission state is ${mission.state}` }
  }
  if (mission.needsYou.some((n) => !n.resolvedAt)) {
    return { type: 'NOTHING_TO_DO', reason: 'an open Needs You question is unresolved' }
  }
  const readyIds = new Set(readyResearchNodes(mission).map((n) => n.id))
  let firstDispatchAction = null
  for (const node of mission.nodes) {
    const action = decideNextNodeAction(node, readyIds.has(node.id), budget)
    if (!action) {
      continue
    }
    if (!DISPATCH_ACTION_TYPES.has(action.type)) {
      return action
    }
    if (!firstDispatchAction) {
      firstDispatchAction = action
    }
  }
  if (firstDispatchAction) {
    return firstDispatchAction
  }
  // No node had anything to do -- either genuinely complete, or every
  // remaining node is PENDING on a dependency that will never resolve
  // (already reported honestly by the caller reading nodesByStatus, not
  // guessed here).
  const allTerminal = mission.nodes.every((n) =>
    ['COMPLETED', 'ADMITTED', 'CANCELLED', 'BLOCKED'].includes(n.status)
  )
  return allTerminal ? { type: 'CHECK_COMPLETE' } : { type: 'NOTHING_TO_DO', reason: 'no node is currently actionable' }
}

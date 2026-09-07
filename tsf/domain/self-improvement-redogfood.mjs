// Native Self-Improvement Loop V1, Phase 6: maps a redogfood re-run of the
// ORIGINAL detector's reproduction criteria onto Wave A's own finding
// status vocabulary -- never a parallel result vocabulary (mission brief's
// explicit instruction). Pure classification; the real re-execution of the
// reproduction check lives in server/self-improvement-redogfood.mjs.
//
// The semantic OUTCOME (one of REDOGFOOD_RESULTS) is context-independent,
// but the LEGAL finding transition it produces depends on the finding's
// CURRENT status -- self-improvement-finding.mjs's STATUS_ALLOWED table is
// fixed and narrower than the outcome vocabulary: READY_FOR_ADOPTION (a
// pre-adoption redogfood, run against the candidate worktree) may only go
// to RESOLVED or NEEDS_OWNER; RESOLVED (a post-adoption redogfood, run
// against canonical code already merged) may ONLY go to REOPENED. A late
// "this was never really a defect" discovery therefore is never auto-
// terminal here -- it always routes through a human-reachable state
// (NEEDS_OWNER pre-adoption, REOPENED post-adoption), never straight to
// REJECTED_FALSE_POSITIVE, matching Wave A's own design that a human
// decision is what actually closes a finding as a false positive.
export const REDOGFOOD_RESULTS = Object.freeze(['RESOLVED', 'REOPENED', 'FALSE_POSITIVE', 'REGRESSION_INTRODUCED'])

function outcomeOf({ reproductionStillFails, regressionTestsNowFail, wasNeverGenuinelyReproducible }) {
  if (wasNeverGenuinelyReproducible) { return 'FALSE_POSITIVE' }
  if (reproductionStillFails) { return 'REOPENED' }
  if (regressionTestsNowFail) { return 'REGRESSION_INTRODUCED' }
  return 'RESOLVED'
}

const REASON_BY_OUTCOME = Object.freeze({
  FALSE_POSITIVE: 'REDOGFOOD_NEVER_REPRODUCED',
  REOPENED: 'REDOGFOOD_REPRODUCTION_STILL_FAILS',
  REGRESSION_INTRODUCED: 'REDOGFOOD_REGRESSION_INTRODUCED',
  RESOLVED: 'REDOGFOOD_CONFIRMED_RESOLVED'
})

// `currentStatus`: the finding's real current status (READY_FOR_ADOPTION
// or RESOLVED -- the only two states a redogfood run is ever invoked
// from, see server/self-improvement-redogfood.mjs). `facts`: the real,
// already-gathered redogfood evidence.
export function classifyRedogfoodResult(currentStatus, facts) {
  const outcome = outcomeOf(facts)
  const reason = REASON_BY_OUTCOME[outcome]
  if (currentStatus === 'RESOLVED') {
    // The only legal next state from RESOLVED is REOPENED -- a clean
    // reconfirmation needs no transition at all (the finding is already
    // exactly where it should be).
    return { outcome, findingTransition: outcome === 'RESOLVED' ? null : { to: 'REOPENED', reason } }
  }
  if (currentStatus === 'READY_FOR_ADOPTION') {
    if (outcome === 'RESOLVED') { return { outcome, findingTransition: { to: 'RESOLVED', reason } } }
    // FALSE_POSITIVE, REOPENED-outcome (still fails), and
    // REGRESSION_INTRODUCED all route to NEEDS_OWNER here -- none of
    // REOPENED/REJECTED_FALSE_POSITIVE is a legal edge out of
    // READY_FOR_ADOPTION, and each of these is exactly the kind of
    // surprising, late reversal Wave A's transition table reserves for a
    // human to triage rather than auto-resolving.
    return { outcome, findingTransition: { to: 'NEEDS_OWNER', reason } }
  }
  const error = new Error(`redogfood can only classify from READY_FOR_ADOPTION or RESOLVED, got ${currentStatus}`)
  error.code = 'TSF_REDOGFOOD_INVALID_CURRENT_STATUS'
  throw error
}

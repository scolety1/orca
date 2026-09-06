// Generic evidence-gated confidence-upgrade guard -- promoted verbatim
// from dataset-research-engine-v0's fixtures/evidence-gated-confidence-
// upgrade.mjs. Real discipline: never claim a stronger temporal/rights
// confidence than the actual evidence supports -- an unverified state is
// never silently smoothed into a verified one.
//
// IMPORTANT SCOPE DISTINCTION this module deliberately enforces: whether
// a real source's temporal/rights TRUTH is actually strong requires real
// external research (reading a real commit history, a real LICENSE file,
// a real ToS page) -- that determination is not this module's job. What
// this module provides is the pure, generic PROPAGATION rule: an
// uncertain status must never be upgraded to a stronger one without an
// explicit, real evidence input accompanying the upgrade request.
// Already fully generic (the ordering is caller-supplied, not hardcoded)
// -- ported unchanged except this header.

/**
 * @param {string} currentStatus
 * @param {string} requestedStatus
 * @param {string[]} strongerThanUnverified - the ordered list of statuses stronger than the unverified/uncertain floor, weakest-first
 * @param {{ evidenceProvided: boolean, evidenceDescription?: string }} evidence
 * @returns {{ appliedStatus: string, upgraded: boolean, reason: string }}
 */
export function attemptStatusUpgrade(currentStatus, requestedStatus, strongerThanUnverified, evidence) {
  // Array.indexOf returns -1 for a value NOT in the list. Comparing two
  // -1s, or an unrecognized requestedStatus's -1 against a recognized
  // current status's real index, would let the evidence gate be bypassed
  // entirely for any status string outside the known ordering -- including
  // a real status from a SIBLING vocabulary (e.g. passing a genuine
  // RIGHTS_CONFIDENCE_LEVELS value against TEMPORAL_CONFIDENCE_LEVELS).
  // Both statuses must be real, recognized members of the supplied
  // ordering before any upgrade decision is made -- an unrecognized status
  // is refused outright, never silently treated as a no-op.
  const currentIndex = strongerThanUnverified.indexOf(currentStatus)
  const requestedIndex = strongerThanUnverified.indexOf(requestedStatus)
  if (currentIndex === -1 || requestedIndex === -1) {
    return { appliedStatus: currentStatus, upgraded: false, reason: `REFUSED: '${currentIndex === -1 ? currentStatus : requestedStatus}' is not a recognized status in the supplied ordering -- cannot evaluate an upgrade against an unrecognized status` }
  }
  const isRealUpgrade = requestedIndex > currentIndex
  if (!isRealUpgrade) {
    return { appliedStatus: requestedStatus, upgraded: true, reason: 'not an upgrade (lateral move or downgrade) -- always allowed' }
  }
  if (!evidence || evidence.evidenceProvided !== true) {
    // THE INVARIANT: no evidence, no upgrade -- the status stays exactly
    // where it was, regardless of what was requested.
    return { appliedStatus: currentStatus, upgraded: false, reason: 'REFUSED: an upgrade to a stronger confidence level requires explicit evidenceProvided=true; none was given' }
  }
  return { appliedStatus: requestedStatus, upgraded: true, reason: `upgraded on real evidence: ${evidence.evidenceDescription ?? '(no description given)'}` }
}

// Reusable status orderings (weakest/most-uncertain first). Not sport- or
// mission-specific -- a generic temporal/rights confidence vocabulary any
// mission may reuse directly, or a mission may supply its own ordering to
// attemptStatusUpgrade instead.
export const TEMPORAL_CONFIDENCE_LEVELS = Object.freeze([
  'TEMPORALLY_UNVERIFIED',
  'RETROSPECTIVE_RECONSTRUCTION',
  'PROVISIONALLY_CONTEMPORANEOUS_ARCHIVE',
  'BOUNDED_CONTEMPORANEOUS_PRESEASON',
  'PROVEN_CONTEMPORANEOUS_PRESEASON'
])

export const RIGHTS_CONFIDENCE_LEVELS = Object.freeze([
  'BLOCKED_RIGHTS',
  'CANDIDATE_PENDING_RIGHTS',
  'ADMITTED_PRIVATE_RESEARCH_ONLY',
  'ADMITTED'
])

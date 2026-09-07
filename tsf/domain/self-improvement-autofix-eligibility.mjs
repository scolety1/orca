// Native Self-Improvement Loop V1, Phase 2: deterministic, FAIL-CLOSED
// ELIGIBLE_FOR_AUTOFIX vs NEEDS_OWNER classifier. Generalizes
// ui-dogfood-finding.mjs's classifyAutoFixEligibility (REUSE_PATTERN: same
// "objective, bounded defect only" boundary, same "a subjective category is
// NEVER auto-fixable no matter what else is true about it" rule -- there
// SUBJECTIVE_AESTHETIC/LAYOUT_PROBLEM are always excluded regardless of the
// `objective` flag; here SUBJECTIVE_REDESIGN and every other NOT_ELIGIBLE
// kind are always excluded regardless of confidence/severity) across every
// source detector this program's finding contract spans, instead of
// reinventing a second objective/subjective distinction with different
// semantics.
import { SOURCE_DETECTORS, transitionFinding } from './self-improvement-finding.mjs'
import { SEVERITY_LEVELS } from './ui-dogfood-finding.mjs'

// V1 ELIGIBLE candidates, verbatim from the mission brief -- a bounded,
// reproducible, objective defect class. `candidateFixScope.kind` is the
// carrier: a detector proposing a fix must say what KIND of fix it is
// proposing, and only these kinds are ever eligible.
export const ELIGIBLE_FIX_KINDS = Object.freeze([
  'BOUNDED_CODE_DEFECT',
  'UI_CLIPPING_OVERFLOW',
  'DEAD_MISWIRED_CONTROL',
  'INCORRECT_STATUS_STATE',
  'DETERMINISTIC_TEST_REGRESSION',
  'RESOURCE_GOVERNOR_BYPASS',
  'BOUNDED_DURABILITY_DEFECT',
  'BOUNDED_RESEARCH_DEFECT'
])

// NOT ELIGIBLE, verbatim from the mission brief -- always NEEDS_OWNER or
// recommendation-only, no matter how high confidence/severity is. Each kind
// string doubles as the finding's authorityRequired reason code once
// classified, so "why NEEDS_OWNER" is always self-explanatory from the
// stored record alone.
export const NOT_ELIGIBLE_FIX_KINDS = Object.freeze([
  'SUBJECTIVE_REDESIGN',
  'NEW_PRODUCT_DIRECTION',
  'PAID_EXTERNAL_SERVICE',
  'CREDENTIALS_AUTHENTICATION',
  'PRODUCTION_DEPLOYMENT',
  'DESTRUCTIVE_CLEANUP',
  'PROTECTED_HOLDOUT_ACCESS',
  'MODEL_POLICY_CHANGE',
  'ARCHITECTURAL_REWRITE',
  'AMBIGUOUS_CROSS_PROJECT_MUTATION',
  'SIGNIFICANT_NEW_AUTHORITY'
])

// Fail-closed reason codes for uncertainty the mission brief calls out by
// name (unclassifiable severity, unclear scope, unrecognized
// source_detector) plus low-confidence, which is the same "uncertainty"
// concern applied to the detector's own stated confidence.
export const UNCERTAINTY_REASONS = Object.freeze([
  'UNRECOGNIZED_SOURCE_DETECTOR',
  'UNCLASSIFIABLE_SEVERITY',
  'UNCLASSIFIABLE_FIX_KIND',
  'LOW_CONFIDENCE'
])

// Below this, a detector's own stated confidence is not enough to trust an
// autonomous fix attempt with no human in the loop -- fails closed to
// NEEDS_OWNER rather than gambling on a low-confidence detection. 0.7 is a
// deliberately conservative V1 floor (not tuned against real detector
// output yet); documented here as the one place it would be revisited.
export const MIN_CONFIDENCE_FOR_AUTOFIX = 0.7

// Pure decision function -- given a finding-shaped object (only
// sourceDetector/severity/confidence/candidateFixScope.kind are read),
// returns {eligible, reason}. reason is null when eligible, else one of
// NOT_ELIGIBLE_FIX_KINDS or UNCERTAINTY_REASONS. Never throws: an
// unclassifiable input is a NEEDS_OWNER verdict, not an exception -- the
// caller (applyAutofixEligibility below) is what turns this into a real
// status transition.
export function classifyAutofixEligibility(finding) {
  if (!SOURCE_DETECTORS.includes(finding?.sourceDetector)) {
    return { eligible: false, reason: 'UNRECOGNIZED_SOURCE_DETECTOR' }
  }
  if (!SEVERITY_LEVELS.includes(finding.severity)) {
    return { eligible: false, reason: 'UNCLASSIFIABLE_SEVERITY' }
  }
  const kind = finding.candidateFixScope?.kind
  if (NOT_ELIGIBLE_FIX_KINDS.includes(kind)) {
    // Checked BEFORE the ELIGIBLE_FIX_KINDS membership test so a kind that
    // (incorrectly) appeared in both lists would still fail closed to
    // NEEDS_OWNER -- defense in depth, not reachable today since the two
    // lists are disjoint by construction.
    return { eligible: false, reason: kind }
  }
  if (!ELIGIBLE_FIX_KINDS.includes(kind)) {
    // Covers both "no candidateFixScope at all" (kind undefined) and any
    // string this policy has never seen -- an unrecognized kind is never
    // silently treated as eligible.
    return { eligible: false, reason: 'UNCLASSIFIABLE_FIX_KIND' }
  }
  if (typeof finding.confidence !== 'number' || finding.confidence < MIN_CONFIDENCE_FOR_AUTOFIX) {
    return { eligible: false, reason: 'LOW_CONFIDENCE' }
  }
  return { eligible: true, reason: null }
}

// Maps a classification onto the finding contract's own vocabulary: the
// status this finding should transition to, and the authorityRequired value
// to stamp on it (null iff eligible -- mirrors ui-dogfood-finding.mjs's
// autoFixEligible boolean but expressed as a status + an explicit reason
// instead of a bare boolean, since NEEDS_OWNER always needs a stated WHY).
export function classifyFinding(finding) {
  const { eligible, reason } = classifyAutofixEligibility(finding)
  return eligible
    ? { status: 'ELIGIBLE_FOR_AUTOFIX', authorityRequired: null }
    : { status: 'NEEDS_OWNER', authorityRequired: reason }
}

// Applies the classification as a real, audited state transition. Requires
// finding.status === 'VERIFIED' -- assertFindingTransition (called inside
// transitionFinding) already enforces this, since only VERIFIED legally
// transitions to ELIGIBLE_FOR_AUTOFIX/NEEDS_OWNER; an unverified finding can
// never be autofix-classified, deliberately, since eligibility says nothing
// about whether the finding is even real.
export function applyAutofixEligibility(finding, clock) {
  const { status, authorityRequired } = classifyFinding(finding)
  const next = transitionFinding(
    finding,
    status,
    { reason: 'AUTOFIX_ELIGIBILITY_CLASSIFIED', evidence: [{ authorityRequired }] },
    clock
  )
  return { ...next, authorityRequired }
}

// Typed access/rights classification for a web source candidate. Fails
// closed: PUBLIC_ALLOWED is reached only from explicit affirmative evidence
// (robots allow + an explicit public-allowance affirmation); anything less
// than that lands on PUBLIC_TERMS_UNCLEAR, which blocks extraction and
// requires operator review rather than silently proceeding.
//
// The taxonomy below matches the one already proposed (design-only, not yet
// enforced) on the sibling tsf/feature/dataset-research-engine-v0 branch's
// shared-generic-acquisition-contract.json, so a future merge does not need
// a renaming pass.

// Phase 3 Wave 2 (3E) additive values: real POST-FETCH content evidence can
// surface two outcomes the pre-fetch input-only gate above has no way to
// see (it only ever reasons about caller-supplied booleans, never actual
// response bytes) -- an anti-bot/challenge interstitial, and a source that
// is simply gone/erroring. See web-source-content-access-classifier.mjs.
// Phase 3 Wave 2 (3C) additive value: OWNER_SUPPLIED_LOCAL_ARTIFACT has no
// web rights concept at all (no fetch, no robots, no terms) -- this is the
// honest "the classification doesn't apply" value, never a fabricated
// PUBLIC_ALLOWED/AUTHENTICATED_* label for a mode with no such determination.
export const ACCESS_CLASSIFICATIONS = Object.freeze([
  'PUBLIC_ALLOWED',
  'PUBLIC_TERMS_UNCLEAR',
  'AUTHENTICATED_OFFICIAL_EXPORT',
  'AUTHENTICATED_PAGE_NO_EXPORT',
  'ROBOTS_DISALLOWED',
  'TERMS_BLOCKED',
  'PAYWALL_ACCESS_CONTROL',
  'ANTI_BOT_CHALLENGE_DETECTED',
  'SOURCE_UNAVAILABLE',
  'NOT_APPLICABLE_LOCAL_ARTIFACT'
])

export const ACQUISITION_MODES = Object.freeze([
  'PUBLIC_WEB_SOURCE_EXTRACTION',
  'AUTHENTICATED_OFFICIAL_DOWNLOAD',
  'OWNER_SUPPLIED_LOCAL_ARTIFACT'
])

const ADAPTER_DECISIONS = Object.freeze([
  'ALLOWED',
  'ROUTE_TO_EXPORT_PATH',
  'REQUIRES_REVIEW',
  'BLOCKED'
])

/**
 * `input`:
 *  - robotsDecision: 'ALLOWED' | 'DISALLOWED' | 'UNKNOWN'
 *  - authenticationRequired, officialExportAvailable, paywallDetected: boolean
 *  - termsBlocked: boolean (explicit known-blocked terms signal)
 *  - explicitPublicAllowance: boolean -- an operator/caller affirmation that
 *    this source's terms permit this extraction. Never inferred.
 */
export function classifyWebSourceAccess(input) {
  const {
    robotsDecision = 'UNKNOWN',
    authenticationRequired = false,
    officialExportAvailable = false,
    paywallDetected = false,
    termsBlocked = false,
    explicitPublicAllowance = false
  } = input

  if (authenticationRequired && officialExportAvailable) {
    return decision(
      'AUTHENTICATED_OFFICIAL_EXPORT',
      'ROUTE_TO_EXPORT_PATH',
      false,
      'An official authenticated export exists; route there instead of scraping the page.'
    )
  }
  if (authenticationRequired) {
    return decision(
      'AUTHENTICATED_PAGE_NO_EXPORT',
      'BLOCKED',
      false,
      'Source requires authentication and has no official export; extraction refused.'
    )
  }
  if (paywallDetected) {
    return decision(
      'PAYWALL_ACCESS_CONTROL',
      'BLOCKED',
      false,
      'Source is behind a paywall/access control; extraction refused.'
    )
  }
  if (robotsDecision === 'DISALLOWED') {
    return decision(
      'ROBOTS_DISALLOWED',
      'BLOCKED',
      false,
      'robots.txt disallows this path; extraction refused.'
    )
  }
  if (termsBlocked) {
    return decision(
      'TERMS_BLOCKED',
      'BLOCKED',
      false,
      'Source terms are known to block this use; extraction refused.'
    )
  }
  if (robotsDecision === 'ALLOWED' && explicitPublicAllowance) {
    return decision(
      'PUBLIC_ALLOWED',
      'ALLOWED',
      false,
      'robots.txt allows this path and public use was explicitly affirmed.'
    )
  }
  return decision(
    'PUBLIC_TERMS_UNCLEAR',
    'REQUIRES_REVIEW',
    true,
    'No explicit affirmation that public extraction is permitted; failing closed pending operator review.'
  )
}

function decision(accessClassification, adapterDecision, operatorReviewRequired, decisionReason) {
  if (!ACCESS_CLASSIFICATIONS.includes(accessClassification)) {
    throw new Error(`Unknown access classification: ${accessClassification}`)
  }
  if (!ADAPTER_DECISIONS.includes(adapterDecision)) {
    throw new Error(`Unknown adapter decision: ${adapterDecision}`)
  }
  return { accessClassification, decision: adapterDecision, operatorReviewRequired, decisionReason }
}

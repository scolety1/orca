import test from 'node:test'
import assert from 'node:assert/strict'
import {
  classifyWebSourceAccess,
  ACCESS_CLASSIFICATIONS
} from '../domain/web-source-access-gate.mjs'

test('every access classification in the taxonomy is reachable and typed', () => {
  assert.deepEqual(ACCESS_CLASSIFICATIONS, [
    'PUBLIC_ALLOWED',
    'PUBLIC_TERMS_UNCLEAR',
    'AUTHENTICATED_OFFICIAL_EXPORT',
    'AUTHENTICATED_PAGE_NO_EXPORT',
    'ROBOTS_DISALLOWED',
    'TERMS_BLOCKED',
    'PAYWALL_ACCESS_CONTROL',
    // Phase 3 Wave 2 (3E) additive: real post-fetch content classification
    // values, unreachable from classifyWebSourceAccess's own pre-fetch
    // input-only rules -- see web-source-content-access-classifier.mjs.
    'ANTI_BOT_CHALLENGE_DETECTED',
    'SOURCE_UNAVAILABLE',
    // Phase 3 Wave 2 (3C) additive: OWNER_SUPPLIED_LOCAL_ARTIFACT has no
    // web-rights concept at all -- see web-source-acquisition-receipt.mjs's
    // buildOwnerSuppliedArtifactReceipt.
    'NOT_APPLICABLE_LOCAL_ARTIFACT'
  ])
})

test('PUBLIC_ALLOWED requires both robots-allow and an explicit affirmation', () => {
  const result = classifyWebSourceAccess({
    robotsDecision: 'ALLOWED',
    explicitPublicAllowance: true
  })
  assert.equal(result.accessClassification, 'PUBLIC_ALLOWED')
  assert.equal(result.decision, 'ALLOWED')
  assert.equal(result.operatorReviewRequired, false)
})

test('robots-allow without an explicit affirmation fails closed to PUBLIC_TERMS_UNCLEAR', () => {
  const result = classifyWebSourceAccess({ robotsDecision: 'ALLOWED' })
  assert.equal(result.accessClassification, 'PUBLIC_TERMS_UNCLEAR')
  assert.equal(result.decision, 'REQUIRES_REVIEW')
  assert.equal(result.operatorReviewRequired, true)
})

test('no input at all fails closed to PUBLIC_TERMS_UNCLEAR, never PUBLIC_ALLOWED', () => {
  const result = classifyWebSourceAccess({})
  assert.equal(result.accessClassification, 'PUBLIC_TERMS_UNCLEAR')
  assert.notEqual(result.decision, 'ALLOWED')
})

test('robots disallow blocks regardless of other flags', () => {
  const result = classifyWebSourceAccess({
    robotsDecision: 'DISALLOWED',
    explicitPublicAllowance: true
  })
  assert.equal(result.accessClassification, 'ROBOTS_DISALLOWED')
  assert.equal(result.decision, 'BLOCKED')
})

test('authenticated + official export routes to the export path, not this adapter', () => {
  const result = classifyWebSourceAccess({
    authenticationRequired: true,
    officialExportAvailable: true
  })
  assert.equal(result.accessClassification, 'AUTHENTICATED_OFFICIAL_EXPORT')
  assert.equal(result.decision, 'ROUTE_TO_EXPORT_PATH')
})

test('authenticated without an export is blocked', () => {
  const result = classifyWebSourceAccess({ authenticationRequired: true })
  assert.equal(result.accessClassification, 'AUTHENTICATED_PAGE_NO_EXPORT')
  assert.equal(result.decision, 'BLOCKED')
})

test('paywall is blocked even with robots-allow and an affirmation', () => {
  const result = classifyWebSourceAccess({
    robotsDecision: 'ALLOWED',
    explicitPublicAllowance: true,
    paywallDetected: true
  })
  assert.equal(result.accessClassification, 'PAYWALL_ACCESS_CONTROL')
  assert.equal(result.decision, 'BLOCKED')
})

test('explicit terms-blocked signal is blocked even with robots-allow', () => {
  const result = classifyWebSourceAccess({ robotsDecision: 'ALLOWED', termsBlocked: true })
  assert.equal(result.accessClassification, 'TERMS_BLOCKED')
  assert.equal(result.decision, 'BLOCKED')
})

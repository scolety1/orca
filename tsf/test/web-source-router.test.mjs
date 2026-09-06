import test from 'node:test'
import assert from 'node:assert/strict'
import { routeSourceCandidate, WEB_TABLE_SOURCE_ADAPTER_ID } from '../domain/web-source-router.mjs'

test('routes an allowed public source to the static-table adapter', () => {
  const decision = routeSourceCandidate(
    { url: 'https://example.com/stats' },
    { robotsDecision: 'ALLOWED', explicitPublicAllowance: true }
  )
  assert.equal(decision.decision, 'STATIC_TABLE_ADAPTER')
  assert.equal(decision.adapterId, WEB_TABLE_SOURCE_ADAPTER_ID)
  assert.equal(decision.acquisitionMode, 'PUBLIC_WEB_SOURCE_EXTRACTION')
  assert.equal(decision.operatorReviewRequired, false)
})

test('does not invoke the adapter for an unclear-terms source', () => {
  const decision = routeSourceCandidate({ url: 'https://example.com/stats' }, {})
  assert.equal(decision.decision, 'REQUIRES_REVIEW')
  assert.equal(decision.adapterId, null)
  assert.equal(decision.operatorReviewRequired, true)
})

test('routes an authenticated-export source away from the static-table adapter', () => {
  const decision = routeSourceCandidate(
    { url: 'https://example.com/export' },
    { authenticationRequired: true, officialExportAvailable: true }
  )
  assert.equal(decision.decision, 'ROUTE_TO_EXPORT_PATH')
  assert.equal(decision.adapterId, null)
  assert.equal(decision.acquisitionMode, 'AUTHENTICATED_OFFICIAL_DOWNLOAD')
})

test('every blocked classification refuses the static-table adapter', () => {
  const scenarios = [
    { robotsDecision: 'DISALLOWED' },
    { termsBlocked: true, robotsDecision: 'ALLOWED' },
    { paywallDetected: true },
    { authenticationRequired: true }
  ]
  for (const accessInput of scenarios) {
    const decision = routeSourceCandidate({ url: 'https://example.com/x' }, accessInput)
    assert.equal(decision.adapterId, null)
    assert.notEqual(decision.decision, 'STATIC_TABLE_ADAPTER')
  }
})

test('an allowed PDF candidate is not routed to the static-table adapter, and never surfaces bare ALLOWED (not a legal receipt decision)', () => {
  const decision = routeSourceCandidate(
    { url: 'https://example.com/report.pdf', contentTypeHint: 'PDF' },
    { robotsDecision: 'ALLOWED', explicitPublicAllowance: true }
  )
  assert.equal(decision.adapterId, null)
  assert.equal(decision.decision, 'REQUIRES_REVIEW')
  assert.equal(decision.operatorReviewRequired, true)
})

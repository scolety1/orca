// Phase 3 Wave 2 (3E): real classification of what a fetch ACTUALLY
// encountered, distinct from the pre-fetch, input-only rights gate.
import test from 'node:test'
import assert from 'node:assert/strict'
import { classifyFetchedContentAccess } from '../domain/web-source-content-access-classifier.mjs'

test('HTTP 401 classifies as authentication-required, blocked', () => {
  const result = classifyFetchedContentAccess({ httpStatus: 401, bodyText: null, requestedUrl: 'https://example.com/x' })
  assert.equal(result.accessClassification, 'AUTHENTICATED_PAGE_NO_EXPORT')
  assert.equal(result.blocked, true)
  assert.deepEqual(result.signalsDetected, ['HTTP_401'])
})

test('HTTP 403 with an anti-bot marker classifies as anti-bot-challenge, not generic auth', () => {
  const result = classifyFetchedContentAccess({ httpStatus: 403, bodyText: '<html><body>Checking your browser before accessing example.com. cf-chl-2</body></html>' })
  assert.equal(result.accessClassification, 'ANTI_BOT_CHALLENGE_DETECTED')
  assert.equal(result.blocked, true)
})

test('bare HTTP 403 with no anti-bot marker classifies as authentication-required, never guessed as anti-bot', () => {
  const result = classifyFetchedContentAccess({ httpStatus: 403, bodyText: '<html><body>Forbidden</body></html>' })
  assert.equal(result.accessClassification, 'AUTHENTICATED_PAGE_NO_EXPORT')
})

test('HTTP 404/410 classify as source-unavailable', () => {
  assert.equal(classifyFetchedContentAccess({ httpStatus: 404 }).accessClassification, 'SOURCE_UNAVAILABLE')
  assert.equal(classifyFetchedContentAccess({ httpStatus: 410 }).accessClassification, 'SOURCE_UNAVAILABLE')
})

test('HTTP 5xx classifies as source-unavailable', () => {
  const result = classifyFetchedContentAccess({ httpStatus: 503 })
  assert.equal(result.accessClassification, 'SOURCE_UNAVAILABLE')
  assert.equal(result.blocked, true)
})

test('a 200 response with an anti-bot challenge marker in the body is fail-closed classified, never a success', () => {
  const result = classifyFetchedContentAccess({ httpStatus: 200, bodyText: '<html><body>Please verify you are a human by completing the security check.</body></html>' })
  assert.equal(result.accessClassification, 'ANTI_BOT_CHALLENGE_DETECTED')
  assert.equal(result.blocked, true)
})

test('a 200 response with a subscribe-to-continue paywall marker is classified as a paywall, never a real acquisition', () => {
  const result = classifyFetchedContentAccess({ httpStatus: 200, bodyText: '<html><body><h1>Article</h1><p>Subscribe to continue reading this story.</p></body></html>' })
  assert.equal(result.accessClassification, 'PAYWALL_ACCESS_CONTROL')
  assert.equal(result.blocked, true)
})

test('a redirect to a login-shaped path is classified as authentication-required', () => {
  const result = classifyFetchedContentAccess({
    httpStatus: 200,
    bodyText: '<html><body>Please sign in</body></html>',
    requestedUrl: 'https://example.com/protected-report',
    finalUrl: 'https://example.com/login?returnTo=/protected-report'
  })
  assert.equal(result.accessClassification, 'AUTHENTICATED_PAGE_NO_EXPORT')
  assert.deepEqual(result.signalsDetected, ['REDIRECT_TO_LOGIN'])
})

test('a bare login shell (password field, no real content) is classified as authentication-required', () => {
  const result = classifyFetchedContentAccess({
    httpStatus: 200,
    bodyText: '<html><body><form><input type="password" name="p"></form></body></html>'
  })
  assert.equal(result.accessClassification, 'AUTHENTICATED_PAGE_NO_EXPORT')
  assert.deepEqual(result.signalsDetected, ['LOGIN_FORM_PRESENT', 'NO_SUBSTANTIAL_CONTENT'])
})

test('a login widget alongside real substantial content (a table, a long body) is genuinely ambiguous, not confidently blocked or allowed', () => {
  const table = `<table><tr><th>Name</th><th>Value</th></tr>${'<tr><td>Row</td><td>Data</td></tr>'.repeat(100)}</table>`
  const bodyText = `<html><body><input type="password" name="loginWidget">${table}</body></html>`
  const result = classifyFetchedContentAccess({ httpStatus: 200, bodyText })
  assert.equal(result.accessClassification, 'PUBLIC_TERMS_UNCLEAR')
  assert.equal(result.blocked, true)
})

test('a plain, small, real fixture-shaped page with no signal at all is honestly PUBLIC_ALLOWED, never falsely flagged ambiguous', () => {
  const result = classifyFetchedContentAccess({
    httpStatus: 200,
    bodyText: '<html><body><table><tr><th>Player</th><th>Yards</th></tr><tr><td>Brett Favre</td><td>4413</td></tr></table></body></html>',
    requestedUrl: 'https://example.com/1995-qb-stats',
    finalUrl: 'https://example.com/1995-qb-stats'
  })
  assert.equal(result.accessClassification, 'PUBLIC_ALLOWED')
  assert.equal(result.blocked, false)
  assert.deepEqual(result.signalsDetected, [])
})

test('no httpStatus and no bodyText (e.g. a network-level failure) is a non-blocking default -- never fabricates a block from no evidence', () => {
  const result = classifyFetchedContentAccess({})
  assert.equal(result.accessClassification, 'PUBLIC_ALLOWED')
  assert.equal(result.blocked, false)
})

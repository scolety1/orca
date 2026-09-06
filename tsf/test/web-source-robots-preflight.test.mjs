import test from 'node:test'
import assert from 'node:assert/strict'
import {
  performRobotsPreflight,
  applyRobotsEvidenceToAccessInput
} from '../domain/web-source-robots-preflight.mjs'
import { TSF_WEB_ACQUISITION_USER_AGENT } from '../adapters/robots-txt-fetch.mjs'
import { classifyWebSourceAccess } from '../domain/web-source-access-gate.mjs'

const publicResolve = async () => [{ address: '93.184.216.34' }]
const clock = () => new Date('2026-09-04T12:00:00Z')

function textResponse(body, { status = 200, contentType = 'text/plain' } = {}) {
  return new Response(body, { status, headers: { 'content-type': contentType } })
}

test('sends the explicit acquisition user-agent on the robots.txt request', async () => {
  let seenUserAgent = null
  await performRobotsPreflight({
    url: 'https://example.com/page',
    fetchOptions: {
      resolveImpl: publicResolve,
      fetchImpl: async (url, init) => {
        seenUserAgent = init.headers['User-Agent']
        return textResponse('User-agent: *\nAllow: /')
      }
    },
    clock
  })
  assert.equal(seenUserAgent, TSF_WEB_ACQUISITION_USER_AGENT)
})

test('fetches only the origin /robots.txt regardless of the candidate path', async () => {
  let requestedUrl = null
  await performRobotsPreflight({
    url: 'https://example.com/deep/nested/page?x=1',
    fetchOptions: {
      resolveImpl: publicResolve,
      fetchImpl: async (url) => {
        requestedUrl = url
        return textResponse('User-agent: *\nAllow: /')
      }
    },
    clock
  })
  assert.equal(requestedUrl, 'https://example.com/robots.txt')
})

test('ALLOWED outcome maps to gate input ALLOWED', async () => {
  const evidence = await performRobotsPreflight({
    url: 'https://example.com/public/page',
    fetchOptions: {
      resolveImpl: publicResolve,
      fetchImpl: async () => textResponse('User-agent: *\nAllow: /')
    },
    clock
  })
  assert.equal(evidence.outcome, 'ALLOWED')
  assert.equal(evidence.robotsDecisionForGate, 'ALLOWED')
})

test('DISALLOWED outcome maps to gate input DISALLOWED', async () => {
  const evidence = await performRobotsPreflight({
    url: 'https://example.com/private/page',
    fetchOptions: {
      resolveImpl: publicResolve,
      fetchImpl: async () => textResponse('User-agent: *\nDisallow: /private/')
    },
    clock
  })
  assert.equal(evidence.outcome, 'DISALLOWED')
  assert.equal(evidence.robotsDecisionForGate, 'DISALLOWED')
  assert.equal(evidence.matchedRule.pattern, '/private/')
})

test('a 404 robots.txt is ROBOTS_NOT_FOUND, mapped to gate ALLOWED (but never alone sufficient)', async () => {
  const evidence = await performRobotsPreflight({
    url: 'https://example.com/page',
    fetchOptions: {
      resolveImpl: publicResolve,
      fetchImpl: async () => textResponse('not found', { status: 404 })
    },
    clock
  })
  assert.equal(evidence.outcome, 'ROBOTS_NOT_FOUND')
  assert.equal(evidence.robotsDecisionForGate, 'ALLOWED')
  // fail-closed sanity: this alone still doesn't reach PUBLIC_ALLOWED without an affirmation
  const access = classifyWebSourceAccess(applyRobotsEvidenceToAccessInput(evidence, {}))
  assert.equal(access.accessClassification, 'PUBLIC_TERMS_UNCLEAR')
})

test('a 5xx robots.txt is ROBOTS_UNREACHABLE, fails closed to UNKNOWN (not DISALLOWED, not ALLOWED)', async () => {
  const evidence = await performRobotsPreflight({
    url: 'https://example.com/page',
    fetchOptions: {
      resolveImpl: publicResolve,
      fetchImpl: async () => textResponse('error', { status: 503 }),
      sleepImpl: () => Promise.resolve()
    },
    clock
  })
  assert.equal(evidence.outcome, 'ROBOTS_UNREACHABLE')
  assert.equal(evidence.robotsDecisionForGate, 'UNKNOWN')
})

test('a network error is ROBOTS_UNREACHABLE / UNKNOWN', async () => {
  const evidence = await performRobotsPreflight({
    url: 'https://example.com/page',
    fetchOptions: {
      resolveImpl: publicResolve,
      fetchImpl: async () => {
        throw new Error('ECONNRESET')
      },
      sleepImpl: () => Promise.resolve()
    },
    clock
  })
  assert.equal(evidence.outcome, 'ROBOTS_UNREACHABLE')
  assert.equal(evidence.robotsDecisionForGate, 'UNKNOWN')
})

test('a non-text/plain response is ROBOTS_INVALID / UNKNOWN', async () => {
  const evidence = await performRobotsPreflight({
    url: 'https://example.com/page',
    fetchOptions: {
      resolveImpl: publicResolve,
      fetchImpl: async () => textResponse('<html>oops</html>', { contentType: 'text/html' })
    },
    clock
  })
  assert.equal(evidence.outcome, 'ROBOTS_INVALID')
  assert.equal(evidence.robotsDecisionForGate, 'UNKNOWN')
})

test('a redirect to a private address is ROBOTS_UNSAFE_REDIRECT / UNKNOWN', async () => {
  const evidence = await performRobotsPreflight({
    url: 'https://example.com/page',
    fetchOptions: {
      resolveImpl: publicResolve,
      fetchImpl: async (url) =>
        url.includes('robots.txt')
          ? new Response(null, {
              status: 302,
              headers: { location: 'http://169.254.169.254/robots.txt' }
            })
          : textResponse('User-agent: *\nAllow: /')
    },
    clock
  })
  assert.equal(evidence.outcome, 'ROBOTS_UNSAFE_REDIRECT')
  assert.equal(evidence.robotsDecisionForGate, 'UNKNOWN')
})

test('raw robots content is never retained unless explicitly requested', async () => {
  const fetchImpl = async () => textResponse('User-agent: *\nAllow: /')
  const withoutRetention = await performRobotsPreflight({
    url: 'https://example.com/page',
    fetchOptions: { resolveImpl: publicResolve, fetchImpl },
    clock
  })
  const withRetention = await performRobotsPreflight({
    url: 'https://example.com/page',
    fetchOptions: { resolveImpl: publicResolve, fetchImpl },
    retainRawRobotsContent: true,
    clock
  })
  assert.equal(withoutRetention.robotsContentRetained, false)
  assert.equal(withoutRetention.robotsContent, null)
  assert.equal(withRetention.robotsContentRetained, true)
  assert.match(withRetention.robotsContent, /User-agent/)
})

test('a caller cannot override live DISALLOWED evidence with a favorable claim', async () => {
  const evidence = await performRobotsPreflight({
    url: 'https://example.com/blocked',
    fetchOptions: {
      resolveImpl: publicResolve,
      fetchImpl: async () => textResponse('User-agent: *\nDisallow: /blocked')
    },
    clock
  })
  const merged = applyRobotsEvidenceToAccessInput(evidence, {
    robotsDecision: 'ALLOWED',
    explicitPublicAllowance: true
  })
  assert.equal(merged.robotsDecision, 'DISALLOWED')
  const access = classifyWebSourceAccess(merged)
  assert.equal(access.accessClassification, 'ROBOTS_DISALLOWED')
  assert.equal(access.decision, 'BLOCKED')
})

test('a caller cannot smuggle an ALLOWED claim past unreachable/indeterminate live evidence either', async () => {
  const evidence = await performRobotsPreflight({
    url: 'https://example.com/page',
    fetchOptions: {
      resolveImpl: publicResolve,
      fetchImpl: async () => {
        throw new Error('down')
      },
      sleepImpl: () => Promise.resolve()
    },
    clock
  })
  const merged = applyRobotsEvidenceToAccessInput(evidence, {
    robotsDecision: 'ALLOWED',
    explicitPublicAllowance: true
  })
  assert.equal(merged.robotsDecision, 'UNKNOWN')
  const access = classifyWebSourceAccess(merged)
  assert.equal(access.accessClassification, 'PUBLIC_TERMS_UNCLEAR')
})

test('other caller-supplied access flags survive the merge untouched', () => {
  const evidence = { robotsDecisionForGate: 'ALLOWED' }
  const merged = applyRobotsEvidenceToAccessInput(evidence, {
    paywallDetected: true,
    explicitPublicAllowance: true
  })
  assert.equal(merged.paywallDetected, true)
  assert.equal(merged.explicitPublicAllowance, true)
  assert.equal(merged.robotsDecision, 'ALLOWED')
})

test('a malformed candidate URL fails closed (UNKNOWN) instead of throwing out of preflight', async () => {
  const evidence = await performRobotsPreflight({
    url: 'not a valid url',
    fetchOptions: { resolveImpl: publicResolve, fetchImpl: async () => textResponse('User-agent: *\nAllow: /') },
    clock
  })
  assert.equal(evidence.outcome, 'ROBOTS_INVALID')
  assert.equal(evidence.robotsDecisionForGate, 'UNKNOWN')
})

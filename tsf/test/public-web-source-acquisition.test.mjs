// Tests the safe-by-default PRODUCTION entrypoint itself. The underlying
// pinning mechanism (socket-level correctness, redirect re-validation,
// mixed-family addresses, TLS/SNI, connection pooling) is already proven
// against real local sockets in pinned-connection-fetch.test.mjs; these
// tests focus on what is new here: automatic wiring, the impossibility of
// accidentally selecting an unpinned path, fail-closed construction
// failure, and truthful capability/transport evidence. A fully successful
// extraction cannot be exercised through this entrypoint's own SSRF gate
// using a local server (loopback is deliberately always blocked) -- that
// end-to-end proof lives in pinned-connection-fetch.test.mjs, which
// exercises the identical createPinnedFetch construction against a real
// local socket without going through this entrypoint's SSRF layer.

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  acquirePublicWebTableSource,
  WEB_PUBLIC_ACQUISITION_TRANSPORT_CAPABILITY_V1
} from '../domain/public-web-source-acquisition.mjs'

const loopbackResolve = async () => [{ address: '127.0.0.1' }]

function spyOnGlobalFetch() {
  const original = globalThis.fetch
  let callCount = 0
  globalThis.fetch = (...args) => {
    callCount++
    return original(...args)
  }
  return {
    restore: () => {
      globalThis.fetch = original
    },
    callCount: () => callCount
  }
}

test('capability descriptor has the exact required, honest shape', () => {
  const cap = WEB_PUBLIC_ACQUISITION_TRANSPORT_CAPABILITY_V1
  assert.equal(cap.liveRobotsPreflightSupported, true)
  assert.equal(cap.dnsPinningSupported, true)
  assert.equal(cap.dnsPinningRequiredByPublicEntrypoint, true)
  assert.equal(cap.ordinaryFetchFallbackProhibited, true)
  assert.equal(cap.redirectsRevalidatedAndRepinned, true)
  assert.equal(cap.rightsAuthorizationStillRequired, true)
  assert.equal(cap.rawHtmlDurableRetentionProhibitedByDefault, true)
  assert.equal(cap.nestedTableWarningAvailable, true)
  assert.equal(cap.arbitraryPublicUrlNetworkPreflightStatus, 'NETWORK_SAFE_PREFLIGHT_ONLY')
})

test('a normal call automatically routes robots retrieval through pinned transport (proven by the SSRF gate firing on the robots.txt request itself)', async () => {
  const { receipt } = await acquirePublicWebTableSource({
    candidate: { url: 'https://example.com/page' },
    accessInput: { robotsDecision: 'ALLOWED', explicitPublicAllowance: true }, // a favorable caller claim
    resolveImpl: loopbackResolve
  })
  // The robots.txt fetch itself went through the pinned/SSRF-validated path
  // and was blocked there -- not silently allowed via ordinary fetch, and
  // not silently answered from the caller's favorable claim.
  assert.equal(receipt.robotsEvidence.outcome, 'ROBOTS_UNSAFE_REDIRECT')
  assert.equal(receipt.robotsEvidence.robotsDecisionForGate, 'UNKNOWN')
  assert.equal(receipt.accessClassification, 'PUBLIC_TERMS_UNCLEAR')
  assert.equal(receipt.decision, 'REQUIRES_REVIEW')
  assert.equal(receipt.transportEvidence.robotsUsedPinnedTransport, true)
  assert.equal(receipt.transportEvidence.ordinaryFetchFallbackOccurred, false)
})

test('the caller has no way to omit pinning: an injected fetchOptions/fetchImpl property is silently ignored', async () => {
  let unsafeFetchCalled = false
  const { receipt } = await acquirePublicWebTableSource({
    candidate: { url: 'https://example.com/page' },
    accessInput: { robotsDecision: 'ALLOWED', explicitPublicAllowance: true },
    resolveImpl: loopbackResolve,
    // Not a real parameter of this function -- proving it has zero effect,
    // not merely that the caller "shouldn't" pass it.
    fetchOptions: {
      fetchImpl: async () => {
        unsafeFetchCalled = true
        return new Response('<table></table>')
      }
    }
  })
  assert.equal(unsafeFetchCalled, false)
  assert.equal(
    receipt.robotsEvidence.outcome,
    'ROBOTS_UNSAFE_REDIRECT',
    'still went through the real pinned/SSRF path, not the injected one'
  )
})

test('global fetch is never called, even when the request ultimately fails', async () => {
  const spy = spyOnGlobalFetch()
  try {
    await acquirePublicWebTableSource({
      candidate: { url: 'https://example.com/page' },
      accessInput: { robotsDecision: 'ALLOWED', explicitPublicAllowance: true },
      resolveImpl: loopbackResolve
    })
    assert.equal(spy.callCount(), 0)
  } finally {
    spy.restore()
  }
})

test('global fetch is never called even when rights are refused before any fetch would happen', async () => {
  const spy = spyOnGlobalFetch()
  try {
    await acquirePublicWebTableSource({
      candidate: { url: 'https://example.com/page' },
      accessInput: {}, // PUBLIC_TERMS_UNCLEAR
      resolveImpl: loopbackResolve
    })
    assert.equal(spy.callCount(), 0)
  } finally {
    spy.restore()
  }
})

test('pinned-transport construction failure refuses the acquisition, fails closed, and never falls back', async () => {
  const spy = spyOnGlobalFetch()
  try {
    const { receipt } = await acquirePublicWebTableSource({
      candidate: { url: 'https://example.com/page' },
      accessInput: { robotsDecision: 'ALLOWED', explicitPublicAllowance: true },
      resolveImpl: 'not-a-function' // triggers createPinnedFetch's synchronous validation
    })
    assert.equal(receipt.decision, 'EXTRACTION_FAILED')
    assert.match(receipt.decisionReason, /PINNED_TRANSPORT_CONSTRUCTION_FAILED/)
    assert.equal(receipt.transportEvidence.robotsUsedPinnedTransport, false)
    assert.equal(receipt.transportEvidence.contentUsedPinnedTransport, false)
    assert.equal(receipt.transportEvidence.ordinaryFetchFallbackOccurred, false)
    assert.equal(spy.callCount(), 0)
  } finally {
    spy.restore()
  }
})

test('robots preflight is mandatory here, not caller-toggleable: robotsEvidence is always populated and always wins over a caller claim', async () => {
  const { receipt } = await acquirePublicWebTableSource({
    candidate: { url: 'https://example.com/page' },
    accessInput: { robotsDecision: 'ALLOWED', explicitPublicAllowance: true }, // a caller-supplied claim
    resolveImpl: loopbackResolve
  })
  assert.ok(
    receipt.robotsEvidence,
    'robots preflight must have run even though nothing enabled it explicitly'
  )
  assert.equal(
    receipt.accessClassification,
    'PUBLIC_TERMS_UNCLEAR',
    "the caller's favorable robotsDecision claim did not survive"
  )
})

test('rights denial still overrides even though network preflight would otherwise be attempted', async () => {
  const { receipt } = await acquirePublicWebTableSource({
    candidate: { url: 'https://example.com/page' },
    accessInput: { paywallDetected: true },
    resolveImpl: loopbackResolve
  })
  assert.equal(receipt.accessClassification, 'PAYWALL_ACCESS_CONTROL')
  assert.equal(receipt.decision, 'BLOCKED')
})

test('PUBLIC_TERMS_UNCLEAR still requires review through this entrypoint', async () => {
  const { receipt, routeDecision } = await acquirePublicWebTableSource({
    candidate: { url: 'https://example.com/page' },
    accessInput: {},
    resolveImpl: loopbackResolve
  })
  assert.equal(receipt.accessClassification, 'PUBLIC_TERMS_UNCLEAR')
  assert.equal(receipt.decision, 'REQUIRES_REVIEW')
  assert.equal(routeDecision.operatorReviewRequired, true)
})

// Rights classifications not gated by robotsDecision (unlike ROBOTS_DISALLOWED,
// which live robots preflight would need to actually observe -- not
// reachable here since this entrypoint's SSRF gate always blocks the
// loopback-only test infrastructure, same documented limitation as the
// header comment above) still refuse/route-away correctly through this
// specific entrypoint, not just through the lower-level orchestrator.
test('TERMS_BLOCKED still refuses through this entrypoint', async () => {
  const { receipt } = await acquirePublicWebTableSource({
    candidate: { url: 'https://example.com/page' },
    accessInput: { termsBlocked: true },
    resolveImpl: loopbackResolve
  })
  assert.equal(receipt.accessClassification, 'TERMS_BLOCKED')
  assert.equal(receipt.decision, 'BLOCKED')
})

test('AUTHENTICATED_PAGE_NO_EXPORT still refuses through this entrypoint', async () => {
  const { receipt } = await acquirePublicWebTableSource({
    candidate: { url: 'https://example.com/page' },
    accessInput: { authenticationRequired: true },
    resolveImpl: loopbackResolve
  })
  assert.equal(receipt.accessClassification, 'AUTHENTICATED_PAGE_NO_EXPORT')
  assert.equal(receipt.decision, 'BLOCKED')
})

test('AUTHENTICATED_OFFICIAL_EXPORT still routes away (never scraped) through this entrypoint', async () => {
  const { receipt } = await acquirePublicWebTableSource({
    candidate: { url: 'https://example.com/page' },
    accessInput: { authenticationRequired: true, officialExportAvailable: true },
    resolveImpl: loopbackResolve
  })
  assert.equal(receipt.accessClassification, 'AUTHENTICATED_OFFICIAL_EXPORT')
  assert.equal(receipt.decision, 'ROUTE_TO_EXPORT_PATH')
})

test('raw HTML cannot leak into the receipt through this entrypoint even when retention is requested', async () => {
  const { receipt } = await acquirePublicWebTableSource({
    candidate: { url: 'https://example.com/page' },
    accessInput: { robotsDecision: 'ALLOWED', explicitPublicAllowance: true },
    resolveImpl: loopbackResolve,
    retentionPolicy: { allowRawRetention: true }
  })
  // Never reached extraction (blocked before fetch), so artifactRef is null
  // regardless -- the meaningful assertion is that retention intent alone
  // cannot manufacture content that was never legitimately fetched.
  assert.equal(receipt.artifactRef, null)
})

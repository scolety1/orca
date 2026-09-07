// Phase 3 Wave 2 (3D): AUTHENTICATED_OFFICIAL_DOWNLOAD domain-level proof,
// fixture/mock-only per the governing directive -- no real external login
// is attempted or required anywhere in this file.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  acquireAuthenticatedOfficialDownload,
  AUTHENTICATED_SESSION_PROVIDER_CONTRACT_V1
} from '../domain/authenticated-official-download-acquisition.mjs'

const clock = () => new Date('2026-09-08T10:00:00.000Z')
const TABLE_HTML = '<html><body><table><tr><th>Player</th><th>Passing / Yards</th></tr><tr><td>Brett Favre</td><td>4413</td></tr></table></body></html>'

function fakeSessionProvider(session) {
  return { getSession: async () => session }
}

function fakeDownloadFn(result) {
  return async () => result
}

test('the contract descriptor documents a real, non-secret-carrying shape', () => {
  assert.equal(AUTHENTICATED_SESSION_PROVIDER_CONTRACT_V1.secretsNeverExposed, true)
  assert.match(AUTHENTICATED_SESSION_PROVIDER_CONTRACT_V1.mirrorsRealInfrastructure, /browser-session-registry/)
})

test('requires a sessionProvider implementing getSession', async () => {
  await assert.rejects(() => acquireAuthenticatedOfficialDownload({ candidate: { url: 'https://example.com/export' }, clock }), /sessionProvider/)
})

test('no authorized session -> NEEDS_INTERACTIVE_LOGIN, no download attempted, no bypass', async () => {
  let downloadCalled = false
  const { receipt } = await acquireAuthenticatedOfficialDownload({
    candidate: { url: 'https://example.com/export' },
    sessionProvider: fakeSessionProvider(null),
    downloadFn: async () => {
      downloadCalled = true
      return { ok: true }
    },
    clock
  })
  assert.equal(receipt.decision, 'NEEDS_INTERACTIVE_LOGIN')
  assert.equal(receipt.operatorReviewRequired, true)
  assert.equal(downloadCalled, false, 'never attempts a download without a real authorized session')
  assert.doesNotMatch(receipt.decisionReason, /password|cookie|token/i)
})

test('an authorized session + a real download yields EXTRACTED with non-secret authEvidence only', async () => {
  const session = { profileId: 'profile-abc', mechanism: 'IMPORTED_BROWSER_COOKIES', authenticatedAt: '2026-09-08T09:00:00.000Z' }
  const { receipt } = await acquireAuthenticatedOfficialDownload({
    candidate: { url: 'https://example.com/export' },
    sessionProvider: fakeSessionProvider(session),
    downloadFn: fakeDownloadFn({ ok: true, httpStatus: 200, bodyText: TABLE_HTML, finalUrl: 'https://example.com/export' }),
    clock
  })
  assert.equal(receipt.decision, 'EXTRACTED')
  assert.equal(receipt.acquisitionMode, 'AUTHENTICATED_OFFICIAL_DOWNLOAD')
  assert.equal(receipt.accessClassification, 'AUTHENTICATED_OFFICIAL_EXPORT')
  assert.equal(receipt.authEvidence.mechanism, 'IMPORTED_BROWSER_COOKIES')
  assert.equal(receipt.authEvidence.profileIdRef, 'profile-abc')
  assert.deepEqual(Object.keys(receipt.authEvidence).sort(), ['authenticatedAt', 'mechanism', 'profileIdRef', 'schemaVersion'])
})

test('a session object carrying a secret-shaped field throws rather than let it reach a receipt', async () => {
  const session = { profileId: 'p', mechanism: 'IMPORTED_BROWSER_COOKIES', authenticatedAt: 'x', cookieValue: 'super-secret' }
  await assert.rejects(
    () => acquireAuthenticatedOfficialDownload({
      candidate: { url: 'https://example.com/export' },
      sessionProvider: fakeSessionProvider(session),
      downloadFn: fakeDownloadFn({ ok: true, httpStatus: 200, bodyText: TABLE_HTML }),
      clock
    }),
    /must never carry a field named like a secret/
  )
})

test('a downloadFn result carrying a secret-shaped field also throws (defense in depth on both sides)', async () => {
  const session = { profileId: 'p', mechanism: 'IMPORTED_BROWSER_COOKIES', authenticatedAt: 'x' }
  await assert.rejects(
    () => acquireAuthenticatedOfficialDownload({
      candidate: { url: 'https://example.com/export' },
      sessionProvider: fakeSessionProvider(session),
      downloadFn: fakeDownloadFn({ ok: true, httpStatus: 200, bodyText: TABLE_HTML, sessionToken: 'abc' }),
      clock
    }),
    /must never carry a field named like a secret/
  )
})

test('a download that fails cleanly is reported honestly, never as a fabricated EXTRACTED', async () => {
  const session = { profileId: 'p', mechanism: 'REUSED_EXISTING_PROFILE', authenticatedAt: 'x' }
  const { receipt } = await acquireAuthenticatedOfficialDownload({
    candidate: { url: 'https://example.com/export' },
    sessionProvider: fakeSessionProvider(session),
    downloadFn: fakeDownloadFn({ ok: false, reason: 'NETWORK_ERROR', detail: 'boom' }),
    clock
  })
  assert.equal(receipt.decision, 'EXTRACTION_FAILED')
  assert.match(receipt.decisionReason, /NETWORK_ERROR/)
})

// 3E reused directly here: an authenticated download can still land on a
// paywall/re-auth interstitial (e.g. an expired session) -- never silently
// admitted as a real official export.
test('a re-auth/paywall interstitial from an authenticated download is classified, never treated as a successful export', async () => {
  const session = { profileId: 'p', mechanism: 'IMPORTED_BROWSER_COOKIES', authenticatedAt: 'x' }
  const { receipt } = await acquireAuthenticatedOfficialDownload({
    candidate: { url: 'https://example.com/export' },
    sessionProvider: fakeSessionProvider(session),
    downloadFn: fakeDownloadFn({ ok: true, httpStatus: 200, bodyText: '<html><body>Subscribe to continue reading this content.</body></html>', finalUrl: 'https://example.com/export' }),
    clock
  })
  assert.equal(receipt.decision, 'ACCESS_BLOCKED_POST_FETCH')
  assert.equal(receipt.accessClassification, 'PAYWALL_ACCESS_CONTROL')
  assert.equal(receipt.contentAccessEvidence.blocked, true)
})

test('no table found in the downloaded content is reported honestly', async () => {
  const session = { profileId: 'p', mechanism: 'IMPORTED_BROWSER_COOKIES', authenticatedAt: 'x' }
  const { receipt } = await acquireAuthenticatedOfficialDownload({
    candidate: { url: 'https://example.com/export' },
    sessionProvider: fakeSessionProvider(session),
    downloadFn: fakeDownloadFn({ ok: true, httpStatus: 200, bodyText: '<html><body>no table</body></html>' }),
    clock
  })
  assert.equal(receipt.decision, 'EXTRACTION_FAILED')
  assert.match(receipt.decisionReason, /NO_TABLES_FOUND/)
})

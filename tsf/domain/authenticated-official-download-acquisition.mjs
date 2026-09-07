// Phase 3 Wave 2 (3D): AUTHENTICATED_OFFICIAL_DOWNLOAD -- the acquisition
// path for official sources that require a user-authorized authenticated
// session. HARD SECURITY RULES (verbatim from the governing directive, no
// exceptions):
//  - never ask a user to paste a password/cookie/token/2FA secret;
//  - reuse an already-authorized session where supported;
//  - otherwise require a real, ONE-TIME interactive login the user
//    completes themselves, in their own browser/session -- never a flow
//    where a credential passes through this code or an LLM prompt;
//  - never circumvent authentication/access controls, never scrape around
//    a paywall;
//  - preserve auth-acquisition METADATA (mechanism/when) without ever
//    persisting the secret/token/cookie value itself.
//
// `sessionProvider` is dependency-injected per AUTHENTICATED_SESSION_
// PROVIDER_CONTRACT_V1 below (RECONCILIATION FINDING: real authenticated-
// session infrastructure already exists in this codebase --
// src/main/browser/browser-session-registry.ts + browser-cookie-import*.ts
// -- but it is Electron-main-process TypeScript, a different architectural
// layer than this plain-Node-ESM tsf/domain (which must stay Electron-free
// to run standalone/SSH-host-side, same discipline as electron-target-
// launcher.mjs's own separation). The contract's field names deliberately
// mirror that real registry's shape (a profile id/label plus a source
// marker) so a FUTURE adapters/ bridge could wrap browserSessionRegistry to
// satisfy it, without importing Electron here today.
//
// `downloadFn` performs the actual authenticated retrieval; NO default
// implementation exists in this V0 (see the final report -- proven only
// against fixtures/mocks, never a real external login, per the governing
// directive's own explicit allowance to defer that gap).
import { extractAndSelectTable } from './web-table-source-adapter.mjs'
import { classifyFetchedContentAccess } from './web-source-content-access-classifier.mjs'
import {
  buildAuthenticatedDownloadReceipt,
  buildAuthenticatedDownloadNeedsLoginReceipt,
  buildAuthenticatedDownloadFailureReceipt
} from './web-source-acquisition-receipt.mjs'

export const AUTHENTICATED_SESSION_PROVIDER_CONTRACT_V1 = Object.freeze({
  schemaVersion: 'AUTHENTICATED_SESSION_PROVIDER_CONTRACT_V1',
  description: "Minimal interface a real authenticated-session source must satisfy to be used here. Never exposes a credential/cookie/token VALUE -- only that a session exists, how it was established, and when.",
  requiredMethod: 'getSession(origin: string) -> Promise<{ profileId: string, mechanism: string, authenticatedAt: string, label?: string|null } | null>',
  mechanismExamples: ['IMPORTED_BROWSER_COOKIES', 'INTERACTIVE_LOGIN_COMPLETED', 'REUSED_EXISTING_PROFILE'],
  secretsNeverExposed: true,
  mirrorsRealInfrastructure: 'src/main/browser/browser-session-registry.ts (BrowserSessionProfile: id/label/source/partition) -- not imported here to keep tsf/domain Electron-free; a future adapters/ bridge would wrap it to satisfy this contract.'
})

// Defense in depth (structural, not just discipline): a caller's session
// object or downloadFn result must never carry a field whose NAME even
// suggests a secret -- this throws rather than silently letting one
// through to a receipt. Complements buildAuthEvidence's own allowlist
// projection in web-source-acquisition-receipt.mjs.
const FORBIDDEN_SECRET_KEY_FRAGMENTS = ['password', 'token', 'cookie', 'secret', 'apikey']
function assertNoSecretLeakage(obj, label) {
  for (const key of Object.keys(obj ?? {})) {
    const lower = key.toLowerCase()
    const hit = FORBIDDEN_SECRET_KEY_FRAGMENTS.find((fragment) => lower.includes(fragment))
    if (hit) {
      throw new Error(`${label} must never carry a field named like a secret ("${key}" matches "${hit}") -- authenticated acquisition never threads credential/token/cookie values through this code`)
    }
  }
}

export async function acquireAuthenticatedOfficialDownload({
  candidate,
  sessionProvider,
  downloadFn,
  tableSelectionHint,
  retentionPolicy = { allowRawRetention: false },
  clock = () => new Date()
}) {
  if (typeof sessionProvider?.getSession !== 'function') {
    throw new Error('acquireAuthenticatedOfficialDownload requires a sessionProvider implementing getSession(origin) -- see AUTHENTICATED_SESSION_PROVIDER_CONTRACT_V1')
  }
  let origin
  try {
    origin = new URL(candidate.url).origin
  } catch (error) {
    return { receipt: buildAuthenticatedDownloadFailureReceipt({ sourceUrl: candidate.url, failureReason: 'INVALID_URL', failureDetail: error.message, clock }) }
  }

  const session = await sessionProvider.getSession(origin)
  if (!session) {
    // Fail closed, never bypass: no session means no download is even
    // attempted. The caller (a UI-layer flow this wave does not build) is
    // where a real one-time interactive login would be surfaced.
    return { receipt: buildAuthenticatedDownloadNeedsLoginReceipt({ sourceUrl: candidate.url, origin, clock }) }
  }
  assertNoSecretLeakage(session, 'sessionProvider.getSession() result')

  if (typeof downloadFn !== 'function') {
    throw new Error('acquireAuthenticatedOfficialDownload requires a downloadFn({candidate, session}) -- no default real-network implementation exists in this V0 (fixture/mock-proven only; see the final report)')
  }
  let downloadResult
  try {
    downloadResult = await downloadFn({ candidate, session })
  } catch (error) {
    return { receipt: buildAuthenticatedDownloadFailureReceipt({ sourceUrl: candidate.url, session, failureReason: 'DOWNLOAD_ERROR', failureDetail: error.message, clock }) }
  }
  assertNoSecretLeakage(downloadResult, 'downloadFn() result')
  if (!downloadResult.ok) {
    return { receipt: buildAuthenticatedDownloadFailureReceipt({ sourceUrl: candidate.url, session, failureReason: downloadResult.reason ?? 'DOWNLOAD_FAILED', failureDetail: downloadResult.detail ?? null, clock }) }
  }

  // Real paywall/auth content classification (3E), reused directly: an
  // authenticated download can still land on a re-auth/paywall interstitial
  // (an expired or insufficiently-scoped session) -- never silently treated
  // as a successful official export.
  const contentAccess = classifyFetchedContentAccess({
    httpStatus: downloadResult.httpStatus ?? null,
    bodyText: downloadResult.bodyText ?? null,
    finalUrl: downloadResult.finalUrl ?? candidate.url,
    requestedUrl: candidate.url
  })
  if (contentAccess.blocked) {
    return {
      receipt: buildAuthenticatedDownloadFailureReceipt({
        sourceUrl: candidate.url,
        session,
        failureReason: 'CONTENT_ACCESS_BLOCKED',
        failureDetail: contentAccess.decisionReason,
        contentAccessEvidence: contentAccess,
        clock
      })
    }
  }

  const { table, schema } = extractAndSelectTable(downloadResult.bodyText, tableSelectionHint)
  if (!table) {
    return { receipt: buildAuthenticatedDownloadFailureReceipt({ sourceUrl: candidate.url, session, failureReason: 'NO_TABLES_FOUND', failureDetail: candidate.url, clock }) }
  }

  const receipt = buildAuthenticatedDownloadReceipt({
    sourceUrl: downloadResult.finalUrl ?? candidate.url,
    session,
    rawContent: downloadResult.bodyText,
    table,
    schema,
    retentionPolicy,
    clock
  })
  return { receipt }
}

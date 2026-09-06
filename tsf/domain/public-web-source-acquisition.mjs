// THE safe-by-default production entrypoint for PUBLIC_WEB_SOURCE_EXTRACTION.
// Invariant: pinned live robots request -> rights/access decision -> pinned
// content request -> pinned redirect handling -> no ordinary-fetch fallback.
//
// Deliberately does NOT accept a `fetchOptions`/`fetchImpl` parameter --
// there is no way for a caller of this function to select global fetch
// instead of the pinned transport, accidentally or otherwise. Test
// dependency injection stays one level down, on acquireWebSourceViaStaticTable
// (called directly by tests) and on `resolveImpl` here (which only
// influences which address gets vetted/pinned, never whether pinning
// happens -- every address it returns still passes through the unmodified
// SSRF guard before anything is pinned to it).
//
// Network-safe preflight only: passing this entrypoint's transport safety
// never implies PUBLIC_ALLOWED, redistribution/retention/training
// permission, or authorization to bypass authentication/paywalls/CAPTCHA/
// robots/technical controls. The access/rights gate inside
// acquireWebSourceViaStaticTable still runs, unmodified, and can still
// refuse.

import { createPinnedFetch } from '../adapters/pinned-connection-fetch.mjs'
import { acquireWebSourceViaStaticTable } from './web-table-source-adapter.mjs'
import { WEB_PUBLIC_ACQUISITION_TRANSPORT_CAPABILITY_V1 } from './web-source-acquisition-transport-capability.mjs'
import { buildExtractionFailureReceipt } from './web-source-acquisition-receipt.mjs'
import { routeSourceCandidate } from './web-source-router.mjs'

export { WEB_PUBLIC_ACQUISITION_TRANSPORT_CAPABILITY_V1 }

function transportEvidenceFor(usedPinning) {
  return {
    schemaVersion: 'WEB_PUBLIC_ACQUISITION_TRANSPORT_EVIDENCE_V1',
    transport: 'PINNED_CONNECTION_FETCH',
    robotsUsedPinnedTransport: usedPinning,
    contentUsedPinnedTransport: usedPinning,
    ordinaryFetchFallbackOccurred: false,
    capability: WEB_PUBLIC_ACQUISITION_TRANSPORT_CAPABILITY_V1.schemaVersion
  }
}

/**
 * The one production entrypoint for extracting a static HTML table from a
 * public web source. `resolveImpl` is the only network-shaped override
 * accepted (for deterministic DNS-answer testing); there is no way to pass
 * a `fetchImpl` here, so a normal caller cannot omit pinning by mistake.
 */
export async function acquirePublicWebTableSource({
  candidate,
  accessInput,
  resolveImpl,
  tableSelectionHint,
  previousSelectorFingerprint = null,
  retentionPolicy = { allowRawRetention: false },
  clock = () => new Date()
}) {
  let pinnedFetchImpl
  try {
    pinnedFetchImpl = createPinnedFetch({ resolveImpl })
  } catch (error) {
    // Fail closed: the safe transport itself could not even be constructed.
    // Never falls through to an unpinned fetch -- refuses the acquisition
    // with the same structured-failure-receipt guarantee as any other
    // extraction failure.
    const routeDecision = routeSourceCandidate(candidate, accessInput)
    return {
      receipt: buildExtractionFailureReceipt({
        routeDecision,
        failureReason: 'PINNED_TRANSPORT_CONSTRUCTION_FAILED',
        failureDetail: error.message,
        transportEvidence: transportEvidenceFor(false),
        clock
      }),
      routeDecision
    }
  }

  return acquireWebSourceViaStaticTable({
    candidate,
    accessInput,
    fetchOptions: { fetchImpl: pinnedFetchImpl, resolveImpl },
    robotsPreflight: { enabled: true }, // mandatory here, not caller-toggleable
    transportEvidence: transportEvidenceFor(true),
    tableSelectionHint,
    previousSelectorFingerprint,
    retentionPolicy,
    clock
  })
}

// SOURCE_ACQUISITION_ROUTER (minimal V0): given an already-discovered source
// candidate and its access classification, records the routing decision --
// whether the static-table adapter can handle it or it needs another route.
// This is not a search engine: candidate discovery happens upstream.

import { classifyWebSourceAccess, ACQUISITION_MODES } from './web-source-access-gate.mjs'

export const WEB_TABLE_SOURCE_ADAPTER_ID = 'web-table-source-adapter'
export const WEB_TABLE_SOURCE_ADAPTER_VERSION = '0.1.0'

/**
 * `candidate`: { url, contentTypeHint? } -- the already-discovered source.
 * `accessInput`: passed through to classifyWebSourceAccess.
 */
export function routeSourceCandidate(candidate, accessInput) {
  const access = classifyWebSourceAccess(accessInput)
  const staticTableEligible =
    access.decision === 'ALLOWED' &&
    candidate.contentTypeHint !== 'PDF' &&
    candidate.contentTypeHint !== 'AUTHENTICATED_EXPORT_FILE'

  const acquisitionMode =
    access.accessClassification === 'AUTHENTICATED_OFFICIAL_EXPORT'
      ? 'AUTHENTICATED_OFFICIAL_DOWNLOAD'
      : 'PUBLIC_WEB_SOURCE_EXTRACTION'
  if (!ACQUISITION_MODES.includes(acquisitionMode)) {
    throw new Error(`Unknown acquisition mode: ${acquisitionMode}`)
  }

  // access.decision === 'ALLOWED' is only ever a valid *receipt* decision when
  // the static-table adapter actually runs (routed below, outside this
  // function). An allowed source this router can't hand to any adapter (e.g.
  // unsupported content type) is not schema-legal as bare 'ALLOWED' on a
  // refusal receipt -- fall back to REQUIRES_REVIEW instead of leaking it.
  const routedDecision = staticTableEligible
    ? 'STATIC_TABLE_ADAPTER'
    : access.decision === 'ALLOWED'
      ? 'REQUIRES_REVIEW'
      : access.decision
  const routedReviewRequired = staticTableEligible
    ? access.operatorReviewRequired
    : access.decision === 'ALLOWED' || access.operatorReviewRequired

  return {
    schemaVersion: 'WEB_SOURCE_ACQUISITION_ROUTE_DECISION_V0',
    sourceCandidate: { url: candidate.url },
    acquisitionMode,
    adapterId: staticTableEligible ? WEB_TABLE_SOURCE_ADAPTER_ID : null,
    adapterVersion: staticTableEligible ? WEB_TABLE_SOURCE_ADAPTER_VERSION : null,
    accessClassification: access.accessClassification,
    decision: routedDecision,
    decisionReason: staticTableEligible
      ? access.decisionReason
      : `${access.decisionReason}${access.decision === 'ALLOWED' ? ' (content type not supported by the static-table adapter; needs another route.)' : ''}`,
    operatorReviewRequired: routedReviewRequired,
    downstreamReceiptTarget: 'WEB_SOURCE_ACQUISITION_RECEIPT_V0'
  }
}

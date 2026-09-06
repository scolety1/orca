// The generic acquisition receipt this worktree owns: WEB_SOURCE_ACQUISITION_RECEIPT_V0.
// Deliberately not the same object as tsf/domain/receipts.mjs's TSF_RECEIPT_KINDS
// hash chain -- that chain records TSF's own coding-mission lifecycle events
// (MISSION_CREATED, ADOPTION_DECISION, ...) and is owned by TSF governance,
// not by acquisition. Folding this receipt into that chain, or into Dataset
// Research's own provenance package, is a Main TSF integration decision this
// worktree does not make unilaterally -- see the final report's handoff list.

import { createHash } from 'node:crypto'

export const WEB_SOURCE_ACQUISITION_RECEIPT_SCHEMA = 'WEB_SOURCE_ACQUISITION_RECEIPT_V0'

function sha256(text) {
  return createHash('sha256').update(text, 'utf-8').digest('hex')
}

// Robots evidence may carry raw robots.txt content (opt-in, see
// web-source-robots-preflight.mjs). That raw text must never reach the
// canonical acquisition receipt regardless of what the caller retained at
// the preflight-evidence level -- stripped here unconditionally, same
// defense-in-depth stance as artifactRef.rawHtml below.
function sanitizeRobotsEvidence(robotsEvidence) {
  if (!robotsEvidence) {
    return null
  }
  const { robotsContent: _rawContent, ...evidenceWithoutRawContent } = robotsEvidence
  return { ...evidenceWithoutRawContent, robotsContentRetained: false }
}

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`
  }
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

/**
 * Builds the receipt for a REFUSED/blocked/review-required routing decision
 * -- no fetch was attempted, so there is no response/content evidence.
 */
export function buildRefusalReceipt({
  routeDecision,
  robotsEvidence = null,
  transportEvidence = null,
  clock = () => new Date()
}) {
  const body = {
    schemaVersion: WEB_SOURCE_ACQUISITION_RECEIPT_SCHEMA,
    acquisitionMode: routeDecision.acquisitionMode,
    sourceUrl: routeDecision.sourceCandidate.url,
    retrievalTime: null,
    adapter: { id: routeDecision.adapterId, version: routeDecision.adapterVersion },
    accessClassification: routeDecision.accessClassification,
    decision: routeDecision.decision,
    operatorReviewRequired: routeDecision.operatorReviewRequired,
    decisionReason: routeDecision.decisionReason,
    robotsEvidence: sanitizeRobotsEvidence(robotsEvidence),
    transportEvidence,
    sourceAsOf: null,
    responseMetadata: null,
    contentHash: null,
    normalizedTableHash: null,
    tableIdentity: null,
    schema: null,
    rowCount: null,
    warnings: [],
    artifactRef: null,
    createdAt: clock().toISOString()
  }
  return { ...body, receiptHash: sha256(stableStringify(body)) }
}

/**
 * Builds the receipt when routing allowed the adapter to run but retrieval
 * or table discovery itself failed (network/timeout/size/content-type/no
 * tables found) -- distinct from a rights refusal, which never reaches here.
 */
export function buildExtractionFailureReceipt({
  routeDecision,
  failureReason,
  failureDetail,
  robotsEvidence = null,
  transportEvidence = null,
  clock = () => new Date()
}) {
  const body = {
    schemaVersion: WEB_SOURCE_ACQUISITION_RECEIPT_SCHEMA,
    acquisitionMode: routeDecision.acquisitionMode,
    sourceUrl: routeDecision.sourceCandidate.url,
    retrievalTime: clock().toISOString(),
    adapter: { id: routeDecision.adapterId, version: routeDecision.adapterVersion },
    accessClassification: routeDecision.accessClassification,
    decision: 'EXTRACTION_FAILED',
    operatorReviewRequired: false,
    decisionReason: `${failureReason}: ${failureDetail ?? ''}`.trim(),
    robotsEvidence: sanitizeRobotsEvidence(robotsEvidence),
    transportEvidence,
    sourceAsOf: null,
    responseMetadata: null,
    contentHash: null,
    normalizedTableHash: null,
    tableIdentity: null,
    schema: null,
    rowCount: null,
    warnings: [failureReason],
    artifactRef: null,
    createdAt: clock().toISOString()
  }
  return { ...body, receiptHash: sha256(stableStringify(body)) }
}

/**
 * Builds the receipt for a successful static-table extraction.
 * `retentionPolicy.allowRawRetention` gates whether raw HTML is embedded.
 */
export function buildAcquisitionReceipt({
  routeDecision,
  fetchResult,
  table,
  schema,
  selectorFingerprint,
  driftEvidence,
  sourceAsOf,
  robotsEvidence = null,
  transportEvidence = null,
  retentionPolicy = { allowRawRetention: false },
  clock = () => new Date()
}) {
  const rawHtml = fetchResult.bodyText
  const contentHash = sha256(rawHtml)
  const normalizedTableHash = sha256(
    stableStringify({ headers: table.headers, rows: table.bodyRows })
  )
  const warnings = [...table.warnings]
  if (driftEvidence?.drifted) {
    warnings.push(driftEvidence.warning)
  }

  const body = {
    schemaVersion: WEB_SOURCE_ACQUISITION_RECEIPT_SCHEMA,
    acquisitionMode: routeDecision.acquisitionMode,
    sourceUrl: fetchResult.finalUrl,
    retrievalTime: clock().toISOString(),
    adapter: { id: routeDecision.adapterId, version: routeDecision.adapterVersion },
    accessClassification: routeDecision.accessClassification,
    decision: 'EXTRACTED',
    operatorReviewRequired: false,
    decisionReason: routeDecision.decisionReason,
    robotsEvidence: sanitizeRobotsEvidence(robotsEvidence),
    transportEvidence,
    sourceAsOf,
    responseMetadata: {
      httpStatus: fetchResult.httpStatus,
      contentType: fetchResult.contentType,
      bytesRead: fetchResult.bytesRead,
      attempts: fetchResult.attempts,
      redirectChain: fetchResult.redirectChain
    },
    contentHash,
    normalizedTableHash,
    tableIdentity: selectorFingerprint,
    schema: schema.columns,
    rowCount: table.rowCount,
    warnings,
    artifactRef: {
      headers: table.headers,
      rows: table.bodyRows,
      rawHtml: retentionPolicy.allowRawRetention ? rawHtml : null
    },
    createdAt: clock().toISOString()
  }
  return { ...body, receiptHash: sha256(stableStringify(body)) }
}

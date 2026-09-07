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
    // Phase 3 Wave 2: present-but-null on every receipt shape that has
    // nothing to report here, same "always present, honestly null"
    // discipline every other N/A field on this receipt already follows
    // (e.g. tableIdentity/schema/rowCount above).
    contentAccessEvidence: null,
    ownerProvenance: null,
    authEvidence: null,
    createdAt: clock().toISOString()
  }
  return { ...body, receiptHash: sha256(stableStringify(body)) }
}

/**
 * Builds the receipt when routing allowed the adapter to run but retrieval
 * or table discovery itself failed (network/timeout/size/content-type/no
 * tables found) -- distinct from a rights refusal, which never reaches here.
 *
 * `contentAccessEvidence` (Phase 3 Wave 2 / 3E, additive/optional): real
 * post-fetch classification (web-source-content-access-classifier.mjs) of
 * what was actually encountered. Only pass it when a genuine blocking
 * signal fired (`.blocked === true`) -- passing it flips `decision` to
 * `ACCESS_BLOCKED_POST_FETCH` and overrides `accessClassification` with the
 * real detected value, so a caller can tell "really got the source" apart
 * from "got blocked, and here's how" without guessing from free text.
 */
export function buildExtractionFailureReceipt({
  routeDecision,
  failureReason,
  failureDetail,
  robotsEvidence = null,
  transportEvidence = null,
  contentAccessEvidence = null,
  clock = () => new Date()
}) {
  const blocked = contentAccessEvidence?.blocked === true
  const body = {
    schemaVersion: WEB_SOURCE_ACQUISITION_RECEIPT_SCHEMA,
    acquisitionMode: routeDecision.acquisitionMode,
    sourceUrl: routeDecision.sourceCandidate.url,
    retrievalTime: clock().toISOString(),
    adapter: { id: routeDecision.adapterId, version: routeDecision.adapterVersion },
    accessClassification: blocked ? contentAccessEvidence.accessClassification : routeDecision.accessClassification,
    decision: blocked ? 'ACCESS_BLOCKED_POST_FETCH' : 'EXTRACTION_FAILED',
    operatorReviewRequired: blocked,
    decisionReason: blocked ? contentAccessEvidence.decisionReason : `${failureReason}: ${failureDetail ?? ''}`.trim(),
    robotsEvidence: sanitizeRobotsEvidence(robotsEvidence),
    transportEvidence,
    sourceAsOf: null,
    responseMetadata: null,
    contentHash: null,
    normalizedTableHash: null,
    tableIdentity: null,
    schema: null,
    rowCount: null,
    warnings: blocked ? [failureReason, ...contentAccessEvidence.signalsDetected] : [failureReason],
    artifactRef: null,
    contentAccessEvidence,
    ownerProvenance: null,
    authEvidence: null,
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
    contentAccessEvidence: null,
    ownerProvenance: null,
    authEvidence: null,
    createdAt: clock().toISOString()
  }
  return { ...body, receiptHash: sha256(stableStringify(body)) }
}

// ---------------------------------------------------------------------
// Phase 3 Wave 2 (3C): OWNER_SUPPLIED_LOCAL_ARTIFACT. Same WEB_SOURCE_
// ACQUISITION_RECEIPT_V0 shape as every acquisition mode above (never a
// competing receipt schema) -- fields with no web-fetch meaning
// (robotsEvidence/transportEvidence/responseMetadata) stay honestly null.
// `ownerProvenance.independentlyVerified` is hardcoded false, never a
// caller-settable parameter -- structurally impossible to claim
// independent verification from this path, mirroring how
// platform-learning-ledger.mjs's createLessonRecord structurally forbids
// setting its own epistemic-kind field.
// ---------------------------------------------------------------------
function buildOwnerProvenance(ownerAssertion, clock) {
  return {
    schemaVersion: 'OWNER_SUPPLIED_ARTIFACT_PROVENANCE_V1',
    assertedBy: ownerAssertion.assertedBy,
    assertionDescription: ownerAssertion.assertionDescription ?? null,
    assertedAt: clock().toISOString(),
    independentlyVerified: false
  }
}

export function buildOwnerSuppliedArtifactReceipt({ sourceRef, ownerAssertion, rawContent, table, schema, retentionPolicy = { allowRawRetention: false }, clock = () => new Date() }) {
  const contentHash = sha256(rawContent)
  const normalizedTableHash = sha256(stableStringify({ headers: table.headers, rows: table.bodyRows }))
  const body = {
    schemaVersion: WEB_SOURCE_ACQUISITION_RECEIPT_SCHEMA,
    acquisitionMode: 'OWNER_SUPPLIED_LOCAL_ARTIFACT',
    sourceUrl: sourceRef,
    retrievalTime: clock().toISOString(),
    adapter: { id: 'owner-supplied-local-artifact-adapter', version: '0.1.0' },
    accessClassification: 'NOT_APPLICABLE_LOCAL_ARTIFACT',
    decision: 'INGESTED',
    operatorReviewRequired: false,
    decisionReason: 'Owner-supplied local artifact ingested. Provenance is caller-asserted, never independently verified by this path.',
    robotsEvidence: null,
    transportEvidence: null,
    sourceAsOf: null,
    responseMetadata: null,
    contentHash,
    normalizedTableHash,
    tableIdentity: null,
    schema: schema.columns,
    rowCount: table.rowCount,
    warnings: [...table.warnings],
    artifactRef: {
      headers: table.headers,
      rows: table.bodyRows,
      rawContent: retentionPolicy.allowRawRetention ? rawContent : null
    },
    contentAccessEvidence: null,
    ownerProvenance: buildOwnerProvenance(ownerAssertion, clock),
    authEvidence: null,
    createdAt: clock().toISOString()
  }
  return { ...body, receiptHash: sha256(stableStringify(body)) }
}

/**
 * Honest failure receipt for a local artifact that could not be read/
 * parsed at all (missing file, empty content, no table found). Never
 * fabricates a contentHash for content that was never actually read.
 */
export function buildOwnerSuppliedArtifactErrorReceipt({ sourceRef, ownerAssertion, failureReason, failureDetail, clock = () => new Date() }) {
  const body = {
    schemaVersion: WEB_SOURCE_ACQUISITION_RECEIPT_SCHEMA,
    acquisitionMode: 'OWNER_SUPPLIED_LOCAL_ARTIFACT',
    sourceUrl: sourceRef,
    retrievalTime: clock().toISOString(),
    adapter: { id: 'owner-supplied-local-artifact-adapter', version: '0.1.0' },
    accessClassification: 'NOT_APPLICABLE_LOCAL_ARTIFACT',
    decision: 'ACQUISITION_ERROR',
    operatorReviewRequired: true,
    decisionReason: `${failureReason}: ${failureDetail ?? ''}`.trim(),
    robotsEvidence: null,
    transportEvidence: null,
    sourceAsOf: null,
    responseMetadata: null,
    contentHash: null,
    normalizedTableHash: null,
    tableIdentity: null,
    schema: null,
    rowCount: null,
    warnings: [failureReason],
    artifactRef: null,
    contentAccessEvidence: null,
    ownerProvenance: buildOwnerProvenance(ownerAssertion, clock),
    authEvidence: null,
    createdAt: clock().toISOString()
  }
  return { ...body, receiptHash: sha256(stableStringify(body)) }
}

// ---------------------------------------------------------------------
// Phase 3 Wave 2 (3D): AUTHENTICATED_OFFICIAL_DOWNLOAD. `authEvidence`
// carries ONLY mechanism/profileIdRef/authenticatedAt -- see buildAuthEvidence
// below for why nothing else is ever copied off a caller's session object.
// ---------------------------------------------------------------------
function buildAuthEvidence(session) {
  if (!session) {
    return null
  }
  // Deliberately an ALLOWLIST of exactly these three fields -- defense in
  // depth against a caller's real session object carrying an unexpected
  // extra key (e.g. a cookie jar reference) that must never reach a
  // durable receipt, even by accident. See authenticated-official-
  // download-acquisition.mjs's own assertNoSecretLeakage for the
  // complementary input-side guard.
  return {
    schemaVersion: 'AUTHENTICATED_ACQUISITION_EVIDENCE_V1',
    mechanism: session.mechanism ?? null,
    profileIdRef: session.profileId ?? null,
    authenticatedAt: session.authenticatedAt ?? null
  }
}

/**
 * No authorized session was found for this source's origin -- per policy,
 * this path never attempts to obtain one itself (no credential prompt, no
 * bypass). `operatorReviewRequired: true` surfaces that a real, one-time
 * interactive login (completed by the user, in their own browser/session)
 * is needed before this source can be retrieved.
 */
export function buildAuthenticatedDownloadNeedsLoginReceipt({ sourceUrl, origin, clock = () => new Date() }) {
  const body = {
    schemaVersion: WEB_SOURCE_ACQUISITION_RECEIPT_SCHEMA,
    acquisitionMode: 'AUTHENTICATED_OFFICIAL_DOWNLOAD',
    sourceUrl,
    retrievalTime: null,
    adapter: { id: 'authenticated-official-download-adapter', version: '0.1.0' },
    accessClassification: 'AUTHENTICATED_PAGE_NO_EXPORT',
    decision: 'NEEDS_INTERACTIVE_LOGIN',
    operatorReviewRequired: true,
    decisionReason: `No authorized session found for ${origin}. This path never collects, proxies, or infers credentials -- a real login must be completed once by the user in their own browser/session, after which an already-authorized session can be supplied here.`,
    robotsEvidence: null,
    transportEvidence: null,
    sourceAsOf: null,
    responseMetadata: null,
    contentHash: null,
    normalizedTableHash: null,
    tableIdentity: null,
    schema: null,
    rowCount: null,
    warnings: ['NEEDS_INTERACTIVE_LOGIN'],
    artifactRef: null,
    contentAccessEvidence: null,
    ownerProvenance: null,
    authEvidence: null,
    createdAt: clock().toISOString()
  }
  return { ...body, receiptHash: sha256(stableStringify(body)) }
}

export function buildAuthenticatedDownloadFailureReceipt({ sourceUrl, session = null, failureReason, failureDetail, contentAccessEvidence = null, clock = () => new Date() }) {
  const blocked = contentAccessEvidence?.blocked === true
  const body = {
    schemaVersion: WEB_SOURCE_ACQUISITION_RECEIPT_SCHEMA,
    acquisitionMode: 'AUTHENTICATED_OFFICIAL_DOWNLOAD',
    sourceUrl,
    retrievalTime: clock().toISOString(),
    adapter: { id: 'authenticated-official-download-adapter', version: '0.1.0' },
    accessClassification: blocked ? contentAccessEvidence.accessClassification : 'AUTHENTICATED_OFFICIAL_EXPORT',
    decision: blocked ? 'ACCESS_BLOCKED_POST_FETCH' : 'EXTRACTION_FAILED',
    operatorReviewRequired: blocked,
    decisionReason: `${failureReason}: ${failureDetail ?? ''}`.trim(),
    robotsEvidence: null,
    transportEvidence: null,
    sourceAsOf: null,
    responseMetadata: null,
    contentHash: null,
    normalizedTableHash: null,
    tableIdentity: null,
    schema: null,
    rowCount: null,
    warnings: blocked ? [failureReason, ...contentAccessEvidence.signalsDetected] : [failureReason],
    artifactRef: null,
    contentAccessEvidence,
    ownerProvenance: null,
    authEvidence: buildAuthEvidence(session),
    createdAt: clock().toISOString()
  }
  return { ...body, receiptHash: sha256(stableStringify(body)) }
}

/**
 * Successful authenticated retrieval + table extraction. Never embeds the
 * session object itself -- only buildAuthEvidence's non-secret projection.
 */
export function buildAuthenticatedDownloadReceipt({ sourceUrl, session, rawContent, table, schema, retentionPolicy = { allowRawRetention: false }, clock = () => new Date() }) {
  const contentHash = sha256(rawContent)
  const normalizedTableHash = sha256(stableStringify({ headers: table.headers, rows: table.bodyRows }))
  const body = {
    schemaVersion: WEB_SOURCE_ACQUISITION_RECEIPT_SCHEMA,
    acquisitionMode: 'AUTHENTICATED_OFFICIAL_DOWNLOAD',
    sourceUrl,
    retrievalTime: clock().toISOString(),
    adapter: { id: 'authenticated-official-download-adapter', version: '0.1.0' },
    accessClassification: 'AUTHENTICATED_OFFICIAL_EXPORT',
    decision: 'EXTRACTED',
    operatorReviewRequired: false,
    decisionReason: 'Authenticated official export retrieved via an already-authorized session; no credential/token/cookie value ever passed through this code.',
    robotsEvidence: null,
    transportEvidence: null,
    sourceAsOf: null,
    responseMetadata: null,
    contentHash,
    normalizedTableHash,
    tableIdentity: null,
    schema: schema.columns,
    rowCount: table.rowCount,
    warnings: [...table.warnings],
    artifactRef: {
      headers: table.headers,
      rows: table.bodyRows,
      rawContent: retentionPolicy.allowRawRetention ? rawContent : null
    },
    contentAccessEvidence: null,
    ownerProvenance: null,
    authEvidence: buildAuthEvidence(session),
    createdAt: clock().toISOString()
  }
  return { ...body, receiptHash: sha256(stableStringify(body)) }
}

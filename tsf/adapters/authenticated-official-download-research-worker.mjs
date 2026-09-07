// Phase 3 Wave 2 (3D): a real BoundedResearchWorker for AUTHENTICATED_
// OFFICIAL_DOWNLOAD, wired into the SAME real admission path research-
// admission.mjs already uses -- mirrors web-table-research-worker.mjs's
// shape exactly. `sessionProvider`/`downloadFn` are constructor-level
// dependency injection (like acquireFn elsewhere in this codebase): a real
// deployment would inject a bridge over Orca's own authenticated browser-
// session infrastructure and a real authenticated fetch; this V0 is proven
// against fixtures/mocks only (see the final report).
//
// Reads request.authenticatedDownloadCandidates (additive/optional field on
// BoundedResearchRequest), NOT preferredSources -- an authenticated
// download's identity (which session/mechanism authorized it) is not a
// plain fetchable URL concern.
import { acquireAuthenticatedOfficialDownload } from '../domain/authenticated-official-download-acquisition.mjs'
import { extractObservationsFromWebTable, WEB_TABLE_OBSERVATION_EXTRACTION_VERSION } from '../domain/web-table-observation-extraction.mjs'
import { isoNow, sha256 } from '../domain/canonical.mjs'

export const AUTHENTICATED_OFFICIAL_DOWNLOAD_PROVIDER_ID = 'AUTHENTICATED_OFFICIAL_DOWNLOAD'

function fieldNames(request) {
  return Object.keys(request.requestedOutputSchema?.properties ?? {})
}

function buildSourceSnapshot(receipt) {
  return {
    sourceRef: receipt.sourceUrl,
    contentHash: receipt.contentHash,
    acquisitionMethod: 'AUTHENTICATED_OFFICIAL_DOWNLOAD',
    acquisitionMode: receipt.acquisitionMode ?? null,
    accessClassification: receipt.accessClassification ?? null,
    // REQ-003: an authenticated session IS a real, logged origin claim --
    // ASSERTED_LOGGED (stronger than the local-artifact worker's
    // ASSERTED_UNLOGGED), since the session itself was established and
    // recorded by a real authentication mechanism (buildAuthEvidence's
    // mechanism/authenticatedAt), even though this V0 does not
    // independently cross-check the DOWNLOADED CONTENT against a second
    // source (that would be INDEPENDENTLY_VERIFIED, a stronger claim this
    // path never makes).
    provenanceStrength: 'ASSERTED_LOGGED',
    schemaFingerprint: receipt.schema ? sha256(receipt.schema) : null,
    selectorOrAdapterVersion: receipt.adapter?.id && receipt.adapter?.version ? `${receipt.adapter.id}@${receipt.adapter.version}` : null,
    transformationVersion: WEB_TABLE_OBSERVATION_EXTRACTION_VERSION,
    modeEvidence: { ...receipt, artifactRef: receipt.artifactRef ? { ...receipt.artifactRef, rawContent: null } : null }
  }
}

function emptyUsage() {
  return { requestCount: 0, tokensOrUnits: null, providerReportedCostUsd: 0 }
}

function baseResult(request, status) {
  return {
    schemaVersion: 'TSF_BOUNDED_RESEARCH_RESULT_V1',
    nodeId: request.nodeId,
    taskFingerprint: request.taskFingerprint,
    provider: AUTHENTICATED_OFFICIAL_DOWNLOAD_PROVIDER_ID,
    providerRunRef: null,
    status,
    observations: [],
    proposedClaims: [],
    evidence: [],
    sourceReferences: [],
    sourceSnapshotsOrSnapshotRefs: [],
    newGapProposals: [],
    warnings: [],
    unresolvedQuestions: [],
    usage: emptyUsage(),
    failureDetails: null
  }
}

async function attemptOneCandidate(url, request, clock, acquireFn, sessionProvider, downloadFn) {
  const entityHints = [request.targetEntity?.entityId, request.targetEntity?.name].filter(Boolean)
  let receipt
  try {
    ;({ receipt } = await acquireFn({
      candidate: { url },
      sessionProvider,
      downloadFn,
      tableSelectionHint: entityHints.length > 0 ? { preferTableContainingAnyOf: entityHints } : null,
      clock
    }))
  } catch (error) {
    return { receipt: { decision: 'ACQUISITION_ERROR', decisionReason: error.message }, extraction: null }
  }
  if (receipt.decision !== 'EXTRACTED') {
    return { receipt, extraction: null }
  }
  const extraction = extractObservationsFromWebTable(
    { headers: receipt.artifactRef.headers, rows: receipt.artifactRef.rows },
    {
      requestedFieldNames: fieldNames(request),
      targetEntity: request.targetEntity,
      temporalScope: request.temporalRequirements?.periodScope ?? null,
      sourceRef: receipt.sourceUrl,
      publisher: 'authenticated official export',
      retrievedAt: receipt.retrievalTime
    }
  )
  return { receipt, extraction }
}

async function computeResult(request, clock, acquireFn, sessionProvider, downloadFn) {
  const candidates = request.authenticatedDownloadCandidates ?? []
  if (candidates.length === 0) {
    const result = baseResult(request, 'FAILED')
    result.failureDetails = { reason: 'NO_CANDIDATE_SOURCE_CONFIGURED', detail: 'mission specification named no authenticatedDownloadCandidates for this worker to try' }
    return result
  }
  const warnings = []
  const proposedClaims = []
  const evidence = []
  const sourceReferences = []
  const sourceSnapshots = []
  for (const url of candidates) {
    // eslint-disable-next-line no-await-in-loop -- bounded by the mission's own small candidate list, mirrors every other worker in this codebase
    const { receipt, extraction } = await attemptOneCandidate(url, request, clock, acquireFn, sessionProvider, downloadFn)
    if (receipt.decision !== 'EXTRACTED') {
      warnings.push(`${url}: ${receipt.decision} (${receipt.decisionReason ?? 'no reason given'})`)
      continue
    }
    if (!extraction.matched) {
      warnings.push(`${url}: table downloaded but no row matched this entity`)
      continue
    }
    if (extraction.proposedClaims.length === 0) {
      warnings.push(`${url}: entity matched but no requested field matched this export's real headers: [${receipt.artifactRef.headers.join(', ')}]`)
      continue
    }
    proposedClaims.push(...extraction.proposedClaims)
    evidence.push(...extraction.evidence)
    sourceReferences.push(...extraction.sourceReferences)
    sourceSnapshots.push(buildSourceSnapshot(receipt))
  }
  if (proposedClaims.length === 0) {
    const result = baseResult(request, 'FAILED')
    result.warnings = warnings
    result.failureDetails = { reason: 'NO_AUTHENTICATED_DOWNLOAD_MATCH_FOUND', detail: 'no authenticatedDownloadCandidates entry yielded a matching table row for this entity' }
    return result
  }
  const result = baseResult(request, 'SUCCEEDED')
  result.observations = [{ rawContent: { proposedClaims }, extractedAt: isoNow(clock), providerConfidence: null, providerReasoning: null }]
  result.proposedClaims = proposedClaims
  result.evidence = evidence
  result.sourceReferences = sourceReferences
  result.sourceSnapshotsOrSnapshotRefs = sourceSnapshots
  result.warnings = warnings
  result.usage = { requestCount: candidates.length, tokensOrUnits: null, providerReportedCostUsd: 0 }
  return result
}

/**
 * `sessionProvider`/`downloadFn`: real implementations a production
 * deployment would supply (see AUTHENTICATED_SESSION_PROVIDER_CONTRACT_V1);
 * `acquireFn` override is for deterministic tests only.
 */
export function createAuthenticatedOfficialDownloadResearchWorker({
  clock = () => new Date(),
  acquireFn = acquireAuthenticatedOfficialDownload,
  sessionProvider,
  downloadFn
} = {}) {
  async function dispatch(request) {
    const result = await computeResult(request, clock, acquireFn, sessionProvider, downloadFn)
    if (result.status === 'FAILED') {
      const detail = result.warnings.length > 0 ? `${result.failureDetails.detail} -- ${result.warnings.join('; ')}` : result.failureDetails.detail
      return { ok: false, reason: result.failureDetails.reason, detail }
    }
    const dispatchedAt = isoNow(clock)
    const providerRunRef = { provider: AUTHENTICATED_OFFICIAL_DOWNLOAD_PROVIDER_ID, providerRunId: JSON.stringify({ dispatchedAt, result: { ...result, providerRunRef: undefined } }), dispatchedAt }
    return { ok: true, workerRunRef: providerRunRef }
  }

  async function fetchResult(workerRunRef) {
    let parsed
    try {
      parsed = JSON.parse(workerRunRef.providerRunId)
    } catch (error) {
      return { ok: false, reason: 'MALFORMED_RUN_REF', detail: error.message }
    }
    return { ok: true, status: 'READY', result: { ...parsed.result, providerRunRef: workerRunRef } }
  }

  return { provider: AUTHENTICATED_OFFICIAL_DOWNLOAD_PROVIDER_ID, dispatch, fetchResult }
}

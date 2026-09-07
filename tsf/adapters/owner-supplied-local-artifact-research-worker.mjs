// Phase 3 Wave 2 (3C): a real BoundedResearchWorker for OWNER_SUPPLIED_
// LOCAL_ARTIFACT, wired into the SAME real admission path research-
// admission.mjs already uses (dispatch/fetchResult -> BoundedResearchResult
// -> admitBoundedResearchResult) -- mirrors web-table-research-worker.mjs's
// shape exactly, never a parallel local-file research system. Reads
// request.localArtifactCandidates (additive/optional field on
// BoundedResearchRequest -- see contracts/bounded-research-worker-protocol.
// schema.v1.json), NOT preferredSources: a local file path has no web-
// rights/robots concept, so overloading preferredSources' URL semantics
// would misrepresent it as a fetchable web source.
//
// Deliberately simpler than web-table-research-worker.mjs's resolveFields:
// exact-header-match only, no bounded-semantic-reconciliation LLM fallback
// -- a disclosed V0 simplification (owner-supplied artifacts are typically
// already curated by the caller who knows its real headers), not an
// oversight.
import { acquireOwnerSuppliedLocalArtifact } from '../domain/owner-supplied-local-artifact-acquisition.mjs'
import { extractObservationsFromWebTable, WEB_TABLE_OBSERVATION_EXTRACTION_VERSION } from '../domain/web-table-observation-extraction.mjs'
import { isoNow, sha256 } from '../domain/canonical.mjs'

export const OWNER_SUPPLIED_LOCAL_ARTIFACT_PROVIDER_ID = 'OWNER_SUPPLIED_LOCAL_ARTIFACT_INGESTION'

function fieldNames(request) {
  return Object.keys(request.requestedOutputSchema?.properties ?? {})
}

// Phase 3 Wave 2 (3F): schemaFingerprint/selectorOrAdapterVersion/
// transformationVersion promoted to top-level SourceSnapshotReference
// fields exactly like web-table-research-worker.mjs's own buildSourceSnapshot
// (REUSE_PATTERN) -- provenanceStrength is ASSERTED_UNLOGGED (not NONE: a
// real origin claim exists via ownerAssertion; not ASSERTED_LOGGED/
// INDEPENDENTLY_VERIFIED: nothing here logs or cross-checks it against an
// intake process) -- research-admission.mjs's REQ-003 chain-of-custody
// wiring (Wave 1) reads this honestly, unmodified.
function buildSourceSnapshot(receipt) {
  return {
    sourceRef: receipt.sourceUrl,
    contentHash: receipt.contentHash,
    acquisitionMethod: 'OWNER_SUPPLIED_LOCAL_ARTIFACT_INGESTION',
    acquisitionMode: receipt.acquisitionMode ?? null,
    accessClassification: receipt.accessClassification ?? null,
    provenanceStrength: 'ASSERTED_UNLOGGED',
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
    provider: OWNER_SUPPLIED_LOCAL_ARTIFACT_PROVIDER_ID,
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

async function attemptOneCandidate(localArtifact, request, clock, acquireFn) {
  const entityHints = [request.targetEntity?.entityId, request.targetEntity?.name].filter(Boolean)
  let receipt, selection
  try {
    ;({ receipt, selection } = await acquireFn({
      filePath: localArtifact.filePath,
      content: localArtifact.content,
      ownerAssertion: localArtifact.ownerAssertion,
      tableSelectionHint: entityHints.length > 0 ? { preferTableContainingAnyOf: entityHints } : null,
      clock
    }))
  } catch (error) {
    return { receipt: { decision: 'ACQUISITION_ERROR', decisionReason: error.message }, extraction: null, selection: null }
  }
  if (receipt.decision !== 'INGESTED') {
    return { receipt, extraction: null, selection }
  }
  const extraction = extractObservationsFromWebTable(
    { headers: receipt.artifactRef.headers, rows: receipt.artifactRef.rows },
    {
      requestedFieldNames: fieldNames(request),
      targetEntity: request.targetEntity,
      temporalScope: request.temporalRequirements?.periodScope ?? null,
      sourceRef: receipt.sourceUrl,
      publisher: `owner-supplied (${localArtifact.ownerAssertion?.assertedBy ?? 'unknown'})`,
      retrievedAt: receipt.retrievalTime
    }
  )
  return { receipt, extraction, selection }
}

async function computeResult(request, clock, acquireFn) {
  const candidates = request.localArtifactCandidates ?? []
  if (candidates.length === 0) {
    const result = baseResult(request, 'FAILED')
    result.failureDetails = { reason: 'NO_CANDIDATE_SOURCE_CONFIGURED', detail: 'mission specification named no localArtifactCandidates for this worker to try' }
    return result
  }
  const warnings = []
  const proposedClaims = []
  const evidence = []
  const sourceReferences = []
  const sourceSnapshots = []
  for (const localArtifact of candidates) {
    // eslint-disable-next-line no-await-in-loop -- bounded by the mission's own small localArtifactCandidates list, mirrors web-table-research-worker.mjs's identical loop
    const { receipt, extraction } = await attemptOneCandidate(localArtifact, request, clock, acquireFn)
    const label = receipt.sourceUrl ?? localArtifact.filePath ?? '(inline content)'
    if (receipt.decision !== 'INGESTED') {
      warnings.push(`${label}: ${receipt.decision} (${receipt.decisionReason ?? 'no reason given'})`)
      continue
    }
    if (!extraction.matched) {
      warnings.push(`${label}: table ingested but no row matched this entity`)
      continue
    }
    if (extraction.proposedClaims.length === 0) {
      warnings.push(`${label}: entity matched but no requested field matched this artifact's real headers: [${receipt.artifactRef.headers.join(', ')}]`)
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
    result.failureDetails = { reason: 'NO_LOCAL_ARTIFACT_MATCH_FOUND', detail: 'no localArtifactCandidates entry yielded a matching table row for this entity' }
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
 * `acquireFn` override is for deterministic tests only, same convention as
 * every other worker in this codebase; defaults to the real acquisition
 * function (a real local filesystem read, still $0, still no network).
 */
export function createOwnerSuppliedLocalArtifactResearchWorker({ clock = () => new Date(), acquireFn = acquireOwnerSuppliedLocalArtifact } = {}) {
  async function dispatch(request) {
    const result = await computeResult(request, clock, acquireFn)
    if (result.status === 'FAILED') {
      const detail = result.warnings.length > 0 ? `${result.failureDetails.detail} -- ${result.warnings.join('; ')}` : result.failureDetails.detail
      return { ok: false, reason: result.failureDetails.reason, detail }
    }
    const dispatchedAt = isoNow(clock)
    const providerRunRef = { provider: OWNER_SUPPLIED_LOCAL_ARTIFACT_PROVIDER_ID, providerRunId: JSON.stringify({ dispatchedAt, result: { ...result, providerRunRef: undefined } }), dispatchedAt }
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

  return { provider: OWNER_SUPPLIED_LOCAL_ARTIFACT_PROVIDER_ID, dispatch, fetchResult }
}

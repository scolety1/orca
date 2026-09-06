// A real, $0, free-public BoundedResearchWorker: tries each of the
// mission's own declared preferredSources (never a hardcoded/topic-
// specific URL) via the ported web-table acquisition stack, admits real
// evidence from every source that matches this node's entity, and
// honestly reports FAILED (typed missingness, handled by the existing
// retry/escalate machinery -- no new mechanism) when none do.
//
// dispatch() does the entire fetch+extract synchronously -- there is no
// real async remote job to poll. Restart-safety without any in-memory
// cache or schema change: `providerRunId` is documented as an opaque
// string, so the fully-computed BoundedResearchResult is serialized into
// it directly. workerRunRef (which durably persists this) already exists
// for every real provider; fetchResult here is a pure read of what
// dispatch already computed and TSF already persisted -- a genuine
// process restart between dispatch and the next poll cycle loses nothing.
import { acquirePublicWebTableSource } from '../domain/public-web-source-acquisition.mjs'
import { extractObservationsFromWebTable } from '../domain/web-table-observation-extraction.mjs'
import { isoNow } from '../domain/canonical.mjs'

export const WEB_TABLE_PROVIDER_ID = 'WEB_TABLE_STATIC_EXTRACTION'

// This worker's own declared operating policy (never inferred per
// request): attempt PUBLIC_WEB_SOURCE_EXTRACTION only. The real,
// non-bypassable safety gate is acquirePublicWebTableSource's mandatory
// live robots.txt preflight (overrides this regardless) plus its SSRF/
// DNS-pinning transport -- this flag only affirms that TSF permits this
// worker to attempt that mode at all, never a per-URL rights judgment.
const ACCESS_INPUT = Object.freeze({
  explicitPublicAllowance: true,
  authenticationRequired: false,
  officialExportAvailable: false,
  paywallDetected: false,
  termsBlocked: false
})

function fieldNames(request) {
  return Object.keys(request.requestedOutputSchema?.properties ?? {})
}

function emptyUsage() {
  return { requestCount: 0, tokensOrUnits: null, providerReportedCostUsd: 0 }
}

function baseResult(request, status) {
  return {
    schemaVersion: 'TSF_BOUNDED_RESEARCH_RESULT_V1',
    nodeId: request.nodeId,
    taskFingerprint: request.taskFingerprint,
    provider: WEB_TABLE_PROVIDER_ID,
    providerRunRef: null, // filled in by the caller once the runRef id is known
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

async function attemptOneCandidate(url, request, clock, acquireFn) {
  const { receipt } = await acquireFn({
    candidate: { url, contentTypeHint: null },
    accessInput: ACCESS_INPUT,
    tableSelectionHint: null,
    clock
  })
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
      publisher: null,
      retrievedAt: receipt.retrievalTime
    }
  )
  return { receipt, extraction }
}

async function computeResult(request, clock, acquireFn) {
  if (!request.preferredSources || request.preferredSources.length === 0) {
    const result = baseResult(request, 'FAILED')
    result.failureDetails = { reason: 'NO_CANDIDATE_SOURCE_CONFIGURED', detail: 'mission specification named no preferredSources for this worker to try' }
    return result
  }
  const warnings = []
  const proposedClaims = []
  const evidence = []
  const sourceReferences = []
  for (const url of request.preferredSources) {
    // eslint-disable-next-line no-await-in-loop -- bounded by the mission's own small preferredSources list; per-domain throttle already applies inside bounded-http-fetch
    const { receipt, extraction } = await attemptOneCandidate(url, request, clock, acquireFn)
    if (receipt.decision !== 'EXTRACTED') {
      warnings.push(`${url}: ${receipt.decision} (${receipt.decisionReason ?? 'no reason given'})`)
      continue
    }
    if (!extraction.matched) {
      warnings.push(`${url}: table extracted but no row matched this entity`)
      continue
    }
    proposedClaims.push(...extraction.proposedClaims)
    evidence.push(...extraction.evidence)
    sourceReferences.push(...extraction.sourceReferences)
  }
  if (proposedClaims.length === 0) {
    const result = baseResult(request, 'FAILED')
    result.warnings = warnings
    result.failureDetails = { reason: 'NO_FREE_PUBLIC_MATCH_FOUND', detail: 'no preferredSources URL yielded a matching table row for this entity' }
    return result
  }
  const result = baseResult(request, 'SUCCEEDED')
  result.observations = [{ rawContent: { proposedClaims }, extractedAt: isoNow(clock), providerConfidence: null, providerReasoning: null }]
  result.proposedClaims = proposedClaims
  result.evidence = evidence
  result.sourceReferences = sourceReferences
  result.warnings = warnings
  result.usage = { requestCount: request.preferredSources.length, tokensOrUnits: null, providerReportedCostUsd: 0 }
  return result
}

// `acquireFn` defaults to the real, safe-by-default production entrypoint
// (mandatory live robots preflight + DNS-pinned transport) -- overriding
// it is for deterministic tests only (mirrors createExaResearchWorker's
// own injected `transport`), never wired to anything else in production.
export function createWebTableResearchWorker({ clock = () => new Date(), acquireFn = acquirePublicWebTableSource } = {}) {
  async function dispatch(request) {
    const result = await computeResult(request, clock, acquireFn)
    const dispatchedAt = isoNow(clock)
    const providerRunRef = { provider: WEB_TABLE_PROVIDER_ID, providerRunId: JSON.stringify({ dispatchedAt, result: { ...result, providerRunRef: undefined } }), dispatchedAt }
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

  return { provider: WEB_TABLE_PROVIDER_ID, dispatch, fetchResult }
}

// Real, $0, free-public BoundedResearchWorker: tries each mission-declared
// preferredSource via the ported web-table acquisition stack. dispatch()
// fetches+extracts synchronously (no real async job); restart-safety comes
// from serializing the full BoundedResearchResult into providerRunId
// (documented opaque string) so fetchResult is a pure re-read.
import { acquirePublicWebTableSource } from '../domain/public-web-source-acquisition.mjs'
import { extractObservationsFromWebTable } from '../domain/web-table-observation-extraction.mjs'
import { reconcileFieldsToHeaders } from '../server/field-source-reconciliation.mjs'
import { isoNow } from '../domain/canonical.mjs'

export const WEB_TABLE_PROVIDER_ID = 'WEB_TABLE_STATIC_EXTRACTION'

// Declares only that PUBLIC_WEB_SOURCE_EXTRACTION is attempted at all --
// the real rights gate is acquirePublicWebTableSource's mandatory robots
// preflight + SSRF/DNS-pinning transport, unaffected by this flag. KNOWN
// GAP: paywallDetected/authenticationRequired are hardcoded false because
// no real detection exists anywhere in the ported stack -- a paywalled
// page that still returns 200/HTML is not currently caught here.
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

// Two-pass field resolution: exact header match first (pure, 100% safe);
// anything left unresolved goes through bounded semantic reconciliation
// (server/field-source-reconciliation.mjs, a real LLM call gated to only
// ever SELECT among the real headers) before a second, final extraction.
async function resolveFields(receipt, request) {
  const table = { headers: receipt.artifactRef.headers, rows: receipt.artifactRef.rows }
  const extractionArgs = {
    requestedFieldNames: fieldNames(request),
    targetEntity: request.targetEntity,
    temporalScope: request.temporalRequirements?.periodScope ?? null,
    sourceRef: receipt.sourceUrl,
    publisher: null,
    retrievedAt: receipt.retrievalTime
  }
  const firstPass = extractObservationsFromWebTable(table, extractionArgs)
  if (!firstPass.matched || firstPass.unresolvedFieldNames.length === 0) {
    return firstPass
  }
  const bindings = await reconcileFieldsToHeaders({
    headers: table.headers,
    unresolvedFieldNames: firstPass.unresolvedFieldNames,
    sourceIdentity: receipt.sourceUrl
  })
  if (bindings.length === 0) {
    return firstPass
  }
  return extractObservationsFromWebTable(table, { ...extractionArgs, additionalBindings: bindings })
}

async function attemptOneCandidate(url, request, clock, acquireFn) {
  // Generic entity hint (never a hardcoded topic keyword) so a page with
  // many tables (e.g. Wikipedia) picks the one matching this entity.
  const entityHints = [request.targetEntity?.entityId, request.targetEntity?.name].filter(Boolean)
  // Any uncaught throw (e.g. new URL() on a malformed URL) must degrade to
  // a skipped candidate, never escape dispatch() and wedge retry.
  let receipt
  try {
    ;({ receipt } = await acquireFn({
      candidate: { url, contentTypeHint: null },
      accessInput: ACCESS_INPUT,
      tableSelectionHint: entityHints.length > 0 ? { preferTableContainingAnyOf: entityHints } : null,
      clock
    }))
  } catch (error) {
    return { receipt: { decision: 'ACQUISITION_ERROR', decisionReason: error.message }, extraction: null }
  }
  if (receipt.decision !== 'EXTRACTED') {
    return { receipt, extraction: null }
  }
  try {
    const extraction = await resolveFields(receipt, request)
    return { receipt, extraction }
  } catch (error) {
    return { receipt: { decision: 'ACQUISITION_ERROR', decisionReason: error.message }, extraction: null }
  }
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
    if (extraction.proposedClaims.length === 0) {
      warnings.push(`${url}: entity matched but no requested field matched this page's real headers: [${receipt.artifactRef.headers.join(', ')}]`)
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

// `acquireFn` override is for deterministic tests only (mirrors
// createExaResearchWorker's injected `transport`); defaults to the real,
// safe-by-default production entrypoint.
export function createWebTableResearchWorker({ clock = () => new Date(), acquireFn = acquirePublicWebTableSource } = {}) {
  async function dispatch(request) {
    const result = await computeResult(request, clock, acquireFn)
    // {ok:true} embedding a FAILED result classifies EXACTLY_ONCE in
    // dispatch-bookkeeping, permanently blocking retry for this synchronous
    // $0 worker (no external job to re-poll) -- {ok:false} classifies
    // AT_MOST_ONCE, correctly permitting the existing retry/escalate path.
    if (result.status === 'FAILED') {
      const detail = result.warnings.length > 0 ? `${result.failureDetails.detail} -- ${result.warnings.join('; ')}` : result.failureDetails.detail
      return { ok: false, reason: result.failureDetails.reason, detail }
    }
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

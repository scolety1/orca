// Exa Agent API adapter behind the same provider-independent
// BoundedResearchRequest -> BoundedResearchWorker -> BoundedResearchResult
// seam as parallel-research-worker.mjs. NO HTTP CLIENT IS WIRED HERE --
// `transport` is injected ({createAgentRun, getAgentRun}); every test
// injects a deterministic synthetic transport.
//
// Shape is informed by Exa's documented Agent API (outputSchema-constrained
// JSON, field-level grounding/sources, async run id) as researched during
// the TSF adoption audit -- NOT verified against a live call. A confirmed,
// disclosed gap from that audit: Exa's documented response has NO native
// per-field confidence score, unlike Parallel's Basis -- this adapter
// always reports providerConfidence: null for Exa results, honestly,
// rather than inventing one.
import { isoNow } from '../domain/canonical.mjs'

export const EXA_PROVIDER_ID = 'EXA'

function buildAgentSpec(request) {
  return {
    query: request.researchQuestion,
    outputSchema: request.requestedOutputSchema,
    metadata: {
      node_id: request.nodeId,
      task_fingerprint: request.taskFingerprint,
      temporal_scope: request.temporalRequirements.periodScope,
      as_of_date: request.temporalRequirements.asOfDate,
      preferred_sources: request.preferredSources,
      disallowed_sources: request.disallowedSources
    }
  }
}

function fieldNames(request) {
  return Object.keys(request.requestedOutputSchema?.properties ?? {})
}

function parseCompletedRun(request, run) {
  const output = run.output
  if (!output || typeof output.structured !== 'object' || output.structured === null) {
    return failedResult(request, run, 'MALFORMED_PROVIDER_RESPONSE', 'Exa run reported completed but output.structured is missing/malformed.')
  }
  const groundingByField = new Map((output.grounding ?? []).map((g) => [g.field, g]))
  const proposedClaims = []
  const evidence = []
  const sourceReferences = []
  const seenSourceRefs = new Set()
  for (const fieldName of fieldNames(request)) {
    const value = fieldName in output.structured ? output.structured[fieldName] : null
    const grounding = groundingByField.get(fieldName)
    proposedClaims.push({
      fieldName,
      proposedValue: value === undefined ? null : value,
      temporalScope: request.temporalRequirements.periodScope,
      // Exa's documented response carries no confidence field -- honestly
      // null, never a fabricated stand-in.
      providerConfidence: null,
      providerReasoning: value == null ? 'field absent from provider response' : null
    })
    for (const source of grounding?.sources ?? []) {
      const sourceRef = source.url
      if (!seenSourceRefs.has(sourceRef)) {
        sourceReferences.push({ sourceRef, url: source.url, publisher: source.publisher ?? null, retrievedAt: run.completed_at ?? isoNow() })
        seenSourceRefs.add(sourceRef)
      }
      evidence.push({ claimFieldName: fieldName, sourceRef, snippet: source.snippet ?? '', supportsClaim: true })
    }
  }
  return {
    schemaVersion: 'TSF_BOUNDED_RESEARCH_RESULT_V1',
    nodeId: request.nodeId,
    taskFingerprint: request.taskFingerprint,
    provider: EXA_PROVIDER_ID,
    providerRunRef: { provider: EXA_PROVIDER_ID, providerRunId: run.id, dispatchedAt: run.dispatchedAt ?? isoNow() },
    status: 'SUCCEEDED',
    observations: [{ rawContent: output, extractedAt: run.completed_at ?? isoNow(), providerConfidence: null, providerReasoning: null }],
    proposedClaims,
    evidence,
    sourceReferences,
    sourceSnapshotsOrSnapshotRefs: [],
    newGapProposals: [],
    warnings: [],
    unresolvedQuestions: [],
    usage: {
      requestCount: run.usage?.requests ?? null,
      tokensOrUnits: run.usage?.units ?? null,
      // A real Exa Agent run has a real, non-zero cost
      // ($/Agent-Compute-Unit + per-search/field). Unknown stays unknown.
      providerReportedCostUsd: run.usage?.cost_usd ?? null
    },
    failureDetails: null
  }
}

function failedResult(request, run, reason, detail) {
  return {
    schemaVersion: 'TSF_BOUNDED_RESEARCH_RESULT_V1',
    nodeId: request.nodeId,
    taskFingerprint: request.taskFingerprint,
    provider: EXA_PROVIDER_ID,
    providerRunRef: { provider: EXA_PROVIDER_ID, providerRunId: run?.id ?? 'unknown', dispatchedAt: run?.dispatchedAt ?? isoNow() },
    status: 'FAILED',
    observations: [],
    proposedClaims: [],
    evidence: [],
    sourceReferences: [],
    sourceSnapshotsOrSnapshotRefs: [],
    newGapProposals: [],
    warnings: [],
    unresolvedQuestions: [],
    usage: { requestCount: null, tokensOrUnits: null, providerReportedCostUsd: null },
    failureDetails: { reason, detail: detail ?? null }
  }
}

export function createExaResearchWorker({ transport, clock }) {
  if (typeof transport?.createAgentRun !== 'function' || typeof transport?.getAgentRun !== 'function') {
    throw new Error('Exa worker requires an injected transport exposing createAgentRun/getAgentRun -- no default HTTP transport exists in this codebase')
  }
  const dispatchedByRunId = new Map()

  async function dispatch(request) {
    let created
    try {
      created = await transport.createAgentRun(buildAgentSpec(request))
    } catch (error) {
      return { ok: false, reason: 'EXA_CREATE_RUN_ERROR', detail: error.message }
    }
    if (!created?.id) {
      return { ok: false, reason: 'MALFORMED_PROVIDER_RESPONSE', detail: 'createAgentRun did not return an id' }
    }
    const dispatchedAt = isoNow(clock)
    dispatchedByRunId.set(created.id, { request, dispatchedAt })
    return { ok: true, workerRunRef: { provider: EXA_PROVIDER_ID, providerRunId: created.id, dispatchedAt } }
  }

  async function fetchResult(workerRunRef) {
    const dispatched = dispatchedByRunId.get(workerRunRef.providerRunId)
    if (!dispatched) return { ok: false, reason: 'UNKNOWN_RUN_REF', detail: workerRunRef.providerRunId }
    const { request, dispatchedAt } = dispatched
    let run
    try {
      run = await transport.getAgentRun(workerRunRef.providerRunId)
    } catch (error) {
      return { ok: false, reason: 'EXA_GET_RUN_ERROR', detail: error.message }
    }
    if (!run) return { ok: false, reason: 'UNKNOWN_RUN_REF', detail: workerRunRef.providerRunId }
    run.dispatchedAt = dispatchedAt
    if (run.status === 'pending') {
      return { ok: true, status: 'PENDING' }
    }
    if (run.status === 'failed') {
      return { ok: true, status: 'READY', result: failedResult(request, run, 'PROVIDER_REPORTED_FAILURE', run.error?.message) }
    }
    if (run.status !== 'completed') {
      return { ok: true, status: 'READY', result: failedResult(request, run, 'MALFORMED_PROVIDER_RESPONSE', `unrecognized status: ${run.status}`) }
    }
    return { ok: true, status: 'READY', result: parseCompletedRun(request, run) }
  }

  return { provider: EXA_PROVIDER_ID, dispatch, fetchResult }
}

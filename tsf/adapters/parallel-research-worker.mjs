// Parallel Task API adapter behind the provider-independent
// BoundedResearchRequest -> BoundedResearchWorker -> BoundedResearchResult
// seam. NO HTTP CLIENT IS WIRED HERE -- `transport` is injected
// ({createTaskRun, getTaskRun}), exactly the way this codebase already
// injects external effects (e.g. provider-forecast.mjs's pricingAdapter).
// A caller supplying a real HTTP-backed transport is future, out-of-scope
// work; every test in this repo injects a deterministic synthetic
// transport, so this module cannot make a network call as constructed.
//
// Shape is informed by Parallel's documented Task API (JSON-schema output,
// per-field "Basis" citations/reasoning/confidence, async run id) as
// researched during the TSF adoption audit -- NOT verified against a live
// call in this environment. Treat exact synthetic field names as
// best-effort until validated against a real, current API response.
import { isoNow } from '../domain/canonical.mjs'

export const PARALLEL_PROVIDER_ID = 'PARALLEL'

function buildTaskSpec(request) {
  return {
    input: request.researchQuestion,
    processor: 'base',
    task_spec: {
      output_schema: { type: 'json', json_schema: request.requestedOutputSchema }
    },
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

// Normalizes one Parallel task-run's terminal payload into a
// BoundedResearchResult. Never throws on a malformed/incomplete provider
// payload -- an unexpected shape becomes an honest FAILED result with
// failureDetails, matching this codebase's adapter envelope discipline
// ("never silently treated as clean").
function parseCompletedRun(request, run) {
  const output = run.output
  if (!output || typeof output.content !== 'object' || output.content === null) {
    return failedResult(request, run, 'MALFORMED_PROVIDER_RESPONSE', 'Parallel run reported completed but output.content is missing/malformed.')
  }
  const basisByField = new Map((output.basis ?? []).map((b) => [b.field, b]))
  const proposedClaims = []
  const evidence = []
  const sourceReferences = []
  const seenSourceRefs = new Set()
  for (const fieldName of fieldNames(request)) {
    const value = fieldName in output.content ? output.content[fieldName] : null
    const basis = basisByField.get(fieldName)
    proposedClaims.push({
      fieldName,
      // Missing from the provider's own response is admitted as an honest
      // null (missingness signal) -- never fabricated.
      proposedValue: value === undefined ? null : value,
      temporalScope: request.temporalRequirements.periodScope,
      providerConfidence: basis?.confidence ?? null,
      providerReasoning: basis?.reasoning ?? (value == null ? 'field absent from provider response' : null)
    })
    for (const citation of basis?.citations ?? []) {
      const sourceRef = citation.url
      if (!seenSourceRefs.has(sourceRef)) {
        sourceReferences.push({ sourceRef, url: citation.url, publisher: citation.publisher ?? null, retrievedAt: run.completed_at ?? isoNow() })
        seenSourceRefs.add(sourceRef)
      }
      evidence.push({ claimFieldName: fieldName, sourceRef, snippet: citation.excerpt ?? '', supportsClaim: true })
    }
  }
  return {
    schemaVersion: 'TSF_BOUNDED_RESEARCH_RESULT_V1',
    nodeId: request.nodeId,
    taskFingerprint: request.taskFingerprint,
    provider: PARALLEL_PROVIDER_ID,
    providerRunRef: { provider: PARALLEL_PROVIDER_ID, providerRunId: run.run_id, dispatchedAt: run.dispatchedAt ?? isoNow() },
    status: 'SUCCEEDED',
    observations: [{ rawContent: output, extractedAt: run.completed_at ?? isoNow(), providerConfidence: null, providerReasoning: null }],
    proposedClaims,
    evidence,
    sourceReferences,
    // Parallel's real API can return page-level snapshot/content refs;
    // no synthetic snapshot data is modeled here yet (deferred, not
    // fabricated) -- an empty array is honest, not a gap disguised as data.
    sourceSnapshotsOrSnapshotRefs: [],
    newGapProposals: [],
    warnings: [],
    unresolvedQuestions: [],
    usage: {
      requestCount: run.usage?.num_requests ?? null,
      tokensOrUnits: run.usage?.tokens ?? null,
      // A real Parallel call has a real, non-zero cost. Unknown here means
      // unknown -- never coerced to $0 the way a genuinely-free fake-worker
      // run legitimately is.
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
    provider: PARALLEL_PROVIDER_ID,
    providerRunRef: { provider: PARALLEL_PROVIDER_ID, providerRunId: run?.run_id ?? 'unknown', dispatchedAt: run?.dispatchedAt ?? isoNow() },
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

export function createParallelResearchWorker({ transport, clock }) {
  if (typeof transport?.createTaskRun !== 'function' || typeof transport?.getTaskRun !== 'function') {
    throw new Error('Parallel worker requires an injected transport exposing createTaskRun/getTaskRun -- no default HTTP transport exists in this codebase')
  }
  // fetchResult's protocol signature is (workerRunRef) only -- the original
  // BoundedResearchRequest (needed to know which fields were asked for) is
  // stashed here at dispatch time, keyed by the provider's own run id.
  const dispatchedByRunId = new Map()

  async function dispatch(request) {
    let created
    try {
      created = await transport.createTaskRun(buildTaskSpec(request))
    } catch (error) {
      return { ok: false, reason: 'PARALLEL_CREATE_RUN_ERROR', detail: error.message }
    }
    if (!created?.run_id) {
      return { ok: false, reason: 'MALFORMED_PROVIDER_RESPONSE', detail: 'createTaskRun did not return a run_id' }
    }
    const dispatchedAt = isoNow(clock)
    dispatchedByRunId.set(created.run_id, { request, dispatchedAt })
    return { ok: true, workerRunRef: { provider: PARALLEL_PROVIDER_ID, providerRunId: created.run_id, dispatchedAt } }
  }

  async function fetchResult(workerRunRef) {
    const dispatched = dispatchedByRunId.get(workerRunRef.providerRunId)
    if (!dispatched) return { ok: false, reason: 'UNKNOWN_RUN_REF', detail: workerRunRef.providerRunId }
    const { request, dispatchedAt } = dispatched
    let run
    try {
      run = await transport.getTaskRun(workerRunRef.providerRunId)
    } catch (error) {
      return { ok: false, reason: 'PARALLEL_GET_RUN_ERROR', detail: error.message }
    }
    if (!run) return { ok: false, reason: 'UNKNOWN_RUN_REF', detail: workerRunRef.providerRunId }
    run.dispatchedAt = dispatchedAt
    if (run.status === 'queued' || run.status === 'running') {
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

  return { provider: PARALLEL_PROVIDER_ID, dispatch, fetchResult }
}

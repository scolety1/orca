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

// HQ's governed bake-off policy fixes the processor at 'core' -- chosen
// because its published output basis includes citations/reasoning/
// excerpts/confidence. There is no code path in this adapter that reads a
// different processor from anywhere; auto-escalating to core2x/pro/ultra*
// is explicitly forbidden. (Corrected during live-doc revalidation: an
// earlier build of this adapter hardcoded the unrelated 'base' processor,
// never 'core' at all.)
const PARALLEL_PROCESSOR = 'core'

// Live-bake-off finding (2026-09-03): Parallel's documented `metadata`
// field only accepts scalar (string|integer|number|boolean) values, max
// 16 chars per key -- an earlier build of this adapter stuffed the
// preferredSources/disallowedSources ARRAYS into metadata, which Parallel
// rejected with a 422. Domain filtering has its own real top-level
// request field, `source_policy.{include_domains,exclude_domains}` --
// moved there, which is also the semantically correct place for it.
function buildTaskSpec(request) {
  const spec = {
    input: request.researchQuestion,
    processor: PARALLEL_PROCESSOR,
    task_spec: {
      output_schema: { type: 'json', json_schema: request.requestedOutputSchema }
    },
    metadata: {
      node_id: request.nodeId,
      task_fingerprint: request.taskFingerprint,
      temporal_scope: request.temporalRequirements.periodScope,
      as_of_date: request.temporalRequirements.asOfDate
    }
  }
  if (request.preferredSources.length > 0 || request.disallowedSources.length > 0) {
    spec.source_policy = {
      include_domains: request.preferredSources,
      exclude_domains: request.disallowedSources
    }
  }
  return spec
}

function fieldNames(request) {
  return Object.keys(request.requestedOutputSchema?.properties ?? {})
}

// Live-doc revalidation (2026-09-03, docs.parallel.ai/api-reference/tasks
// /retrieve-task-run-result): basis[].confidence is a coarse three-level
// string enum ('low'|'medium'|'high'|null), NOT a 0-1 float as the
// synthetic Wave 4 adapter assumed -- corrected here. The mapping below is
// an approximate, disclosed categorical->numeric conversion (not a real
// probability); TSF-side consumers should treat it as coarse-grained.
const CONFIDENCE_LEVEL_TO_NUMBER = { low: 0.25, medium: 0.6, high: 0.9 }
function normalizeParallelConfidence(level) {
  return CONFIDENCE_LEVEL_TO_NUMBER[level] ?? null
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
      providerConfidence: normalizeParallelConfidence(basis?.confidence),
      providerReasoning: basis?.reasoning ?? (value == null ? 'field absent from provider response' : null)
    })
    for (const citation of basis?.citations ?? []) {
      const sourceRef = citation.url
      if (!seenSourceRefs.has(sourceRef)) {
        // Citation has no `publisher` field in the real API -- `title` is
        // the closest available descriptive text, disclosed as such.
        sourceReferences.push({ sourceRef, url: citation.url, publisher: citation.title ?? null, retrievedAt: run.completed_at ?? isoNow() })
        seenSourceRefs.add(sourceRef)
      }
      // excerpts is an array of strings in the real API (not a single
      // `excerpt`) -- joined for the flat snippet field.
      evidence.push({ claimFieldName: fieldName, sourceRef, snippet: (citation.excerpts ?? []).join(' ... '), supportsClaim: true })
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

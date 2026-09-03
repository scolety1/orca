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

// Live-doc revalidation (2026-09-03, exa.ai/docs/reference/agent-api-guide)
// confirmed the real request/response field names below. effort is fixed
// at 'medium' -- HQ's governed bake-off policy explicitly forbids
// auto-escalating to high/xhigh/auto/max for this wave; there is no code
// path in this adapter that reads a different effort level from anywhere.
// budget.maxCostDollars is wired through as a provider-side hard cost cap,
// defense-in-depth alongside TSF's own research-cost-governance.mjs gate.
const EXA_EFFORT = 'medium'

// Live-bake-off finding (2026-09-03): Exa's Agent run schema has no
// documented `metadata` field at all -- an earlier build of this adapter
// included one (with the same array-valued preferredSources/
// disallowedSources problem as the Parallel adapter had), and Exa
// rejected the whole request with a 400 ("does not match Agent run
// schema"). No node_id/taskFingerprint tracking field exists on the real
// request schema; TSF-side dispatch bookkeeping already covers that
// (dispatchedByRunId below), so nothing is lost by dropping it. Source
// preference has no documented structured include/exclude field either --
// `systemPrompt` is the real, documented field for exactly this kind of
// steering guidance, used here rather than a fabricated request field.
function buildAgentSpec(request) {
  const spec = {
    query: request.researchQuestion,
    effort: EXA_EFFORT,
    outputSchema: request.requestedOutputSchema
  }
  const sourceGuidance = []
  if (request.preferredSources.length > 0) sourceGuidance.push(`Prefer these sources when available: ${request.preferredSources.join(', ')}.`)
  if (request.disallowedSources.length > 0) sourceGuidance.push(`Do not use these sources: ${request.disallowedSources.join(', ')}.`)
  if (sourceGuidance.length > 0) spec.systemPrompt = sourceGuidance.join(' ')
  if (request.budget?.maxCostUsd != null) {
    spec.budget = { maxCostDollars: request.budget.maxCostUsd }
  }
  return spec
}

function fieldNames(request) {
  return Object.keys(request.requestedOutputSchema?.properties ?? {})
}

// Live-bake-off finding (2026-09-03): the real Exa grounding shape is
// `{field: 'structured.<fieldName>', citations: [{url, title}],
// confidence: 'low'|'medium'|'high'}` -- THREE things the (undocumented in
// what could be fetched) synthetic Wave 4 shape got wrong: (1) field is
// prefixed with 'structured.', not the bare field name -- the lookup
// never matched anything, so EVERY Exa claim had zero linked evidence;
// (2) citations live directly on the grounding entry (no `.sources`
// wrapper, which never existed -- the previous code's citation loop was
// silently a no-op); (3) Exa DOES report a per-field confidence, the
// same low/medium/high scale Parallel uses -- the "Exa has no confidence"
// finding from the documentation-only research phase does not hold for
// the real API. Normalized with the identical mapping Parallel's adapter
// uses, since both providers turned out to share the same scale.
const CONFIDENCE_LEVEL_TO_NUMBER = { low: 0.25, medium: 0.6, high: 0.9 }
function normalizeExaConfidence(level) {
  return CONFIDENCE_LEVEL_TO_NUMBER[level] ?? null
}

// Exported so an already-captured raw run (e.g. from a prior live bake-off,
// re-fetched by run id at zero additional cost) can be reprocessed through
// the current parser without a new dispatch -- used to regenerate
// regression fixtures after an adapter fix.
export function parseCompletedRun(request, run) {
  const output = run.output
  if (!output || typeof output.structured !== 'object' || output.structured === null) {
    return failedResult(request, run, 'MALFORMED_PROVIDER_RESPONSE', 'Exa run reported completed but output.structured is missing/malformed.')
  }
  const groundingByField = new Map((output.grounding ?? []).map((g) => [g.field?.replace(/^structured\./, ''), g]))
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
      providerConfidence: normalizeExaConfidence(grounding?.confidence),
      providerReasoning: value == null ? 'field absent from provider response' : null
    })
    for (const citation of grounding?.citations ?? []) {
      const sourceRef = citation.url
      if (!seenSourceRefs.has(sourceRef)) {
        sourceReferences.push({ sourceRef, url: citation.url, publisher: citation.title ?? null, retrievedAt: run.completed_at ?? isoNow() })
        seenSourceRefs.add(sourceRef)
      }
      // Real Exa citations carry no excerpt/snippet text (only url+title,
      // unlike Parallel's citations.excerpts) -- title is the closest
      // available descriptive text, disclosed as such.
      evidence.push({ claimFieldName: fieldName, sourceRef, snippet: citation.title ?? '', supportsClaim: true })
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
      // No separate raw "request count" is documented on the real Exa
      // response -- only agentComputeUnits. Left honestly null rather than
      // fabricated as 1.
      requestCount: null,
      tokensOrUnits: run.usage?.agentComputeUnits ?? null,
      // costDollars is a TOP-LEVEL field on the real run response (not
      // nested under usage) -- corrected from the Wave 4 synthetic shape's
      // nested usage.cost_usd assumption. Live-bake-off finding: the real
      // field is itself an OBJECT ({total, agentCompute, search, emails,
      // phoneNumbers}), not a plain number as first assumed -- .total is
      // the actual billed total.
      providerReportedCostUsd: run.costDollars?.total ?? null
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
    // Live-doc revalidation (2026-09-03): the real documented status enum
    // is queued|running|completed|failed|cancelled -- 'pending' was a
    // synthetic Wave 4 placeholder that never matched the real API,
    // corrected here.
    if (run.status === 'queued' || run.status === 'running') {
      return { ok: true, status: 'PENDING' }
    }
    if (run.status === 'failed') {
      return { ok: true, status: 'READY', result: failedResult(request, run, 'PROVIDER_REPORTED_FAILURE', run.error?.message) }
    }
    if (run.status === 'cancelled') {
      return { ok: true, status: 'READY', result: failedResult(request, run, 'PROVIDER_RUN_CANCELLED', run.error?.message ?? 'run was cancelled') }
    }
    if (run.status !== 'completed') {
      return { ok: true, status: 'READY', result: failedResult(request, run, 'MALFORMED_PROVIDER_RESPONSE', `unrecognized status: ${run.status}`) }
    }
    return { ok: true, status: 'READY', result: parseCompletedRun(request, run) }
  }

  return { provider: EXA_PROVIDER_ID, dispatch, fetchResult }
}

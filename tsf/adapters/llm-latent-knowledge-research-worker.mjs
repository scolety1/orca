// The first BoundedResearchWorker that treats an LLM's own latent/training
// knowledge as an acquisition source -- every prior adapter (web-table,
// exa, parallel, owner-supplied-local-artifact, authenticated-official-
// download) is a grounded, citation-required web/file fetch. This one asks
// a live provider to RECALL a value from memory, with an explicit
// epistemic-discipline prompt and an honestly-weakest provenance tier --
// never a fabricated citation, never a stronger-than-warranted claim.
//
// ROUTING DECISION (reconciled before build): reuses the EXISTING
// PLANNER_DEEP role via live-planner.mjs's invokeLiveStructuredAnalysis
// unchanged, rather than adding a new KNOWLEDGE_RETRIEVAL role. Reasons:
// (1) routing.mjs's ROLE_IDS is a small, closed set the routing config
// itself documents as "stable" (provider-role-mappings.v1.json's
// architectureRule), enforced by assertRoutingConfiguration's exact-set
// check -- widening it is a cross-cutting routing change, not something
// one narrow worker should own unilaterally; (2) invokeLiveStructuredAnalysis
// -- the one proven-live generic structured-LLM entrypoint this program
// requires reusing verbatim -- hardcodes role:'PLANNER_DEEP' with no role
// parameter; adding a new role would mean widening that function's
// contract too, edging toward "a second invocation mechanism," which this
// program explicitly forbids; (3) PLANNER_DEEP's DEEP_REASONING/HIGH-effort
// class is an honest fit for "recall one exact value carefully and
// self-assess real confidence" -- more honest than any WORKER_* role
// (IMPLEMENTATION-flavored) or VERIFIER_INDEPENDENT (verifies someone
// else's answer, not primary generation). This worker therefore never
// calls resolveRole/resolveUsageMode itself -- it delegates entirely to
// invokeLiveStructuredAnalysis, exactly like field-source-reconciliation.mjs
// already does, so it naturally rides the same live fallback chain
// (CLAUDE_SAFE -> CODEX_SAFE) that function already proves out.
import { invokeLiveStructuredAnalysis as defaultInvokeLiveStructuredAnalysis } from '../server/live-planner.mjs'
import { isoNow, sha256 } from '../domain/canonical.mjs'
import { PROVENANCE_STRENGTH } from '../domain/source-chain-of-custody.mjs'

export const LLM_LATENT_KNOWLEDGE_PROVIDER_ID = 'LLM_LATENT_KNOWLEDGE_RECALL'

// TRUST-CATEGORY GATE, not a cost gate: this worker spends nothing new
// beyond existing subscription capacity, but a raw model-recall claim is a
// fundamentally different trust category than a $0 public web fetch (no
// verifiable external source at all). Mirrors research-http-routes.mjs's
// TSF_RESEARCH_LIVE_DISPATCH_ENABLED convention -- default-OFF, checked
// FIRST, before any provider call, fails closed with a clear machine-
// readable reason. Deliberately its own env var (not the paid-dispatch
// one): this worker costs no NEW money, so conflating it with the
// $-per-call gate would either wrongly require an API key it doesn't need,
// or wrongly imply $0 workers need no opt-in, which this program's
// directive explicitly rejects for this specific worker.
function latentKnowledgeDispatchEnabled() {
  return process.env.TSF_RESEARCH_LATENT_KNOWLEDGE_DISPATCH_ENABLED === '1'
}

const SYSTEM_PROMPT = [
  'You are being asked to recall SPECIFIC FACTUAL VALUES about a named entity/subject/period, purely from your own latent training knowledge. No web search, no tool, and no external lookup is available to you in this call.',
  '',
  'For EACH requested field: if you genuinely recall an exact value with confidence, return it with status "KNOWN", the value, a confidence level between 0 and 1, one sentence of reasoning, and any remembered source/context (only what you actually remember -- e.g. a publication or dataset name -- never invented).',
  'If you do not have real, exact knowledge of a field, return status "UNKNOWN" with value null. Do NOT calculate, estimate, derive, or infer a value you do not actually recall. Do NOT invent a citation, publication, or source you do not actually remember -- if you are not sure of a source, leave rememberedSourceContext null.',
  'Confidence must reflect genuine uncertainty. Do not default to a high confidence out of habit, and never report KNOWN for a value you are only guessing at.'
].join('\n')

const KNOWLEDGE_RECALL_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['answers'],
  properties: {
    answers: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['fieldName', 'status', 'value', 'confidence', 'reasoning', 'rememberedSourceContext'],
        properties: {
          fieldName: { type: 'string' },
          status: { enum: ['KNOWN', 'UNKNOWN'] },
          value: { type: ['string', 'number', 'null'] },
          confidence: { type: ['number', 'null'] },
          reasoning: { type: 'string' },
          rememberedSourceContext: { type: ['string', 'null'] }
        }
      }
    }
  }
}

function fieldNames(request) {
  return Object.keys(request.requestedOutputSchema?.properties ?? {})
}

function buildPrompt(request, fields) {
  return JSON.stringify({
    researchQuestion: request.researchQuestion,
    targetEntity: request.targetEntity ?? null,
    temporalScope: request.temporalRequirements?.periodScope ?? null,
    asOfDate: request.temporalRequirements?.asOfDate ?? null,
    requestedFields: fields
  })
}

function emptyUsage() {
  // requestCount:0/tokensOrUnits:null distinguish "never asked" from a real
  // 1-request call below -- providerReportedCostUsd stays null (unknown),
  // never coerced to 0, matching the schema's own "unknown MUST be null"
  // discipline.
  return { requestCount: 0, tokensOrUnits: null, providerReportedCostUsd: null }
}

function baseResult(request, status) {
  return {
    schemaVersion: 'TSF_BOUNDED_RESEARCH_RESULT_V1',
    nodeId: request.nodeId,
    taskFingerprint: request.taskFingerprint,
    provider: LLM_LATENT_KNOWLEDGE_PROVIDER_ID,
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

// Sole SourceSnapshotReference this worker ever produces -- a single,
// self-referential "unverified model recall" marker, never a fabricated
// external citation. provenanceStrength is explicitly PROVENANCE_STRENGTH.NONE
// (REQ-003's weakest tier, "no origin claim at all") -- the honest tier for
// raw latent recall, set explicitly rather than left to the schema's own
// "absent means NONE" default so it reads directly in any audit.
function buildLatentKnowledgeSnapshot(request, live, proposedClaims, clock) {
  return {
    sourceRef: 'LLM_LATENT_KNOWLEDGE_RECALL:unverified-model-recall',
    contentHash: sha256({ taskFingerprint: request.taskFingerprint, claims: proposedClaims }),
    acquisitionMethod: 'LLM_LATENT_KNOWLEDGE_RECALL',
    // Not a web-source-access-gate concept (no fetch, no rights question) --
    // honestly null/N/A rather than force-fit into that web-only taxonomy.
    acquisitionMode: null,
    accessClassification: null,
    provenanceStrength: PROVENANCE_STRENGTH.NONE,
    schemaFingerprint: null,
    selectorOrAdapterVersion: null,
    transformationVersion: null,
    modeEvidence: {
      schemaVersion: 'LLM_LATENT_KNOWLEDGE_EVIDENCE_V1',
      // Real answering identity (Phase 5's auditability requirement) --
      // whatever invokeLiveStructuredAnalysis actually resolved to, never a
      // hardcoded provider/model name from this file.
      providerId: live.providerId ?? null,
      agentId: live.agentId ?? null,
      model: live.model ?? null,
      role: live.role ?? null,
      note: "model's own latent training knowledge, unverified, no external citation",
      answeredAt: isoNow(clock)
    }
  }
}

async function computeResult(request, clock, invokeFn) {
  const fields = fieldNames(request)
  if (fields.length === 0) {
    const result = baseResult(request, 'FAILED')
    result.failureDetails = { reason: 'NO_REQUESTED_FIELDS', detail: 'requestedOutputSchema named no fields for this worker to recall' }
    return result
  }
  if (!latentKnowledgeDispatchEnabled()) {
    const result = baseResult(request, 'FAILED')
    result.failureDetails = {
      reason: 'LATENT_KNOWLEDGE_WORKER_DISABLED',
      detail: 'set TSF_RESEARCH_LATENT_KNOWLEDGE_DISPATCH_ENABLED=1 to allow this worker to ask a provider for raw model recall -- disabled by default, an explicit opt-in even though this worker spends no new money'
    }
    return result
  }
  const live = await invokeFn({
    systemPrompt: SYSTEM_PROMPT,
    prompt: buildPrompt(request, fields),
    jsonSchema: KNOWLEDGE_RECALL_SCHEMA,
    timeoutOverrideMs: 60000
  })
  if (!live.ok) {
    // Genuine provider-unavailable/timeout/malformed-response failure --
    // reason namespace is disjoint from this worker's own
    // MODEL_REPORTED_UNKNOWN_FOR_ALL_FIELDS below, so a caller can always
    // tell "no provider answered" apart from "a provider answered honestly
    // with no knowledge."
    const result = baseResult(request, 'FAILED')
    result.failureDetails = { reason: live.reason ?? 'PROVIDER_UNAVAILABLE', detail: live.detail ?? null }
    return result
  }

  const answers = Array.isArray(live.data?.answers) ? live.data.answers : []
  const byField = new Map(
    answers.filter((a) => typeof a?.fieldName === 'string' && fields.includes(a.fieldName)).map((a) => [a.fieldName, a])
  )

  const proposedClaims = []
  const observations = []
  const unresolvedQuestions = []
  for (const fieldName of fields) {
    const answer = byField.get(fieldName)
    // Anti-fabrication gate: only status==='KNOWN' with a real, non-null
    // value ever becomes a claim -- a missing/malformed answer entry is
    // treated exactly like an honest UNKNOWN, never silently promoted.
    if (!answer || answer.status !== 'KNOWN' || answer.value === null || answer.value === undefined) {
      unresolvedQuestions.push(`${fieldName}: model reported no confident, genuine recollection (status ${answer?.status ?? 'MISSING'})`)
      continue
    }
    const providerConfidence = typeof answer.confidence === 'number' ? answer.confidence : null
    const providerReasoning = typeof answer.reasoning === 'string' ? answer.reasoning : null
    proposedClaims.push({
      fieldName,
      proposedValue: answer.value,
      temporalScope: request.temporalRequirements?.periodScope ?? null,
      providerConfidence,
      providerReasoning
    })
    observations.push({
      rawContent: { fieldName, value: answer.value, rememberedSourceContext: typeof answer.rememberedSourceContext === 'string' ? answer.rememberedSourceContext : null },
      extractedAt: isoNow(clock),
      providerConfidence,
      providerReasoning
    })
  }

  if (proposedClaims.length === 0) {
    // A real, live-invoked answer where the model honestly reported no
    // recollection for anything asked -- distinct from a provider failure
    // above, and never silently coerced into an empty SUCCEEDED result.
    const result = baseResult(request, 'FAILED')
    result.unresolvedQuestions = unresolvedQuestions
    result.failureDetails = {
      reason: 'MODEL_REPORTED_UNKNOWN_FOR_ALL_FIELDS',
      detail: `the answering provider genuinely reported no confident recollection for any requested field -- an honest non-answer, never a fabricated guess`
    }
    return result
  }

  const status = unresolvedQuestions.length > 0 ? 'PARTIAL' : 'SUCCEEDED'
  const result = baseResult(request, status)
  result.observations = observations
  result.proposedClaims = proposedClaims
  // evidence/sourceReferences deliberately stay [] -- no real snippet or
  // external source exists to cite; fabricating either would misrepresent
  // an unverified recall as grounded research.
  result.sourceSnapshotsOrSnapshotRefs = [buildLatentKnowledgeSnapshot(request, live, proposedClaims, clock)]
  result.unresolvedQuestions = unresolvedQuestions
  result.usage = { requestCount: 1, tokensOrUnits: null, providerReportedCostUsd: live.costUsd ?? null }
  return result
}

// `invokeLiveStructuredAnalysisFn` override is for deterministic tests only
// (mirrors createWebTableResearchWorker's injected `acquireFn`) -- defaults
// to the real, already-proven-live production entrypoint. Never spawns a
// real provider process in this worker's own test suite.
export function createLlmLatentKnowledgeResearchWorker({ clock = () => new Date(), invokeLiveStructuredAnalysisFn = defaultInvokeLiveStructuredAnalysis } = {}) {
  async function dispatch(request) {
    const result = await computeResult(request, clock, invokeLiveStructuredAnalysisFn)
    // Same {ok:false}-on-FAILED convention as web-table-research-worker.mjs:
    // classifies AT_MOST_ONCE, permitting a future real retry, correct for
    // a synchronous worker with no external job to re-poll.
    if (result.status === 'FAILED') {
      const detail = result.unresolvedQuestions.length > 0 ? `${result.failureDetails.detail} -- ${result.unresolvedQuestions.join('; ')}` : result.failureDetails.detail
      return { ok: false, reason: result.failureDetails.reason, detail }
    }
    const dispatchedAt = isoNow(clock)
    const providerRunRef = { provider: LLM_LATENT_KNOWLEDGE_PROVIDER_ID, providerRunId: JSON.stringify({ dispatchedAt, result: { ...result, providerRunRef: undefined } }), dispatchedAt }
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

  return { provider: LLM_LATENT_KNOWLEDGE_PROVIDER_ID, dispatch, fetchResult }
}

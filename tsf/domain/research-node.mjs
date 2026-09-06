// Research node dispatch/result-acquisition lifecycle: builds the
// provider-independent BoundedResearchRequest, records worker_run_ref
// persistence, and durably stores a raw BoundedResearchResult before
// admission. Every mutation goes through research-mission.mjs's
// withResearchNode primitive so it shares the mission's single revision
// counter (see the concurrency-probe rationale there). Nothing in this
// module inspects or creates epistemic records (Observation/Claim/etc.) --
// that is research-admission.mjs's job.
import { canonicalize, deepClone, isoNow, sha256 } from './canonical.mjs'
import { assertNodeTransition, withResearchNode } from './research-mission.mjs'
import { validateBoundedResearchRequest, validateBoundedResearchResult } from '../contracts/validate-research-contracts.mjs'

// "GENERIC V0 ADOPTION READINESS" Phase 8 (customer-mission boundary):
// a claim's temporalScope (a period-string label, e.g. '2001-regular-
// season') was previously the ONLY temporal signal verification ever
// checked -- nothing distinguished a value genuinely observed AT that
// period from a value about that period discovered/derived LATER
// (retrospectively, or from an outcome that only exists after the fact).
// A customer specification needing "this must be a point-in-time,
// pre-decision value, not a later reconstruction or an outcome" (e.g. a
// historical market snapshot vs. a season's final results) could not
// express that requirement generically, and outcome evidence could
// satisfy a pre-decision field merely by matching the period string.
// Reuses the exact vocabulary already established for real, independent
// source-discovery work (Historical ADP Source Feasibility V0):
export const TEMPORAL_CLASSES = Object.freeze([
  'CONTEMPORANEOUS_SNAPSHOT', // genuinely observed/recorded at or near the stated period
  'RETROSPECTIVE_RECONSTRUCTION', // assembled/estimated later from period-appropriate material
  'OUTCOME_DATA', // a result that only exists because the period has already concluded
  'UNKNOWN_TEMPORAL_STATUS' // honest default -- never fabricated as CONTEMPORANEOUS
])

// Pre-dispatch dedupe key -- distinct from the post-hoc result-digest
// idempotency used elsewhere in TSF (recordWave/registerWorkerResult). See
// CORRECTION WAVE 1's reuse map: TSF had no existing "fingerprint" concept,
// only content-hash dedupe of completed outcomes.
export function computeTaskFingerprint({ nodeId, researchQuestion, requestedOutputSchema, provider }) {
  return sha256(canonicalize({ nodeId, researchQuestion, requestedOutputSchema, provider }))
}

// Live-bake-off finding (2026-09-03): every node was previously sent the
// SAME mission-level researchQuestion verbatim, with no mention of which
// entity this node actually concerns. A real provider has no other signal
// to scope from (`scope: ['node:...']` is a TSF-internal tag, meaningless
// to a provider) -- a live Exa Agent call built from the un-scoped
// question returned a broad multi-entity survey instead of one player,
// with an internally inconsistent result (missing a field for the exact
// entity being asked about). This composes a domain-neutral, generic
// entity label (name, falling back to entityId) into the question sent to
// the provider -- no entity-specific field NAMES are hardcoded here, only
// whatever the caller already put in targetEntity.
function scopedResearchQuestion(spec, node) {
  const entityLabel = node.targetEntity?.name ?? node.targetEntity?.entityId
  return entityLabel ? `${spec.researchQuestion} Research only the following entity for this request: ${entityLabel}.` : spec.researchQuestion
}

// Builds the provider-independent request. No provider-specific field, no
// scope/toolPermissions widening beyond what the owning ResearchSpecification
// already declares -- the security boundary (§11) is enforced structurally
// here: this is the only place a BoundedResearchRequest is constructed, and
// it always copies scope/toolPermissions/sourcePolicy from the immutable
// specification, never from worker-supplied input.
export function buildBoundedResearchRequest(mission, node, provider, clock) {
  const spec = mission.specification
  const researchQuestion = scopedResearchQuestion(spec, node)
  const request = {
    schemaVersion: 'TSF_BOUNDED_RESEARCH_REQUEST_V1',
    nodeId: node.id,
    taskFingerprint: computeTaskFingerprint({
      nodeId: node.id,
      researchQuestion,
      requestedOutputSchema: node.requestedOutputSchema,
      provider
    }),
    nodeRole: node.nodeRole,
    researchQuestion,
    // Additive V1.1 field: a generic free/public worker (e.g. a web-table
    // extractor) needs a structured entity identity to match a table row --
    // Exa/Parallel ignore this, relying on researchQuestion's free-text
    // entity mention (scopedResearchQuestion above) instead.
    targetEntity: node.targetEntity ? { entityId: node.targetEntity.entityId, name: node.targetEntity.name ?? null } : null,
    scope: [`node:${node.id}`],
    requestedOutputSchema: deepClone(node.requestedOutputSchema),
    temporalRequirements: deepClone(spec.temporalRequirements),
    sourcePolicy: deepClone(spec.sourcePolicy),
    preferredSources: [...spec.sourcePolicy.preferredSources],
    disallowedSources: [...spec.sourcePolicy.disallowedSources],
    licensingConstraints: [...spec.sourcePolicy.licensingConstraints],
    freshnessPolicy: spec.sourcePolicy.freshnessPolicy,
    budget: deepClone(spec.budget),
    toolPermissions: [...spec.toolPermissions]
  }
  validateBoundedResearchRequest(request)
  return request
}

// Idempotent by taskFingerprint -- a duplicate dispatch attempt for the
// same logical request is a no-op, matching this codebase's established
// digest-dedupe convention (recordWave/registerWorkerResult), generalized
// to a PRE-dispatch key. Represents crash/resume scenario B's starting
// durable state ("worker_run_ref persisted"); scenario A (crash before this
// is called) needs no domain function -- nothing durable exists yet, so a
// fresh call here is simply the resume action.
export function recordResearchNodeDispatch(mission, nodeId, { taskFingerprint, workerRunRef }, clock, expectedRevision) {
  return withResearchNode(
    mission,
    nodeId,
    (node) => {
      if (node.dispatchRecords.some((d) => d.taskFingerprint === taskFingerprint)) {
        return { next: node, changed: false }
      }
      assertNodeTransition(node.status, 'DISPATCHED')
      const next = deepClone(node)
      next.status = 'DISPATCHED'
      next.dispatchRecords.push({ taskFingerprint, workerRunRef, dispatchedAt: isoNow(clock) })
      return { next, changed: true }
    },
    clock,
    expectedRevision
  )
}

// Durably stores a raw, validated BoundedResearchResult BEFORE admission.
// Idempotent by sha256(result) -- a duplicate/redelivered result (webhook
// retry, poll race) is harmless. Represents crash/resume scenario D's
// completion ("result acquired -> durable result persistence"); scenario E
// (crash before admission) is exactly "rawResults holds this digest but
// admittedResultDigests does not yet" -- research-admission.mjs resumes
// from there.
//
// Trust + Scale Hardening (human review integration) finding: this
// previously routed EVERY result to RESULT_RECEIVED regardless of
// result.status, and admitBoundedResearchResult then unconditionally
// forced ADMITTED -- a clean, honest FAILED provider result (real
// failureDetails, zero observations/claims) was silently indistinguishable
// from a real successful admission. FAILED now routes to the node's own
// FAILED execution state (DISPATCHED -> FAILED was already a legal, but
// previously unreachable, transition) so a failed dispatch is an honest,
// visible signal instead of a silent no-op.
//
// CONTINUATION 2 Priority Block 2: PARTIAL and NEEDS_INPUT are NEITHER a
// failure NOR a full success -- both carry real, honest content that
// belongs in the epistemic ladder (admission's per-item loops already
// admit whatever observations/claims/evidence a result actually contains,
// regardless of its overall status), so both route to RESULT_RECEIVED
// exactly like SUCCEEDED, never FAILED. What must NOT happen is silently
// treating them as equivalent to a full SUCCEEDED result -- this stamps
// the raw outcome kind durably onto the node (lastResultOutcome) so every
// downstream reader (completeness, the driver, a future operator UI) can
// tell "fully succeeded" apart from "partial" apart from "needs input"
// without having to dig through rawResults history.
export function recordResearchNodeResult(mission, nodeId, result, clock, expectedRevision) {
  validateBoundedResearchResult(result)
  const digest = sha256(result)
  const targetStatus = result.status === 'FAILED' ? 'FAILED' : 'RESULT_RECEIVED'
  return withResearchNode(
    mission,
    nodeId,
    (node) => {
      if (node.rawResults?.some((r) => r.digest === digest)) {
        return { next: node, changed: false }
      }
      if (node.status !== targetStatus) {
        assertNodeTransition(node.status, targetStatus)
      }
      const next = deepClone(node)
      next.rawResults = [...(next.rawResults ?? []), { digest, result: deepClone(result), receivedAt: isoNow(clock) }]
      next.status = targetStatus
      next.lastResultOutcome = result.status
      return { next, changed: true }
    },
    clock,
    expectedRevision
  )
}

// Retry-budget accounting per node, mirroring keep-going.mjs's
// recordTaskAttempt exactly (REUSE_DIRECTLY of the pattern, keyed by
// node_id instead of taskId).
export function recordResearchNodeAttempt(mission, nodeId, outcome, clock, expectedRevision, budget = { maxRetriesPerNode: 2 }) {
  return withResearchNode(
    mission,
    nodeId,
    (node) => {
      const priorCount = node.retryCount ?? 0
      const count = outcome === 'RETRY' ? priorCount + 1 : priorCount
      if (outcome === 'RETRY' && count > budget.maxRetriesPerNode) {
        const error = new Error(`retry budget exceeded for research node ${nodeId}: ${count} > ${budget.maxRetriesPerNode}`)
        error.code = 'TSF_RESEARCH_RETRY_BUDGET_EXCEEDED'
        throw error
      }
      const next = deepClone(node)
      next.retryCount = count
      next.attempts = [...next.attempts, { outcome, at: isoNow(clock) }]
      if (outcome === 'RETRY') next.status = 'READY'
      return { next, changed: true }
    },
    clock,
    expectedRevision
  )
}

export function markResearchNodeReady(mission, nodeId, clock, expectedRevision) {
  return withResearchNode(
    mission,
    nodeId,
    (node) => {
      if (node.status === 'READY') return { next: node, changed: false }
      assertNodeTransition(node.status, 'READY')
      return { next: { ...node, status: 'READY' }, changed: true }
    },
    clock,
    expectedRevision
  )
}

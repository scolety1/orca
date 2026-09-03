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

// Pre-dispatch dedupe key -- distinct from the post-hoc result-digest
// idempotency used elsewhere in TSF (recordWave/registerWorkerResult). See
// CORRECTION WAVE 1's reuse map: TSF had no existing "fingerprint" concept,
// only content-hash dedupe of completed outcomes.
export function computeTaskFingerprint({ nodeId, researchQuestion, requestedOutputSchema, provider }) {
  return sha256(canonicalize({ nodeId, researchQuestion, requestedOutputSchema, provider }))
}

// Builds the provider-independent request. No provider-specific field, no
// scope/toolPermissions widening beyond what the owning ResearchSpecification
// already declares -- the security boundary (§11) is enforced structurally
// here: this is the only place a BoundedResearchRequest is constructed, and
// it always copies scope/toolPermissions/sourcePolicy from the immutable
// specification, never from worker-supplied input.
export function buildBoundedResearchRequest(mission, node, provider, clock) {
  const spec = mission.specification
  const request = {
    schemaVersion: 'TSF_BOUNDED_RESEARCH_REQUEST_V1',
    nodeId: node.id,
    taskFingerprint: computeTaskFingerprint({
      nodeId: node.id,
      researchQuestion: spec.researchQuestion,
      requestedOutputSchema: node.requestedOutputSchema,
      provider
    }),
    nodeRole: node.nodeRole,
    researchQuestion: spec.researchQuestion,
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
export function recordResearchNodeResult(mission, nodeId, result, clock, expectedRevision) {
  validateBoundedResearchResult(result)
  const digest = sha256(result)
  return withResearchNode(
    mission,
    nodeId,
    (node) => {
      if (node.rawResults?.some((r) => r.digest === digest)) {
        return { next: node, changed: false }
      }
      if (node.status !== 'RESULT_RECEIVED') {
        assertNodeTransition(node.status, 'RESULT_RECEIVED')
      }
      const next = deepClone(node)
      next.rawResults = [...(next.rawResults ?? []), { digest, result: deepClone(result), receivedAt: isoNow(clock) }]
      next.status = 'RESULT_RECEIVED'
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

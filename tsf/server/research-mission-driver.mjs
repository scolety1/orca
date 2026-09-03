// CONTINUATION 2 Priority Block 1: the real, persisted TSF research mission
// execution path. Everything here composes ALREADY-EXISTING, already-
// verified primitives (research-mission-store.mjs's withResearchMission/
// readResearchMission, every research-*.mjs domain function, research-
// dispatch-bookkeeping.mjs) -- no new scheduler, no new persistence
// mechanism, no new runtime. What was missing was a real caller that
// drives a mission through them durably, one real network boundary at a
// time, instead of a one-shot in-memory script
// (fixtures/live-bakeoff-runner.mjs, which remains as a developer utility
// but is no longer the only real-provider execution path).
//
// CRASH-SAFETY DESIGN: every exported function here that performs a real
// network call splits into multiple SEPARATE withResearchMission calls
// around that call -- dispatch intent (recordDispatchAttempt) is persisted
// BEFORE worker.dispatch() ever touches the network; the outcome
// (resolveDispatchAttempt, then recordResearchNodeDispatch) is persisted
// immediately after. A crash between any two of these steps leaves exactly
// the durable state research-dispatch-bookkeeping.mjs already knows how to
// classify (EXACTLY_ONCE / AT_MOST_ONCE / AT_LEAST_ONCE /
// AMBIGUOUS_REQUIRES_RECONCILIATION) -- calling the SAME driver function
// again is the resume action, and it checks that classification FIRST,
// before ever risking a second real call.
import { addResearchNode, assertNodeTransition, createResearchMission, findResearchNode, raiseResearchNeedsYou, withResearchNode } from '../domain/research-mission.mjs'
import { buildBoundedResearchRequest, markResearchNodeReady, recordResearchNodeDispatch, recordResearchNodeResult } from '../domain/research-node.mjs'
import { classifyDispatchDeliveryGuarantee, recordDispatchAttempt, resolveDispatchAttempt } from '../domain/research-dispatch-bookkeeping.mjs'
import { admitBoundedResearchResult } from '../domain/research-admission.mjs'
import { detectResearchConflicts, verifyResearchClaim } from '../domain/research-verification.mjs'
import { admitReconciliationDecision, decideReconciliation } from '../domain/research-reconciliation.mjs'
import { authorizeMeteredExecution } from '../domain/research-cost-governance.mjs'
import { computeCompletenessMetrics } from '../domain/research-completeness.mjs'
import { buildResearchProvenancePackage } from '../domain/research-provenance.mjs'
import { readResearchMission, readResearchMissionIntegrityChecked, withResearchMission } from './research-mission-store.mjs'

// ---------------------------------------------------------------------
// CREATE
// ---------------------------------------------------------------------
// Idempotent by missionId -- a replayed create (e.g. a retried HTTP POST)
// is a safe no-op, matching addResearchNode's own idempotent-by-id
// convention one level up.
export async function createResearchMissionDurable(missionId, { projectId, specification, expectedUniverse, nodes = [] }, clock) {
  return withResearchMission(missionId, (current) => {
    if (current) return current
    let mission = createResearchMission({ id: missionId, projectId, specification, expectedUniverse }, clock)
    for (const nodeInput of nodes) mission = addResearchNode(mission, nodeInput, clock)
    return mission
  })
}

// ---------------------------------------------------------------------
// READ
// ---------------------------------------------------------------------
export function readResearchMissionStatus(missionId) {
  const mission = readResearchMission(missionId)
  if (!mission) return null
  const nodesByStatus = {}
  for (const n of mission.nodes) nodesByStatus[n.status] = (nodesByStatus[n.status] ?? 0) + 1
  return {
    missionId,
    state: mission.state,
    revision: mission.revision,
    nodeCount: mission.nodes.length,
    nodesByStatus,
    openNeedsYouCount: mission.needsYou.filter((n) => !n.resolvedAt).length,
    updatedAt: mission.updatedAt
  }
}

export function readResearchMissionReviewItems(missionId) {
  const mission = readResearchMission(missionId)
  if (!mission) return null
  return mission.needsYou.filter((n) => !n.resolvedAt)
}

// Integrity-checked (research-integrity.mjs) -- never presents a
// quarantined CanonicalFact as trustworthy, matching every other
// consumption-facing reader's convention.
export function readResearchMissionArtifacts(missionId, clock) {
  const { mission } = readResearchMissionIntegrityChecked(missionId, clock)
  if (!mission) return null
  return buildResearchProvenancePackage(mission, { clock })
}

export function readResearchMissionCompleteness(missionId, clock) {
  const { mission } = readResearchMissionIntegrityChecked(missionId, clock)
  if (!mission) return null
  return computeCompletenessMetrics(mission, clock)
}

// Real, DURABLE cumulative spend -- computed from what actually landed on
// disk (node.rawResults[].result.usage), never from an in-memory counter.
// This is the load-bearing fix over live-bakeoff-runner.mjs's
// createGovernedDispatcher, whose cumulativeSpendUsd lives only in a
// closure variable and resets to 0 on every process restart -- a crash
// mid-mission there could let a resumed run blow straight through its own
// ceiling because the counter forgot everything already spent.
export function readResearchMissionProviderUsage(missionId) {
  const mission = readResearchMission(missionId)
  if (!mission) return null
  const byProvider = {}
  let totalRequests = 0
  let totalProviderReportedCostUsd = 0
  for (const node of mission.nodes) {
    // Request COUNT is taken from dispatchRecords -- a real dispatch is a
    // real commitment (billed/at-risk) the moment it's durably confirmed,
    // not only once a result is later polled and admitted. Gating cost on
    // rawResults alone would under-count an in-flight or crashed-before-
    // poll request.
    for (const record of node.dispatchRecords ?? []) {
      const provider = record.workerRunRef?.provider
      if (!provider) continue
      byProvider[provider] ??= { requests: 0, providerReportedCostUsd: 0 }
      byProvider[provider].requests += 1
      totalRequests += 1
    }
    // providerReportedCostUsd is only known once a real result comes
    // back, so it's sourced from rawResults -- and stays honestly absent
    // (never coerced to 0) when a provider never reports usage cost (real
    // observed case: Parallel), matching research-cost-governance.mjs's
    // own "unknown is unknown" discipline.
    for (const raw of node.rawResults ?? []) {
      const r = raw.result
      if (r.usage?.providerReportedCostUsd != null) {
        byProvider[r.provider] ??= { requests: 0, providerReportedCostUsd: 0 }
        byProvider[r.provider].providerReportedCostUsd += r.usage.providerReportedCostUsd
        totalProviderReportedCostUsd += r.usage.providerReportedCostUsd
      }
    }
  }
  return { missionId, totalRequests, totalProviderReportedCostUsd, byProvider }
}

// ---------------------------------------------------------------------
// CANCEL
// ---------------------------------------------------------------------
export async function cancelResearchNodeDurable(missionId, nodeId, clock) {
  return withResearchMission(missionId, (mission) => {
    if (!mission) throw new Error(`unknown research mission: ${missionId}`)
    return withResearchNode(
      mission,
      nodeId,
      (node) => {
        if (node.status === 'CANCELLED') return { next: node, changed: false }
        assertNodeTransition(node.status, 'CANCELLED')
        return { next: { ...node, status: 'CANCELLED' }, changed: true }
      },
      clock,
      mission.revision
    )
  })
}

// ---------------------------------------------------------------------
// EXECUTE / RESUME -- one node's real dispatch, durably, resume-safe.
// ---------------------------------------------------------------------
// costGovernance is optional -- { pricingPolicy, maxApprovedSpendUsd } --
// when supplied, gated with the REAL durable cumulative spend BEFORE the
// dispatch attempt is even recorded (never after; a refused call must
// never touch the network).
export async function dispatchResearchNodeDurable(missionId, nodeId, providerId, worker, clock, { costGovernance = null } = {}) {
  const mission = readResearchMission(missionId)
  if (!mission) throw new Error(`unknown research mission: ${missionId}`)
  const node = findResearchNode(mission, nodeId)
  if (!node) throw new Error(`unknown research node: ${nodeId}`)
  const request = buildBoundedResearchRequest(mission, node, providerId, clock)

  // RESUME CHECK -- the whole point of the durable attempt ledger: never
  // guess that a redispatch is safe.
  const existing = classifyDispatchDeliveryGuarantee(node, request.taskFingerprint)
  if (existing?.guarantee === 'EXACTLY_ONCE' || existing?.guarantee === 'AT_LEAST_ONCE') {
    return { ok: true, alreadyDispatched: true, mission, taskFingerprint: request.taskFingerprint }
  }
  if (existing?.guarantee === 'AMBIGUOUS_REQUIRES_RECONCILIATION') {
    return { ok: false, ambiguous: true, classification: existing, mission }
  }

  if (costGovernance) {
    const usage = readResearchMissionProviderUsage(missionId)
    const decision = authorizeMeteredExecution(
      {
        providerId,
        pricingPolicy: costGovernance.pricingPolicy,
        plannedRequestCount: (usage?.byProvider?.[providerId]?.requests ?? 0) + 1,
        maxApprovedSpendUsd: costGovernance.maxApprovedSpendUsd
      },
      clock
    )
    if (!decision.authorized) {
      return { ok: false, costRefused: true, decision }
    }
  }

  let next = await withResearchMission(missionId, (m) => markResearchNodeReady(m, nodeId, clock, m.revision))
  next = await withResearchMission(missionId, (m) => recordDispatchAttempt(m, nodeId, { taskFingerprint: request.taskFingerprint }, clock, m.revision))

  // THE real network call. If the process dies here, the attempt above is
  // already durable and UNKNOWN -- the next call to this function sees
  // AMBIGUOUS_REQUIRES_RECONCILIATION and refuses to guess, exactly the
  // property this priority block asked to be proven.
  const dispatched = await worker.dispatch(request)

  next = await withResearchMission(missionId, (m) =>
    resolveDispatchAttempt(
      m,
      nodeId,
      { taskFingerprint: request.taskFingerprint, outcome: dispatched.ok ? 'CONFIRMED' : 'FAILED_CLEAN', workerRunRef: dispatched.ok ? dispatched.workerRunRef : null },
      clock,
      m.revision
    )
  )
  if (!dispatched.ok) {
    return { ok: false, reason: dispatched.reason, detail: dispatched.detail, mission: next }
  }
  next = await withResearchMission(missionId, (m) => recordResearchNodeDispatch(m, nodeId, { taskFingerprint: request.taskFingerprint, workerRunRef: dispatched.workerRunRef }, clock, m.revision))
  return { ok: true, mission: next, taskFingerprint: request.taskFingerprint, workerRunRef: dispatched.workerRunRef }
}

// ---------------------------------------------------------------------
// POLL / CONTINUE -- resume-safe: fetchResult against a real provider is
// a safe, idempotent read; recordResearchNodeResult/admitBoundedResearchResult
// are already digest-idempotent, so calling this repeatedly (including
// after a crash between the two) always converges correctly.
// ---------------------------------------------------------------------
export async function pollAndAdmitResearchNodeDurable(missionId, nodeId, worker, clock) {
  const mission = readResearchMission(missionId)
  if (!mission) throw new Error(`unknown research mission: ${missionId}`)
  const node = findResearchNode(mission, nodeId)
  if (!node) throw new Error(`unknown research node: ${nodeId}`)
  const lastDispatch = node.dispatchRecords.at(-1)
  if (!lastDispatch) return { ok: false, reason: 'NOT_YET_DISPATCHED' }

  const fetched = await worker.fetchResult(lastDispatch.workerRunRef)
  if (!fetched.ok) return { ok: false, reason: fetched.reason, detail: fetched.detail }
  if (fetched.status !== 'READY') return { ok: true, ready: false, status: fetched.status }

  let next = await withResearchMission(missionId, (m) => recordResearchNodeResult(m, nodeId, fetched.result, clock, m.revision))
  const digest = findResearchNode(next, nodeId).rawResults.at(-1).digest
  next = await withResearchMission(missionId, (m) => admitBoundedResearchResult(m, nodeId, digest, clock, m.revision))
  return { ok: true, ready: true, mission: next }
}

// ---------------------------------------------------------------------
// VERIFY + RECONCILE -- a genuine conflict NEVER auto-resolves (escalated
// to Needs You instead); a field with exactly one independently verified,
// non-conflicting claim is auto-canonicalized through the real, unchanged
// reconciliation path (ACCEPT_SINGLE_VERIFIED_CLAIM) -- the same judgment
// call the manual bake-off scripts made by hand, made durable and
// resumable here.
// ---------------------------------------------------------------------
export async function verifyAndReconcileResearchNodeFieldDurable(missionId, nodeId, fieldName, decidedBy, clock) {
  const mission = readResearchMission(missionId)
  if (!mission) throw new Error(`unknown research mission: ${missionId}`)
  let node = findResearchNode(mission, nodeId)
  if (!node) throw new Error(`unknown research node: ${nodeId}`)

  let next = mission
  for (const claim of node.claims.filter((c) => c.fieldName === fieldName && c.status === 'UNVERIFIED')) {
    next = await withResearchMission(missionId, (m) => verifyResearchClaim(m, nodeId, claim.id, clock, m.revision)) // eslint-disable-line no-await-in-loop
  }
  next = await withResearchMission(missionId, (m) => detectResearchConflicts(m, nodeId, clock, m.revision))
  node = findResearchNode(next, nodeId)

  const openConflict = node.conflicts.find((c) => c.fieldName === fieldName && c.status === 'OPEN')
  if (openConflict) {
    next = await withResearchMission(missionId, (m) =>
      raiseResearchNeedsYou(m, { question: `Unresolved conflict on ${nodeId}.${fieldName} -- multiple disagreeing claims, no automatic winner.`, nodeId, category: 'UNRESOLVED_CONFLICT' }, clock, m.revision)
    )
    return { ok: true, escalated: true, mission: next }
  }

  const verifiedClaims = node.claims.filter((c) => c.fieldName === fieldName && c.status === 'VERIFIED')
  if (verifiedClaims.length !== 1) {
    return { ok: true, canonicalized: false, mission: next }
  }
  const claim = verifiedClaims[0]
  const verification = node.verifications.find((v) => v.claimId === claim.id)
  next = await withResearchMission(missionId, (m) =>
    decideReconciliation(
      m,
      nodeId,
      {
        fieldName,
        decisionType: 'ACCEPT_SINGLE_VERIFIED_CLAIM',
        selectedClaimId: claim.id,
        consideredClaimIds: [claim.id],
        verificationIds: verification ? [verification.id] : [],
        decidedValue: claim.proposedValue,
        temporalScope: claim.temporalScope ?? null,
        rationale: 'exactly one independently verified claim for this field, no open conflict',
        decidedBy
      },
      clock,
      m.revision
    )
  )
  const decisionId = findResearchNode(next, nodeId).reconciliationDecisions.at(-1).id
  next = await withResearchMission(missionId, (m) => admitReconciliationDecision(m, nodeId, decisionId, clock, m.revision))
  return { ok: true, canonicalized: true, mission: next }
}

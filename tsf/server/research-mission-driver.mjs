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
import { addResearchNode, assertNodeTransition, blockResearchMission, computeResearchMissionPhase, createResearchMission, escalateResearchNodeToNeedsYou, findResearchNode, raiseResearchNeedsYou, readyResearchNodes, withResearchNode } from '../domain/research-mission.mjs'
import { buildBoundedResearchRequest, markResearchNodeDispatchFailed, markResearchNodeReady, recordResearchNodeDispatch, recordResearchNodeResult } from '../domain/research-node.mjs'
import { classifyDispatchDeliveryGuarantee, recordDispatchAttempt, resolveDispatchAttempt } from '../domain/research-dispatch-bookkeeping.mjs'
import { admitBoundedResearchResult } from '../domain/research-admission.mjs'
import { detectResearchConflicts, verifyResearchClaim } from '../domain/research-verification.mjs'
import { admitReconciliationDecision, decideReconciliation } from '../domain/research-reconciliation.mjs'
import { authorizeMeteredExecution } from '../domain/research-cost-governance.mjs'
import { computeCompletenessMetrics } from '../domain/research-completeness.mjs'
import { createResearchLibrary, decideLibraryReferenceReconciliation, evaluateResearchLibraryReuse, evaluateSourceLibraryReuse, markResearchNodeAdmittedViaLibraryReuse, reuseSourceSnapshotIntoNode } from '../domain/research-library.mjs'
import { activeResearchPaidApproval, grantResearchPaidApproval, requestResearchPaidApproval } from '../domain/research-paid-approval.mjs'
import { buildResearchProvenancePackage } from '../domain/research-provenance.mjs'
import { readAllResearchMissions, readResearchMission, readResearchMissionIntegrityChecked, withResearchMission } from './research-mission-store.mjs'
import { readResearchLibrary } from './research-library-store.mjs'

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
    // See computeResearchMissionPhase's own comment: the one real answer to
    // "did this mission actually start doing anything" -- every surface
    // that claims a mission is active/started reads this, never its own
    // independent guess.
    phase: computeResearchMissionPhase(mission),
    revision: mission.revision,
    nodeCount: mission.nodes.length,
    nodesByStatus,
    openNeedsYouCount: mission.needsYou.filter((n) => !n.resolvedAt).length,
    updatedAt: mission.updatedAt
  }
}

// List summary for HQ/Work/Project-detail Research sections -- one real
// object per mission, no separate aggregation mechanism (same phase/
// nodesByStatus computation readResearchMissionStatus already uses).
// Operator UI IA consolidation: this is the one place "Active Research"/
// "Research for this project" read from, so a project's mission list can
// never drift from what /api/research/:id itself would say.
export function readAllResearchMissionSummaries({ projectId } = {}) {
  const missions = readAllResearchMissions()
  const summaries = []
  for (const [missionId, mission] of Object.entries(missions)) {
    if (projectId && mission.projectId !== projectId) continue
    const nodesByStatus = {}
    for (const n of mission.nodes) nodesByStatus[n.status] = (nodesByStatus[n.status] ?? 0) + 1
    summaries.push({
      missionId,
      projectId: mission.projectId,
      state: mission.state,
      phase: computeResearchMissionPhase(mission),
      revision: mission.revision,
      researchQuestion: mission.specification?.researchQuestion ?? null,
      entityType: mission.specification?.entityType ?? null,
      expectedCount: mission.expectedUniverse?.expectedCount ?? null,
      freePathOnly: (mission.specification?.budget?.maxCostUsd ?? 0) === 0,
      nodeCount: mission.nodes.length,
      nodesByStatus,
      openNeedsYouCount: mission.needsYou.filter((n) => !n.resolvedAt).length,
      updatedAt: mission.updatedAt
    })
  }
  return summaries
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
// CANCEL (mission-level) -- Command architecture round 3: "cancel it" had
// no real mission-level primitive before this (only cancelResearchNodeDurable
// existed, one node at a time). Reuses BLOCKED (domain/research-mission.mjs's
// blockResearchMission) rather than inventing a new terminal state --
// BLOCKED already means "stopped, needs attention", an honest fit for an
// operator-initiated cancellation; the reason string makes it clear this
// was a deliberate cancel, not a discovered blocker. Fails honestly (the
// real MISSION_ALLOWED transition table) rather than silently no-op-ing
// when the mission is already COMPLETE (terminal, no outgoing transition).
// ---------------------------------------------------------------------
export async function cancelResearchMissionDurable(missionId, reason, clock) {
  return withResearchMission(missionId, (mission) => {
    if (!mission) throw new Error(`unknown research mission: ${missionId}`)
    return blockResearchMission(mission, reason ?? 'OPERATOR_CANCELLED', [], clock, mission.revision)
  })
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
    // F5 fix: READY -> FAILED so the retry-budget-tracked decision path
    // (research-autonomy-policy.mjs's decideNextNodeAction FAILED branch)
    // sees this node next tick instead of it being silently re-issued as a
    // fresh DISPATCH forever.
    next = await withResearchMission(missionId, (m) => markResearchNodeDispatchFailed(m, nodeId, clock, m.revision))
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
//
// CONTINUATION 2 Priority Block 2 (PARTIAL/NEEDS_INPUT): both statuses
// admit their real content exactly like SUCCEEDED (unchanged admission
// behavior -- see recordResearchNodeResult's own comment). What this adds
// is the escalation POLICY for NEEDS_INPUT specifically: "use Needs You
// only when human intervention is genuinely necessary; if the missing
// input can be resolved automatically through authorized bounded
// research, propose/reconcile that work through TSF" (HQ's own wording).
// A NEEDS_INPUT result that already came with real newGapProposals is
// exactly the "TSF can address this itself" case -- those proposals are
// already durably recorded by admission (research-admission.mjs), ready
// for a human/future driver logic to promote into new bounded research
// nodes; no escalation is raised. A NEEDS_INPUT result with unresolvedQuestions
// but NO proposed follow-up work is a genuine "a human must decide what
// this even means" case -- escalated via the existing, real Needs You
// mechanism, never invented as a new parallel review path.
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

  if (fetched.result.status === 'NEEDS_INPUT') {
    const hasProposedFollowUp = fetched.result.newGapProposals.length > 0
    const unresolvedQuestions = fetched.result.unresolvedQuestions
    const alreadyOpen = findResearchNode(next, nodeId).status === 'BLOCKED'
    if (!hasProposedFollowUp && unresolvedQuestions.length > 0 && !alreadyOpen) {
      next = await withResearchMission(missionId, (m) =>
        escalateResearchNodeToNeedsYou(
          m,
          nodeId,
          { question: `Provider reported NEEDS_INPUT with no proposed follow-up research: ${unresolvedQuestions.join('; ')}`, category: 'SCHEMA_AMBIGUITY' },
          clock,
          m.revision
        )
      )
      return { ok: true, ready: true, mission: next, escalated: true }
    }
  }
  return { ok: true, ready: true, mission: next, escalated: false }
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
    // Independent-verification finding: raiseResearchNeedsYou itself never
    // dedupes (each call is a genuinely new question, by design -- see its
    // own doc comment), so calling this function AGAIN on an already-
    // escalated, still-open conflict (exactly the resume scenario this
    // driver exists for) previously raised a second, duplicate Needs You
    // entry every time. Guard here, mirroring the same
    // already-open-for-this-node check pollAndAdmitResearchNodeDurable's
    // NEEDS_INPUT branch already uses.
    const alreadyEscalated = next.needsYou.some((entry) => entry.nodeId === nodeId && entry.category === 'UNRESOLVED_CONFLICT' && !entry.resolvedAt)
    if (!alreadyEscalated) {
      next = await withResearchMission(missionId, (m) =>
        raiseResearchNeedsYou(m, { question: `Unresolved conflict on ${nodeId}.${fieldName} -- multiple disagreeing claims, no automatic winner.`, nodeId, category: 'UNRESOLVED_CONFLICT' }, clock, m.revision)
      )
    }
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

// ---------------------------------------------------------------------
// LIBRARY REUSE -- the durable, complete, correct sequence for adopting a
// cross-mission research-library hit. Real-pilot, independent-verification
// finding: a node resolved entirely through library reuse (no dispatch)
// previously stayed PENDING/READY forever despite having real
// CanonicalFacts, under-reporting completeness for a reuse-only mission.
// This driver function is now the sanctioned, complete path: evaluate,
// decide, admit, and mark the node ADMITTED, each its own durable commit.
// ---------------------------------------------------------------------
export async function adoptResearchLibraryReuseDurable(missionId, nodeId, fieldName, library, { requiredTemporalScope = undefined, valueType = undefined, decidedBy, rationale }, clock) {
  const mission = readResearchMission(missionId)
  if (!mission) throw new Error(`unknown research mission: ${missionId}`)
  const node = findResearchNode(mission, nodeId)
  if (!node) throw new Error(`unknown research node: ${nodeId}`)
  const evaluation = evaluateResearchLibraryReuse(library, { sourcePolicy: mission.specification.sourcePolicy, entityId: node.targetEntity?.entityId, fieldName, requiredTemporalScope, valueType })
  if (evaluation.decision !== 'CACHE_HIT') {
    return { ok: true, adopted: false, evaluation, mission }
  }
  let next = await withResearchMission(missionId, (m) =>
    decideLibraryReferenceReconciliation(m, nodeId, { fieldName, libraryEntry: evaluation.hit, decidedBy, rationale: rationale ?? `CACHE_HIT: reused from ${evaluation.hit.missionId}, same required temporalScope, HISTORICAL_STATIC source.` }, clock, m.revision)
  )
  const decisionId = findResearchNode(next, nodeId).reconciliationDecisions.at(-1).id
  next = await withResearchMission(missionId, (m) => admitReconciliationDecision(m, nodeId, decisionId, clock, m.revision))
  // Only ever moves a node with ZERO real dispatch history -- a node that
  // has already been through a real dispatch cycle keeps its real
  // execution status untouched (markResearchNodeAdmittedViaLibraryReuse
  // itself refuses that case defensively).
  if (findResearchNode(next, nodeId).status !== 'ADMITTED' && (findResearchNode(next, nodeId).dispatchRecords ?? []).length === 0) {
    next = await withResearchMission(missionId, (m) => markResearchNodeAdmittedViaLibraryReuse(m, nodeId, clock, m.revision))
  }
  return { ok: true, adopted: true, evaluation, mission: next }
}

// ---------------------------------------------------------------------
// RAW SOURCE LIBRARY V0 ("GENERIC V0 ADOPTION READINESS" Phase 3): the
// durable counterpart to reuseSourceSnapshotIntoNode. Deliberately does
// NOT touch Observation/Claim/Verification/Reconciliation/CanonicalFact --
// it only makes a previously-fetched, immutable source's locator/hash
// locally available on the calling mission's node, exactly as if that
// mission had just fetched it fresh. The caller performs its own full
// epistemic-ladder path afterward (normal admitBoundedResearchResult /
// verifyAndReconcileResearchNodeFieldDurable etc.), same as always.
// ---------------------------------------------------------------------
export async function reuseSourceSnapshotDurable(missionId, nodeId, library, { canonicalLocator, requiredTemporalClass = undefined }, clock) {
  const mission = readResearchMission(missionId)
  if (!mission) throw new Error(`unknown research mission: ${missionId}`)
  const node = findResearchNode(mission, nodeId)
  if (!node) throw new Error(`unknown research node: ${nodeId}`)
  const evaluation = evaluateSourceLibraryReuse(library, { sourcePolicy: mission.specification.sourcePolicy, canonicalLocator, requiredTemporalClass })
  if (evaluation.decision !== 'SOURCE_CACHE_HIT') {
    return { ok: true, reused: false, evaluation, mission }
  }
  const next = await withResearchMission(missionId, (m) => reuseSourceSnapshotIntoNode(m, nodeId, evaluation.hit, clock, m.revision))
  return { ok: true, reused: true, evaluation, mission: next }
}

// ---------------------------------------------------------------------
// PAID APPROVAL -- durable wrappers over domain/research-paid-approval.mjs,
// matching this file's own withResearchMission-per-mutation convention.
// grantResearchPaidApprovalDurable must only ever be called from a real,
// explicit owner instruction (Command's bridge parses "use X up to $Y"
// directly out of the owner's own chat message) -- never from inference.
// ---------------------------------------------------------------------
export async function grantResearchPaidApprovalDurable(missionId, approval, clock) {
  return withResearchMission(missionId, (mission) => {
    if (!mission) throw new Error(`unknown research mission: ${missionId}`)
    return grantResearchPaidApproval(mission, approval, clock, mission.revision)
  })
}

export async function requestResearchPaidApprovalDurable(missionId, request, clock) {
  return withResearchMission(missionId, (mission) => {
    if (!mission) throw new Error(`unknown research mission: ${missionId}`)
    return requestResearchPaidApproval(mission, request, clock, mission.revision)
  })
}

// Read-only -- true fail-closed default (null = no dispatch) lives in
// activeResearchPaidApproval itself; this is just the durable-read wrapper
// every other read function in this file already has a sibling for.
export function readActiveResearchPaidApproval(missionId, providerId, clock) {
  const mission = readResearchMission(missionId)
  if (!mission) return null
  return activeResearchPaidApproval(mission, providerId, clock)
}

// A convenience composite for a paid dispatch attempt gated on a real,
// scoped grant rather than the blunt global TSF_RESEARCH_LIVE_DISPATCH_ENABLED
// HTTP gate (that gate still separately applies to the HTTP surface; this
// is the Command-bridge's OWN, narrower gate for calling
// dispatchResearchNodeDurable directly, per NWR_HISTORICAL_REDRAFT_
// DATASET_RESEARCH_HANDOFF.md's own documented "call the driver function
// directly" path). Refuses with reason:'NO_PAID_APPROVAL' before touching
// anything else -- including before the existing delivery-guarantee resume
// check -- whenever no active, unexpired grant names this exact provider on
// this exact mission.
export async function dispatchResearchNodeWithApprovalDurable(missionId, nodeId, providerId, worker, clock, { pricingPolicy } = {}) {
  const mission = readResearchMission(missionId)
  if (!mission) throw new Error(`unknown research mission: ${missionId}`)
  const approval = activeResearchPaidApproval(mission, providerId, clock)
  if (!approval) {
    return { ok: false, reason: 'NO_PAID_APPROVAL', providerId }
  }
  return dispatchResearchNodeDurable(missionId, nodeId, providerId, worker, clock, {
    costGovernance: { pricingPolicy, maxApprovedSpendUsd: approval.maxSpendUsd }
  })
}

// ---------------------------------------------------------------------
// FREE-PATH PROGRESS -- the one generic, domain-agnostic "make free
// progress" step the Command bridge can safely call for an arbitrary
// mission: Research Library reuse (real, already-verified prior canonical
// facts) across every ready node's requested fields. Deliberately does NOT
// attempt bulk source acquisition itself -- discovering/acquiring NEW
// domain-specific sources is what a real setup/pilot script does (see
// NWR_HISTORICAL_REDRAFT_DATASET_RESEARCH_HANDOFF.md section 4); a generic
// chat bridge has no way to safely fabricate that per topic. One bounded
// pass over the nodes that were ready at call time -- not a fixed-point
// loop -- so a single chat turn's cost stays predictable.
// ---------------------------------------------------------------------
export async function attemptFreeResearchProgressDurable(missionId, clock) {
  const mission = readResearchMission(missionId)
  if (!mission) throw new Error(`unknown research mission: ${missionId}`)
  // An absent library (never used before, anywhere) is functionally the
  // same as a real, empty one for this read-only evaluation -- every field
  // still counts as a genuine, attempted-and-unresolved gap (CACHE_MISS),
  // never silently skipped as "nothing to attempt". createResearchLibrary
  // is never persisted here (attemptFreeResearchProgressDurable is
  // read/evaluate-only against the library; only a real library write
  // path, e.g. indexCanonicalFact via withResearchLibrary, ever creates it
  // durably) -- an in-memory stand-in is correct and sufficient.
  const library = readResearchLibrary() ?? createResearchLibrary(clock)
  const attempts = []
  for (const node of readyResearchNodes(mission)) {
    for (const field of node.requestedFields) {
      // eslint-disable-next-line no-await-in-loop -- each call is its own
      // durable, crash-safe commit; sequential by design, not an oversight.
      const result = await adoptResearchLibraryReuseDurable(
        missionId,
        node.id,
        field.fieldName,
        library,
        { valueType: field.valueType, decidedBy: 'COMMAND_FREE_PATH_AUTO' },
        clock
      )
      attempts.push({ nodeId: node.id, fieldName: field.fieldName, adopted: result.adopted })
    }
  }
  return {
    missionId,
    nodesConsidered: new Set(attempts.map((a) => a.nodeId)).size,
    fieldsAttempted: attempts.length,
    fieldsAdvanced: attempts.filter((a) => a.adopted).length,
    details: attempts
  }
}

// TSF Research Mission V1 -- durable, revisioned, checkpointed execution-state
// container for a research run. Modeled directly on
// tsf/domain/keep-going.mjs's TSF_OVERNIGHT_RUN_V1 pattern per CORRECTION
// WAVE 1's reuse map (THIN_EXTENSION): same optimistic-concurrency
// (revision/expectedRevision), same hash-chained checkpoint mechanism, same
// Needs You state machine -- new payload shape (nodes[], specification,
// expectedUniverse) instead of keep-going's code-delivery-specific
// waves/scope.
//
// EXECUTION STATE lives here (mission.state, node.status). RESEARCH
// EPISTEMIC STATE (Observation/Claim/Evidence/Verification/Conflict/
// ReconciliationDecision/CanonicalFact) lives inside each node's own arrays
// and is mutated only by research-admission.mjs / research-verification.mjs
// / research-reconciliation.mjs -- this module never inspects epistemic
// content, only node identity/dependencies/execution status. A node's
// COMPLETED execution status never implies VERIFIED or CANONICAL; see
// research-reconciliation.mjs's admitReconciliationDecision for the only
// path that may create a CanonicalFact.
import { assertExpectedRevision, deepClone, isoNow, sha256 } from './canonical.mjs'
import { topologicalOrder } from './delivery-scheduling.mjs'

export const RESEARCH_MISSION_STATES = Object.freeze([
  'ACTIVE',
  'NEEDS_YOU',
  'PAUSED',
  'COMPLETE',
  'BLOCKED'
])

const MISSION_ALLOWED = Object.freeze({
  ACTIVE: ['NEEDS_YOU', 'PAUSED', 'COMPLETE', 'BLOCKED'],
  NEEDS_YOU: ['ACTIVE', 'PAUSED', 'BLOCKED'],
  PAUSED: ['ACTIVE', 'BLOCKED'],
  COMPLETE: [],
  BLOCKED: ['ACTIVE', 'PAUSED']
})

// EXECUTION STATE only -- never conflated with epistemic status (see the
// Claim/Verification/Conflict/CanonicalFact status enums in
// research-epistemic-record.schema.v1.json). ADMITTED means "a
// BoundedResearchResult was structurally admitted into
// observations/claims" -- it says nothing about verification or
// canonicalization.
export const RESEARCH_NODE_EXECUTION_STATES = Object.freeze([
  'PENDING',
  'READY',
  'DISPATCHED',
  'RESULT_RECEIVED',
  'ADMITTED',
  'COMPLETED',
  'FAILED',
  'BLOCKED',
  'CANCELLED'
])

const NODE_ALLOWED = Object.freeze({
  PENDING: ['READY', 'CANCELLED'],
  READY: ['DISPATCHED', 'CANCELLED'],
  DISPATCHED: ['RESULT_RECEIVED', 'READY', 'FAILED'],
  RESULT_RECEIVED: ['ADMITTED', 'FAILED'],
  // A node stays open to further dispatch cycles after one result is
  // admitted -- e.g. a second provider call deliberately gathered for
  // cross-validation/conflict-detection. ADMITTED is "at least one result
  // was structurally admitted", not "no more research can ever be
  // dispatched for this node"; COMPLETED is the real terminal state.
  ADMITTED: ['READY', 'COMPLETED', 'BLOCKED'],
  COMPLETED: [],
  // FAILED -> ADMITTED (Trust + Scale Hardening, human review integration):
  // a LATER dispatch cycle can honestly fail (FAILED) after an EARLIER
  // cycle already produced real admitted claims -- admitBoundedResearchResult
  // restores ADMITTED rather than leaving the node looking like it has
  // nothing admitted, in exactly that one case (see its own guard: only
  // when next.claims.length > 0).
  FAILED: ['READY', 'BLOCKED', 'ADMITTED'],
  BLOCKED: ['READY'],
  CANCELLED: []
})

export function assertNodeTransition(fromStatus, toStatus) {
  if (!NODE_ALLOWED[fromStatus]?.includes(toStatus)) {
    const error = new Error(`invalid research node transition: ${fromStatus} -> ${toStatus}`)
    error.code = 'TSF_INVALID_RESEARCH_NODE_TRANSITION'
    throw error
  }
}

export function createResearchMission({ id, projectId, specification, expectedUniverse }, clock) {
  if (!id || !projectId) throw new Error('research mission requires id and projectId')
  if (specification?.schemaVersion !== 'TSF_RESEARCH_SPECIFICATION_V1') {
    throw new Error('research mission requires a valid ResearchSpecification')
  }
  if (expectedUniverse?.schemaVersion !== 'TSF_EXPECTED_UNIVERSE_V1') {
    throw new Error('research mission requires a valid ExpectedUniverse')
  }
  const createdAt = isoNow(clock)
  return {
    schemaVersion: 'TSF_RESEARCH_MISSION_V1',
    id,
    projectId,
    specification: deepClone(specification),
    expectedUniverse: deepClone(expectedUniverse),
    state: 'ACTIVE',
    revision: 0,
    nodes: [],
    checkpoints: [],
    needsYou: [],
    transitions: [{ from: null, to: 'ACTIVE', reason: 'RESEARCH_MISSION_CREATED', at: createdAt }],
    createdAt,
    updatedAt: createdAt
  }
}

export function transitionResearchMission(
  mission,
  to,
  { reason, evidence = [], expectedRevision } = {},
  clock
) {
  if (!RESEARCH_MISSION_STATES.includes(to)) throw new Error(`unknown research mission state: ${to}`)
  assertExpectedRevision(mission, expectedRevision)
  if (!MISSION_ALLOWED[mission.state]?.includes(to)) {
    const error = new Error(`invalid research mission transition: ${mission.state} -> ${to}`)
    error.code = 'TSF_INVALID_RESEARCH_MISSION_TRANSITION'
    throw error
  }
  const next = deepClone(mission)
  const at = isoNow(clock)
  next.transitions.push({ from: next.state, to, reason: reason ?? 'UNSPECIFIED', evidence, at })
  next.state = to
  next.revision += 1
  next.updatedAt = at
  return next
}

export const pauseResearchMission = (mission, reason, clock, expectedRevision) =>
  transitionResearchMission(mission, 'PAUSED', { reason: reason ?? 'OPERATOR_PAUSE', expectedRevision }, clock)
export const resumeResearchMission = (mission, clock, expectedRevision) =>
  transitionResearchMission(mission, 'ACTIVE', { reason: 'OPERATOR_RESUME', expectedRevision }, clock)
export const completeResearchMission = (mission, clock, expectedRevision) =>
  transitionResearchMission(mission, 'COMPLETE', { reason: 'RESEARCH_MISSION_SATISFIED', expectedRevision }, clock)
export const blockResearchMission = (mission, reason, evidence, clock, expectedRevision) =>
  transitionResearchMission(mission, 'BLOCKED', { reason, evidence, expectedRevision }, clock)

function emptyEpistemicArrays() {
  return {
    dispatchAttempts: [],
    dispatchRecords: [],
    rawResults: [],
    admittedResultDigests: [],
    observations: [],
    claims: [],
    evidence: [],
    sourceReferences: [],
    sourceSnapshots: [],
    typedMissingness: [],
    identityResolutionState: null,
    verifications: [],
    conflicts: [],
    reconciliationDecisions: [],
    canonicalFacts: [],
    gapProposals: []
  }
}

// Idempotent by node id -- adding the same node id twice (e.g. a replayed
// specification-decomposition call) is a no-op, matching this codebase's
// established idempotent-append convention (recordWave, registerWorkerResult).
export function addResearchNode(mission, nodeInput, clock, expectedRevision) {
  if (!nodeInput?.id) throw new Error('research node requires an id')
  if (mission.nodes.some((n) => n.id === nodeInput.id)) return deepClone(mission)
  assertExpectedRevision(mission, expectedRevision)
  const dependencies = [...(nodeInput.dependencies ?? [])]
  const knownIds = new Set(mission.nodes.map((n) => n.id))
  for (const dep of dependencies) {
    if (dep !== nodeInput.id && !knownIds.has(dep)) {
      throw new Error(`research node ${nodeInput.id} depends on unknown node ${dep}`)
    }
  }
  const node = {
    id: nodeInput.id,
    parentId: nodeInput.parentId ?? null,
    dependencies,
    conflictsWith: [...(nodeInput.conflictsWith ?? [])],
    nodeRole: nodeInput.nodeRole,
    targetEntity: deepClone(nodeInput.targetEntity ?? null),
    requestedFields: deepClone(nodeInput.requestedFields ?? []),
    requestedOutputSchema: deepClone(nodeInput.requestedOutputSchema ?? {}),
    priority: nodeInput.priority ?? 0,
    status: 'PENDING',
    attempts: [],
    retryCount: 0,
    ...emptyEpistemicArrays()
  }
  const next = deepClone(mission)
  next.nodes.push(node)
  // Fail fast on a real dependency cycle -- reuses delivery-scheduling.mjs's
  // Kahn's-algorithm cycle detector directly (REUSE_DIRECTLY per the
  // CORRECTION WAVE 1 reuse map) rather than a bespoke research-specific
  // cycle check.
  topologicalOrder(next.nodes.map((n) => ({ id: n.id, dependencies: n.dependencies })))
  next.revision += 1
  next.updatedAt = isoNow(clock)
  return next
}

export function findResearchNode(mission, nodeId) {
  return mission.nodes.find((n) => n.id === nodeId) ?? null
}

// A node is READY once every dependency is COMPLETED (or CANCELLED, which
// never blocks downstream work). Reuses topologicalOrder's own dependency
// data, not a bespoke readiness computation.
export function readyResearchNodes(mission) {
  const completed = new Set(
    mission.nodes.filter((n) => n.status === 'COMPLETED' || n.status === 'CANCELLED').map((n) => n.id)
  )
  return mission.nodes.filter(
    (n) => n.status === 'PENDING' && n.dependencies.every((d) => completed.has(d))
  )
}

// The single mutation primitive every other research-*.mjs module builds
// on: computeFn(node) returns { next, changed }. changed:false is a true
// idempotent no-op (returns the mission unchanged, no revision check, no
// bump) -- exactly recordWave's "a genuine idempotent replay needs no
// revision protection" convention, generalized to per-node mutation. Because
// every node mutation funnels through this ONE mission-level revision
// counter, TSF's existing expectedRevision optimistic-concurrency primitive
// covers concurrent completions across DIFFERENT nodes of the SAME mission
// without inventing a second synchronization mechanism.
export function withResearchNode(mission, nodeId, computeFn, clock, expectedRevision) {
  const node = findResearchNode(mission, nodeId)
  if (!node) {
    const error = new Error(`unknown research node: ${nodeId}`)
    error.code = 'TSF_UNKNOWN_RESEARCH_NODE'
    throw error
  }
  const { next: nextNode, changed } = computeFn(deepClone(node))
  if (!changed) return deepClone(mission)
  assertExpectedRevision(mission, expectedRevision)
  const next = deepClone(mission)
  const idx = next.nodes.findIndex((n) => n.id === nodeId)
  next.nodes[idx] = nextNode
  next.revision += 1
  next.updatedAt = isoNow(clock)
  return next
}

// Durable, hash-chained checkpoint -- identical mechanism to
// keep-going.mjs's checkpointRun (REUSE_DIRECTLY of the pattern).
export function checkpointResearchMission(
  mission,
  { phase, note = null, evidence = [] } = {},
  clock,
  expectedRevision
) {
  if (!phase?.trim()) throw new Error('a phase label is required to checkpoint')
  assertExpectedRevision(mission, expectedRevision)
  const at = isoNow(clock)
  const record = { phase, note, evidence, nodeCount: mission.nodes.length, state: mission.state, at }
  const previousHash = mission.checkpoints.at(-1)?.hash ?? null
  const hash = sha256({ previousHash, record })
  const next = deepClone(mission)
  next.checkpoints.push({ ...record, previousHash, hash })
  next.revision += 1
  next.updatedAt = at
  return next
}

export function recentCheckpointTrail(mission, limit = 5) {
  return mission.checkpoints.slice(-limit).map(({ phase, note, at }) => ({ phase, note, at }))
}

// Needs You -- identical mechanism to keep-going.mjs's raiseNeedsYou/
// resolveNeedsYou (REUSE_DIRECTLY). Used here for execution-level blockers
// (e.g. a provider outage) as well as epistemic escalations (e.g. an
// unresolved identity-alias case) -- research-reconciliation.mjs raises
// these for epistemic reasons, this module only holds the mechanism.
// Named review categories -- reuses TSF's existing Needs You mechanism
// (proven live in the bake-off's Jim Miller signingBonusUsd escalation)
// rather than a new review-queue framework. `category` is optional and
// purely classificatory (never gates behavior) so existing callers that
// omit it are unaffected. Only durable, consequential ambiguity should
// reach here -- ordinary missing values are typed missingness, not a
// human interrupt.
export const RESEARCH_NEEDS_YOU_CATEGORIES = Object.freeze([
  'AMBIGUOUS_IDENTITY',
  'UNRESOLVED_CONFLICT',
  'SOURCE_LICENSE_UNCLEAR',
  'UNIVERSE_AMBIGUITY',
  'SCHEMA_AMBIGUITY',
  'HIGH_RISK_CLAIM',
  'SOURCE_UNAVAILABLE'
])

export function raiseResearchNeedsYou(
  mission,
  { question, options = [], nodeId = null, category = null },
  clock,
  expectedRevision
) {
  if (!question?.trim()) throw new Error('a question is required to raise Needs You')
  if (category != null && !RESEARCH_NEEDS_YOU_CATEGORIES.includes(category)) {
    throw new Error(`unknown research Needs You category: ${category}`)
  }
  assertExpectedRevision(mission, expectedRevision)
  const at = isoNow(clock)
  const next = deepClone(mission)
  next.needsYou.push({
    id: sha256({ question, nodeId, at, ordinal: next.needsYou.length }),
    question,
    options,
    nodeId,
    category,
    raisedAt: at,
    resolvedAt: null,
    resolution: null
  })
  if (next.state === 'NEEDS_YOU') {
    next.revision += 1
    next.updatedAt = at
    return next
  }
  return transitionResearchMission(next, 'NEEDS_YOU', { reason: 'HUMAN_DECISION_REQUIRED', evidence: nodeId ? [nodeId] : [] }, clock)
}

// Trust + Scale Hardening (human review integration): the graceful
// counterpart to a hard failure -- a node whose retry budget is exhausted
// (recordResearchNodeAttempt's TSF_RESEARCH_RETRY_BUDGET_EXCEEDED) or whose
// dispatch cleanly and repeatedly FAILED should never crash the whole
// orchestration driver. This atomically blocks the ONE affected node
// (execution state, from FAILED or ADMITTED only -- the node-status
// transition table's real legal sources for BLOCKED) and raises a real,
// human-reviewable Needs You for it, so independent, unrelated nodes in the
// same mission can keep making progress (never a global halt for one
// node's problem).
export function escalateResearchNodeToNeedsYou(mission, nodeId, { question, category = 'SOURCE_UNAVAILABLE' }, clock, expectedRevision) {
  assertExpectedRevision(mission, expectedRevision)
  const node = findResearchNode(mission, nodeId)
  if (!node) throw new Error(`unknown research node: ${nodeId}`)
  assertNodeTransition(node.status, 'BLOCKED')
  const next = deepClone(mission)
  const idx = next.nodes.findIndex((n) => n.id === nodeId)
  next.nodes[idx] = { ...next.nodes[idx], status: 'BLOCKED' }
  next.revision += 1
  next.updatedAt = isoNow(clock)
  return raiseResearchNeedsYou(next, { question: question ?? `Research node ${nodeId} could not be completed and needs human review.`, nodeId, category }, clock, next.revision)
}

export function resolveResearchNeedsYou(mission, needsYouId, resolution, clock, expectedRevision) {
  const index = mission.needsYou.findIndex((entry) => entry.id === needsYouId)
  if (index === -1) throw new Error(`unknown Needs You question: ${needsYouId}`)
  assertExpectedRevision(mission, expectedRevision)
  const next = deepClone(mission)
  next.needsYou[index] = { ...next.needsYou[index], resolvedAt: isoNow(clock), resolution }
  next.updatedAt = isoNow(clock)
  const stillOpen = next.needsYou.some((entry) => !entry.resolvedAt)
  if (stillOpen || next.state !== 'NEEDS_YOU') {
    next.revision += 1
    return next
  }
  return transitionResearchMission(next, 'ACTIVE', { reason: 'ALL_NEEDS_YOU_RESOLVED' }, clock)
}

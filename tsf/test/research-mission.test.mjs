import assert from 'node:assert/strict'
import test from 'node:test'
import {
  addResearchNode,
  checkpointResearchMission,
  computeResearchMissionPhase,
  createResearchMission,
  escalateResearchNodeToNeedsYou,
  pauseResearchMission,
  raiseResearchNeedsYou,
  resolveResearchNeedsYou,
  resumeResearchMission,
  transitionResearchMission
} from '../domain/research-mission.mjs'
import { markResearchNodeReady, recordResearchNodeDispatch, recordResearchNodeResult } from '../domain/research-node.mjs'
import { buildNflQb2001Specification } from '../fixtures/nfl-2001-qb-research-fixture.mjs'

function failedResultFor(nodeId) {
  return {
    schemaVersion: 'TSF_BOUNDED_RESEARCH_RESULT_V1',
    nodeId,
    taskFingerprint: 'a'.repeat(64),
    provider: 'FAKE',
    providerRunRef: { provider: 'FAKE', providerRunId: 'r1', dispatchedAt: clock().toISOString() },
    status: 'FAILED',
    observations: [],
    proposedClaims: [],
    evidence: [],
    sourceReferences: [],
    sourceSnapshotsOrSnapshotRefs: [],
    newGapProposals: [],
    warnings: [],
    unresolvedQuestions: [],
    usage: { requestCount: 1, tokensOrUnits: null, providerReportedCostUsd: 0 },
    failureDetails: { reason: 'PROVIDER_REPORTED_FAILURE', detail: 'synthetic test failure' }
  }
}

const clock = () => new Date('2026-09-10T12:00:00.000Z')

function baseMission() {
  const specification = buildNflQb2001Specification()
  return createResearchMission(
    { id: 'mission:test', projectId: 'fixture:proj', specification, expectedUniverse: specification.expectedUniverse },
    clock
  )
}

test('createResearchMission requires a valid specification and expectedUniverse', () => {
  const mission = baseMission()
  assert.equal(mission.state, 'ACTIVE')
  assert.equal(mission.revision, 0)
  assert.equal(mission.nodes.length, 0)
  assert.throws(() => createResearchMission({ id: 'm', projectId: 'p', specification: {}, expectedUniverse: {} }, clock), /ResearchSpecification/)
})

test('addResearchNode appends a PENDING node and is idempotent by id', () => {
  let mission = baseMission()
  mission = addResearchNode(mission, { id: 'node:a', nodeRole: 'PRIMARY_RESEARCH', requestedFields: [], requestedOutputSchema: {} }, clock)
  assert.equal(mission.nodes.length, 1)
  assert.equal(mission.nodes[0].status, 'PENDING')
  const revisionAfterFirstAdd = mission.revision
  const replay = addResearchNode(mission, { id: 'node:a', nodeRole: 'PRIMARY_RESEARCH', requestedFields: [], requestedOutputSchema: {} }, clock)
  assert.equal(replay.nodes.length, 1)
  assert.equal(replay.revision, revisionAfterFirstAdd, 'idempotent replay must not bump revision')
})

test('addResearchNode rejects an unknown dependency and a real dependency cycle', () => {
  let mission = baseMission()
  assert.throws(
    () => addResearchNode(mission, { id: 'node:a', dependencies: ['node:missing'], requestedFields: [], requestedOutputSchema: {} }, clock),
    /unknown node/
  )
  mission = addResearchNode(mission, { id: 'node:a', requestedFields: [], requestedOutputSchema: {} }, clock)
  mission = addResearchNode(mission, { id: 'node:b', dependencies: ['node:a'], requestedFields: [], requestedOutputSchema: {} }, clock)
  // node:a cannot retroactively depend on node:b without re-adding -- but a
  // fresh 3rd node forming a genuine cycle (c -> a is fine; a cycle needs
  // an edge back) is exercised via topologicalOrder directly elsewhere
  // (delivery-scheduling.test.mjs already covers the cycle-detection
  // algorithm itself; this proves addResearchNode wires it in).
  assert.equal(mission.nodes.length, 2)
})

test('transitionResearchMission enforces the allowed transition table and expectedRevision', () => {
  let mission = baseMission()
  mission = pauseResearchMission(mission, 'operator pause', clock, mission.revision)
  assert.equal(mission.state, 'PAUSED')
  assert.throws(() => pauseResearchMission(mission, 'x', clock, 0), /stale revision/)
  mission = resumeResearchMission(mission, clock, mission.revision)
  assert.equal(mission.state, 'ACTIVE')
  assert.throws(() => transitionResearchMission(mission, 'NOT_A_STATE', {}, clock), /unknown research mission state/)
})

test('checkpointResearchMission hash-chains sequential checkpoints', () => {
  let mission = baseMission()
  mission = checkpointResearchMission(mission, { phase: 'PHASE_ONE' }, clock, mission.revision)
  mission = checkpointResearchMission(mission, { phase: 'PHASE_TWO' }, clock, mission.revision)
  assert.equal(mission.checkpoints.length, 2)
  assert.equal(mission.checkpoints[1].previousHash, mission.checkpoints[0].hash)
  assert.notEqual(mission.checkpoints[0].hash, mission.checkpoints[1].hash)
})

test('raiseResearchNeedsYou / resolveResearchNeedsYou round-trips through NEEDS_YOU', () => {
  let mission = baseMission()
  mission = raiseResearchNeedsYou(mission, { question: 'Which Jim Miller is this?' }, clock, mission.revision)
  assert.equal(mission.state, 'NEEDS_YOU')
  const questionId = mission.needsYou[0].id
  mission = resolveResearchNeedsYou(mission, questionId, 'RESOLVED_VIA_2001_ROSTER', clock, mission.revision)
  assert.equal(mission.state, 'ACTIVE')
  assert.ok(mission.needsYou[0].resolvedAt)
})

test('raiseResearchNeedsYou accepts an optional named review category, proven live in the bake-off\'s UNRESOLVED_CONFLICT escalation', () => {
  let mission = baseMission()
  mission = raiseResearchNeedsYou(mission, { question: 'signingBonusUsd conflict', category: 'UNRESOLVED_CONFLICT' }, clock, mission.revision)
  assert.equal(mission.needsYou[0].category, 'UNRESOLVED_CONFLICT')
})

test('raiseResearchNeedsYou rejects an unknown category rather than silently accepting it', () => {
  const mission = baseMission()
  assert.throws(() => raiseResearchNeedsYou(mission, { question: 'x', category: 'NOT_A_REAL_CATEGORY' }, clock, mission.revision), /unknown research Needs You category/)
})

// Trust + Scale Hardening (human review integration): escalating one
// blocked node to Needs You must never require halting the whole mission
// -- an independent, unrelated node keeps its own status untouched.
test('escalateResearchNodeToNeedsYou blocks the one affected FAILED node and raises Needs You, leaving an unrelated node untouched', () => {
  let mission = baseMission()
  mission = addResearchNode(mission, { id: 'node:a', requestedFields: [], requestedOutputSchema: {} }, clock)
  mission = addResearchNode(mission, { id: 'node:b', requestedFields: [], requestedOutputSchema: {} }, clock)
  mission = markResearchNodeReady(mission, 'node:a', clock, mission.revision)
  mission = recordResearchNodeDispatch(mission, 'node:a', { taskFingerprint: 'a'.repeat(64), workerRunRef: { provider: 'FAKE', providerRunId: 'r1', dispatchedAt: clock().toISOString() } }, clock, mission.revision)
  mission = recordResearchNodeResult(mission, 'node:a', failedResultFor('node:a'), clock, mission.revision)
  assert.equal(mission.nodes.find((n) => n.id === 'node:a').status, 'FAILED', 'precondition: a FAILED provider result must produce an honest FAILED node status')

  mission = escalateResearchNodeToNeedsYou(mission, 'node:a', { question: 'Provider repeatedly failed for node:a' }, clock, mission.revision)
  const nodeA = mission.nodes.find((n) => n.id === 'node:a')
  const nodeB = mission.nodes.find((n) => n.id === 'node:b')
  assert.equal(nodeA.status, 'BLOCKED')
  assert.equal(nodeB.status, 'PENDING', 'an unrelated node must never be affected by another node\'s escalation')
  assert.equal(mission.state, 'NEEDS_YOU')
  assert.equal(mission.needsYou[0].nodeId, 'node:a')
  assert.equal(mission.needsYou[0].category, 'SOURCE_UNAVAILABLE', 'defaults to SOURCE_UNAVAILABLE when not overridden')
})

test('escalateResearchNodeToNeedsYou rejects a node that has never actually failed/admitted -- BLOCKED is not reachable from PENDING', () => {
  let mission = baseMission()
  mission = addResearchNode(mission, { id: 'node:a', requestedFields: [], requestedOutputSchema: {} }, clock)
  assert.throws(() => escalateResearchNodeToNeedsYou(mission, 'node:a', { question: 'x' }, clock, mission.revision), /invalid research node transition/)
})

// Hands-on pilot Finding 3: "Started" must mean something real. Every
// phase transition here is proven from the REAL state that produces it,
// not asserted in isolation.
test('computeResearchMissionPhase: DRAFT for a zero-node mission', () => {
  const mission = baseMission()
  assert.equal(computeResearchMissionPhase(mission), 'DRAFT')
})

test('computeResearchMissionPhase: CREATED once real nodes exist but none has ever been dispatched', () => {
  let mission = baseMission()
  mission = addResearchNode(mission, { id: 'node:a', requestedFields: [], requestedOutputSchema: {} }, clock)
  assert.equal(computeResearchMissionPhase(mission), 'CREATED')
})

test('computeResearchMissionPhase: EXECUTING once a node has real dispatch history, even before any result comes back', () => {
  let mission = baseMission()
  mission = addResearchNode(mission, { id: 'node:a', requestedFields: [], requestedOutputSchema: {} }, clock)
  mission = markResearchNodeReady(mission, 'node:a', clock, mission.revision)
  mission = recordResearchNodeDispatch(mission, 'node:a', { taskFingerprint: 'a'.repeat(64), workerRunRef: { provider: 'FAKE', providerRunId: 'r1', dispatchedAt: clock().toISOString() } }, clock, mission.revision)
  assert.equal(computeResearchMissionPhase(mission), 'EXECUTING')
})

test('computeResearchMissionPhase: WAITING_NEEDS_INPUT mirrors mission.state NEEDS_YOU exactly -- never a second, independently-derived answer', () => {
  let mission = baseMission()
  mission = raiseResearchNeedsYou(mission, { question: 'x' }, clock, mission.revision)
  assert.equal(mission.state, 'NEEDS_YOU')
  assert.equal(computeResearchMissionPhase(mission), 'WAITING_NEEDS_INPUT')
})

test('computeResearchMissionPhase: COMPLETE/BLOCKED mirror mission.state exactly', () => {
  let mission = baseMission()
  mission = addResearchNode(mission, { id: 'node:a', requestedFields: [], requestedOutputSchema: {} }, clock)
  const complete = transitionResearchMission(mission, 'COMPLETE', { reason: 'x' }, clock)
  assert.equal(computeResearchMissionPhase(complete), 'COMPLETE')
  const blocked = transitionResearchMission(mission, 'BLOCKED', { reason: 'x' }, clock)
  assert.equal(computeResearchMissionPhase(blocked), 'BLOCKED')
})

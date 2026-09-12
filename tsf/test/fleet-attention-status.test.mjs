import assert from 'node:assert/strict'
import test from 'node:test'
import { ATTENTION_CATEGORIES, buildFleetAttentionItems, trimAttentionItem } from '../domain/fleet-attention-status.mjs'
import { createProjectExecutionHold, releaseProjectExecutionHold } from '../domain/project-execution-hold.mjs'
import {
  createOvernightRun,
  markStalled,
  raiseNeedsYou,
  completeRun,
  checkpointRun,
  recordPendingDispatch
} from '../domain/keep-going.mjs'
import {
  addResearchNode,
  createResearchMission,
  raiseResearchNeedsYou,
  transitionResearchMission
} from '../domain/research-mission.mjs'
import { recordDispatchAttempt } from '../domain/research-dispatch-bookkeeping.mjs'
import { createFinding, transitionFinding } from '../domain/self-improvement-finding.mjs'
import { buildResourcePressureState } from '../domain/resource-pressure-governor.mjs'
import { createPlannerMissionCheckpoint, recordResourceState } from '../domain/planner-mission-checkpoint.mjs'
import { computeRepairMissionId } from '../server/self-improvement-mission-origination.mjs'

const clock = () => new Date('2026-09-07T12:00:00.000Z')

function project(id, overrides = {}) {
  return {
    id,
    displayName: id,
    mission: { state: 'ONBOARDED', id: null, blockedReason: null },
    candidate: null,
    receipts: { chain: [] },
    ...overrides
  }
}

function newRun(id, projectId) {
  return createOvernightRun({ id, projectId, originalGoal: 'Fix it.', acceptanceCriteria: ['X'] }, clock)
}

function baseMissionSpec() {
  return {
    schemaVersion: 'TSF_RESEARCH_SPECIFICATION_V1',
    id: 'spec:x',
    researchQuestion: 'q',
    entityType: 'FIXTURE',
    requestedFields: [],
    sourcePolicy: {
      preferredSources: [],
      disallowedSources: [],
      licensingConstraints: [],
      freshnessPolicy: 'UNSPECIFIED',
      requireIndependentSources: false,
      minSourceCount: 0,
      allowCrossMissionLibraryReuse: true
    },
    temporalRequirements: { asOfDate: '2026-09-07', periodScope: 'UNSPECIFIED' },
    budget: { maxCostUsd: 0, maxLatencyMs: null, maxToolCallsPerNode: null },
    toolPermissions: []
  }
}

function baseMission(id, overrides = {}) {
  return createResearchMission(
    {
      id,
      projectId: 'test',
      specification: baseMissionSpec(),
      expectedUniverse: { schemaVersion: 'TSF_EXPECTED_UNIVERSE_V1', entityType: 'FIXTURE', expectedCount: 1, expectedEntities: [] },
      ...overrides
    },
    clock
  )
}

function rawFinding(overrides = {}) {
  return {
    sourceDetector: 'GOLDEN_PATH_EVAL',
    severity: 'P2',
    evidence: { caseId: 'case-1' },
    reproduction: { command: 'node --test' },
    affectedSurface: 'golden-path:platform',
    confidence: 0.8,
    verificationMethod: 'EVAL_PACK_RERUN',
    ...overrides
  }
}

function repairFinding(affectedSurface, status = 'FIX_MISSION_CREATED') {
  let finding = createFinding(rawFinding({ affectedSurface }), clock)
  for (const nextStatus of ['VERIFIED', 'ELIGIBLE_FOR_AUTOFIX', 'FIX_MISSION_CREATED']) {
    finding = transitionFinding(finding, nextStatus, { reason: 'x' }, clock)
  }
  return status === 'FIX_IN_PROGRESS'
    ? transitionFinding(finding, 'FIX_IN_PROGRESS', { reason: 'x' }, clock)
    : finding
}

function plannerRecordForRepair(finding, resourceState = null) {
  const missionId = computeRepairMissionId(finding.findingId)
  let checkpoint = createPlannerMissionCheckpoint(
    { missionId, missionGoal: 'repair', phase: 'REPAIR_DISPATCH', repoState: { branch: 'main', sha: 'a'.repeat(40) } },
    clock
  )
  if (resourceState) { checkpoint = recordResourceState(checkpoint, resourceState, clock) }
  return [missionId, { lease: null, checkpoint }]
}

test('empty everything -> empty array', () => {
  assert.deepEqual(buildFleetAttentionItems({ projects: [], clock }), [])
})

test('NEEDS_OWNER: a PROJECT needsYou item is categorized correctly with a real changedAt and deepLink', () => {
  let run = raiseNeedsYou(newRun('r1', 'p1'), { question: 'Which provider?' }, clock, 0)
  const items = buildFleetAttentionItems({
    projects: [project('p1', { displayName: 'Project One' })],
    keepGoingRuns: { p1: run },
    clock
  })
  assert.equal(items.length, 1)
  const item = items[0]
  assert.equal(item.category, 'NEEDS_OWNER')
  assert.equal(item.severity, 'P1')
  assert.deepEqual(item.project, { id: 'p1', displayName: 'Project One' })
  assert.equal(item.reason, 'Which provider?')
  assert.equal(item.changedAt, run.needsYou[0].raisedAt)
  assert.deepEqual(item.deepLink, { kind: 'PROJECT', id: 'p1' })
  assert.deepEqual(item.source, { kind: 'KEEP_GOING_RUN', id: 'p1' })
})

test('NEEDS_OWNER: a RESEARCH needsYou item resolves a real missionId deepLink via origin lookup', () => {
  let mission = baseMission('mission:needs')
  mission = raiseResearchNeedsYou(mission, { question: 'approve paid access?' }, clock, mission.revision)
  const items = buildFleetAttentionItems({
    projects: [],
    researchMissions: { [mission.id]: mission },
    clock
  })
  assert.equal(items.length, 1)
  assert.equal(items[0].category, 'NEEDS_OWNER')
  assert.deepEqual(items[0].deepLink, { kind: 'RESEARCH_MISSION', id: mission.id })
  assert.equal(items[0].changedAt, mission.needsYou[0].raisedAt)
})

test('NEEDS_OWNER: a PLANNER needsYou item never fabricates a project', async () => {
  const { createPlannerMissionCheckpoint, raisePlannerNeedsYou } = await import('../domain/planner-mission-checkpoint.mjs')
  let checkpoint = createPlannerMissionCheckpoint(
    { missionId: 'planner-x', missionGoal: 'ship it', phase: 'BUILD', repoState: { branch: 'main', sha: 'a'.repeat(40) } },
    clock
  )
  checkpoint = raisePlannerNeedsYou(checkpoint, { question: 'auth needed' }, clock)
  const items = buildFleetAttentionItems({
    projects: [],
    plannerMissionRecords: { 'planner-x': { lease: null, checkpoint } },
    clock
  })
  assert.equal(items.length, 1)
  assert.equal(items[0].project, null)
  assert.deepEqual(items[0].deepLink, { kind: 'PLANNER_MISSION', id: 'planner-x' })
  assert.equal(items[0].changedAt, checkpoint.needsYou[0].at)
})

test('FAILED_REQUIRES_ATTENTION: a STALLED run appears correctly categorized', () => {
  const run = markStalled(newRun('r1', 'p1'), [], clock)
  const items = buildFleetAttentionItems({
    projects: [project('p1', { displayName: 'Project One' })],
    keepGoingRuns: { p1: run },
    clock
  })
  assert.equal(items.length, 1)
  assert.equal(items[0].category, 'FAILED_REQUIRES_ATTENTION')
  assert.equal(items[0].severity, 'P1')
  assert.match(items[0].reason, /STALLED/)
})

test('READY_FOR_ADOPTION: a COMPLETE run appears correctly categorized', () => {
  const run = completeRun(newRun('r1', 'p1'), clock)
  const items = buildFleetAttentionItems({
    projects: [project('p1', { displayName: 'Project One' })],
    keepGoingRuns: { p1: run },
    clock
  })
  assert.equal(items.length, 1)
  assert.equal(items[0].category, 'READY_FOR_ADOPTION')
  assert.equal(items[0].severity, 'P2')
})

// Real finding #11 (disclosed earlier this mission, fixed here, end-to-end
// at the one real aggregation choke point both the Work page and this
// attention feed read from): a COMPLETE run whose exact candidate has
// ALREADY been really adopted (a real git merge, durably tracked by
// project-canonical-base-store.mjs's own ADVANCED history) must stop
// appearing as READY_FOR_ADOPTION and instead appear as COMPLETED_RECENTLY
// with an honest reason -- an operator asking "is X ready for adoption?"
// or "what just finished?" must never get a stale answer about a project
// this very system already adopted.
test('finding #11: a COMPLETE run with a matching real ADVANCED canonical-base entry is COMPLETED_RECENTLY, not stale READY_FOR_ADOPTION', () => {
  const run = completeRun(newRun('r1', 'p1'), clock)
  const projectCanonicalBases = {
    p1: {
      history: [
        { action: 'ADVANCED', ref: 'refs/heads/main', resultingSha: 'deadbeef', missionId: run.id, at: '2026-09-07T10:00:00.000Z' }
      ]
    }
  }
  const items = buildFleetAttentionItems({
    projects: [project('p1', { displayName: 'Project One' })],
    keepGoingRuns: { p1: run },
    projectCanonicalBases,
    clock
  })
  assert.equal(items.length, 1)
  assert.equal(items[0].category, 'COMPLETED_RECENTLY')
  assert.equal(items[0].severity, 'P3')
  assert.equal(items[0].changedAt, '2026-09-07T10:00:00.000Z')
  assert.match(items[0].reason, /real adoption merge landed/)
  assert.deepEqual(items[0].source, { kind: 'KEEP_GOING_RUN', id: 'p1' })
})

// Backward compatible: the pre-fix test above (no projectCanonicalBases
// passed) still classifies as READY_FOR_ADOPTION -- proves the default {}
// preserves exact prior behavior for every not-yet-threaded caller.
test('finding #11: omitting projectCanonicalBases entirely preserves the pre-fix READY_FOR_ADOPTION classification', () => {
  const run = completeRun(newRun('r2', 'p2'), clock)
  const items = buildFleetAttentionItems({
    projects: [project('p2', { displayName: 'Project Two' })],
    keepGoingRuns: { p2: run },
    clock
  })
  assert.equal(items.length, 1)
  assert.equal(items[0].category, 'READY_FOR_ADOPTION')
})

test('BLOCKED_EXTERNAL: a legacy blocked project appears with an honest null changedAt (no real per-item timestamp exists)', () => {
  const p = project('p1', { mission: { state: 'BLOCKED_SOMETHING', id: null, blockedReason: 'waiting on legal review' } })
  const items = buildFleetAttentionItems({ projects: [p], clock })
  assert.equal(items.length, 1)
  assert.equal(items[0].category, 'BLOCKED_EXTERNAL')
  assert.equal(items[0].reason, 'waiting on legal review')
  assert.equal(items[0].changedAt, null)
})

test('BLOCKED_EXTERNAL: a BLOCKED research mission appears with a real changedAt and reason from its own transitions', () => {
  let mission = baseMission('mission:blocked')
  mission = transitionResearchMission(mission, 'BLOCKED', { reason: 'no legal source found', expectedRevision: mission.revision }, clock)
  const items = buildFleetAttentionItems({ projects: [], researchMissions: { [mission.id]: mission }, clock })
  assert.equal(items.length, 1)
  assert.equal(items[0].category, 'BLOCKED_EXTERNAL')
  assert.equal(items[0].reason, 'no legal source found')
  assert.equal(items[0].changedAt, mission.updatedAt)
  assert.deepEqual(items[0].deepLink, { kind: 'RESEARCH_MISSION', id: mission.id })
})

// Multi-Project Command + Real Fleet Orchestration Overnight V1, Part B:
// a real, active project execution hold is a real, honest BLOCKED_EXTERNAL
// attention-worthy fact, sourced from the new durable store -- never the
// legacy mission.blockedReason/research-mission shapes that category
// already mixes.
test('BLOCKED_EXTERNAL: an active project execution hold appears, sourced from the real hold record', () => {
  const p = project('niners-war-room', { displayName: 'NWR' })
  const hold = createProjectExecutionHold(
    { projectId: 'niners-war-room', reason: 'EXTERNAL_WORK_ACTIVE', setBy: 'OPERATOR_CHAT', note: 'another AI is actively working this repo' },
    clock
  )
  const items = buildFleetAttentionItems({ projects: [p], projectExecutionHolds: { [hold.projectId]: hold }, clock })
  assert.equal(items.length, 1)
  assert.equal(items[0].category, 'BLOCKED_EXTERNAL')
  assert.equal(items[0].reason, 'another AI is actively working this repo')
  assert.deepEqual(items[0].project, { id: 'niners-war-room', displayName: 'NWR' })
  assert.deepEqual(items[0].source, { kind: 'PROJECT_EXECUTION_HOLD', id: 'niners-war-room' })
})

test('BLOCKED_EXTERNAL: a RELEASED hold produces no item -- it is no longer a real, live attention fact', () => {
  const p = project('niners-war-room')
  const hold = createProjectExecutionHold({ projectId: 'niners-war-room', reason: 'EXTERNAL_WORK_ACTIVE', setBy: 'x' }, clock)
  const released = releaseProjectExecutionHold(hold, { releasedBy: 'x' }, clock)
  const items = buildFleetAttentionItems({ projects: [p], projectExecutionHolds: { [released.projectId]: released }, clock })
  assert.deepEqual(items, [])
})

test('trimAttentionItem: keeps only the bounded referent-resolution fields, honestly null project when absent', () => {
  const p = project('p1', { displayName: 'P One' })
  const hold = createProjectExecutionHold({ projectId: 'p1', reason: 'EXTERNAL_WORK_ACTIVE', setBy: 'x', note: 'held' }, clock)
  const [item] = buildFleetAttentionItems({ projects: [p], projectExecutionHolds: { p1: hold }, clock })
  const trimmed = trimAttentionItem(item)
  assert.deepEqual(trimmed, {
    id: item.id,
    category: 'BLOCKED_EXTERNAL',
    label: 'P One',
    project: { id: 'p1', displayName: 'P One' },
    reason: 'held'
  })
  assert.equal('deepLink' in trimmed, false)
  assert.equal('severity' in trimmed, false)
  assert.equal('changedAt' in trimmed, false)
  assert.equal('source' in trimmed, false)

  const noProjectItem = { id: 'x', category: 'NEEDS_OWNER', label: 'L', project: null, reason: 'r' }
  assert.equal(trimAttentionItem(noProjectItem).project, null)
})

test('COMPLETED_RECENTLY: excludes legacy ADOPTED projects (Tim already knows -- operator-driven, not a real completion)', () => {
  const adopted = project('p1', {
    mission: { state: 'ADOPTED', id: 'm1', blockedReason: null },
    receipts: { chain: [{ timestamp: '2026-08-01T00:00:00.000Z' }] }
  })
  const items = buildFleetAttentionItems({ projects: [adopted], clock })
  assert.deepEqual(items, [])
})

test('COMPLETED_RECENTLY: includes a real research mission that reached COMPLETE', () => {
  let mission = baseMission('mission:complete')
  mission = addResearchNode(mission, { id: 'node:a', nodeRole: 'PRIMARY_RESEARCH', requestedFields: [], requestedOutputSchema: {} }, clock)
  mission = transitionResearchMission(mission, 'COMPLETE', { reason: 'done', expectedRevision: mission.revision }, clock)
  const items = buildFleetAttentionItems({ projects: [], researchMissions: { [mission.id]: mission }, clock })
  assert.equal(items.length, 1)
  assert.equal(items[0].category, 'COMPLETED_RECENTLY')
  assert.equal(items[0].severity, 'P3')
  assert.equal(items[0].changedAt, mission.updatedAt)
})

test('COMPLETED_RECENTLY: an EXECUTING (not yet complete) research mission does not appear', () => {
  let mission = baseMission('mission:executing')
  mission = addResearchNode(mission, { id: 'node:a', nodeRole: 'PRIMARY_RESEARCH', requestedFields: [], requestedOutputSchema: {} }, clock)
  mission = recordDispatchAttempt(mission, 'node:a', { taskFingerprint: 'a'.repeat(64) }, clock, mission.revision)
  const items = buildFleetAttentionItems({ projects: [], researchMissions: { [mission.id]: mission }, clock })
  assert.deepEqual(items, [])
})

test('self-improvement: NEEDS_OWNER via AUTOFIX_ELIGIBILITY_CLASSIFIED vs FAILED_REQUIRES_ATTENTION via REPAIR_RETRY_BUDGET_EXCEEDED split correctly', () => {
  let eligibilityFinding = createFinding(rawFinding({ affectedSurface: 'eligibility-surface' }), clock)
  eligibilityFinding = transitionFinding(eligibilityFinding, 'VERIFIED', { reason: 'x' }, clock)
  eligibilityFinding = transitionFinding(eligibilityFinding, 'NEEDS_OWNER', { reason: 'AUTOFIX_ELIGIBILITY_CLASSIFIED' }, clock)

  let repairFailedFinding = createFinding(rawFinding({ affectedSurface: 'repair-failed-surface' }), clock)
  repairFailedFinding = transitionFinding(repairFailedFinding, 'VERIFIED', { reason: 'x' }, clock)
  repairFailedFinding = transitionFinding(repairFailedFinding, 'ELIGIBLE_FOR_AUTOFIX', { reason: 'x' }, clock)
  repairFailedFinding = transitionFinding(repairFailedFinding, 'FIX_MISSION_CREATED', { reason: 'x' }, clock)
  repairFailedFinding = transitionFinding(repairFailedFinding, 'FIX_IN_PROGRESS', { reason: 'x' }, clock)
  repairFailedFinding = transitionFinding(repairFailedFinding, 'NEEDS_OWNER', { reason: 'REPAIR_RETRY_BUDGET_EXCEEDED' }, clock)

  const items = buildFleetAttentionItems({
    projects: [],
    selfImprovementFindings: {
      [eligibilityFinding.findingId]: eligibilityFinding,
      [repairFailedFinding.findingId]: repairFailedFinding
    },
    clock
  })
  assert.equal(items.length, 2)
  const byId = Object.fromEntries(items.map((i) => [i.source.id, i]))
  assert.equal(byId[eligibilityFinding.findingId].category, 'NEEDS_OWNER')
  assert.equal(byId[repairFailedFinding.findingId].category, 'FAILED_REQUIRES_ATTENTION')
})

test('self-improvement: READY_FOR_ADOPTION status maps correctly, and a finding severity field wins over the default mapping', () => {
  let finding = createFinding(rawFinding({ severity: 'P0', affectedSurface: 'ready-surface' }), clock)
  finding = transitionFinding(finding, 'VERIFIED', { reason: 'x' }, clock)
  finding = transitionFinding(finding, 'ELIGIBLE_FOR_AUTOFIX', { reason: 'x' }, clock)
  finding = transitionFinding(finding, 'FIX_MISSION_CREATED', { reason: 'x' }, clock)
  finding = transitionFinding(finding, 'FIX_IN_PROGRESS', { reason: 'x' }, clock)
  finding = transitionFinding(finding, 'READY_FOR_ADOPTION', { reason: 'x' }, clock)
  const items = buildFleetAttentionItems({ projects: [], selfImprovementFindings: { [finding.findingId]: finding }, clock })
  assert.equal(items.length, 1)
  assert.equal(items[0].category, 'READY_FOR_ADOPTION')
  assert.equal(items[0].severity, 'P0', 'the finding\'s own severity must win over the default P2 mapping')
})

test('self-improvement: a finding in a status not on the notify-worthy list (e.g. DETECTED) produces no item', () => {
  const finding = createFinding(rawFinding(), clock)
  const items = buildFleetAttentionItems({ projects: [], selfImprovementFindings: { [finding.findingId]: finding }, clock })
  assert.deepEqual(items, [])
})

test('self-improvement resource wait: FIX_MISSION_CREATED and FIX_IN_PROGRESS findings with marked checkpoints produce finding-specific WAITING_FOR_RESOURCES items', () => {
  const findings = [
    repairFinding('resource-wait-created'),
    repairFinding('resource-wait-progress', 'FIX_IN_PROGRESS')
  ]
  const resourceState = { tier: 'CRITICAL', reason: 'host memory critical', observedAt: clock().toISOString() }
  const plannerMissionRecords = Object.fromEntries(
    findings.map((finding) => plannerRecordForRepair(finding, resourceState))
  )
  const items = buildFleetAttentionItems({
    projects: [],
    selfImprovementFindings: Object.fromEntries(findings.map((finding) => [finding.findingId, finding])),
    plannerMissionRecords,
    clock
  })

  assert.equal(items.length, 2)
  for (const finding of findings) {
    const item = items.find((candidate) => candidate.source.id === finding.findingId)
    assert.ok(item)
    assert.equal(item.category, 'WAITING_FOR_RESOURCES')
    assert.match(item.reason, /tier CRITICAL: host memory critical/)
    assert.equal(item.changedAt, clock().toISOString())
    assert.deepEqual(item.source, { kind: 'SELF_IMPROVEMENT_FINDING', id: finding.findingId })
  }
})

test('self-improvement resource wait: a repair finding with an unmarked checkpoint produces no WAITING_FOR_RESOURCES item', () => {
  const finding = repairFinding('healthy-repair')
  const [missionId, record] = plannerRecordForRepair(finding)

  const items = buildFleetAttentionItems({
    projects: [],
    selfImprovementFindings: { [finding.findingId]: finding },
    plannerMissionRecords: { [missionId]: record },
    clock
  })

  assert.equal(items.find((item) => item.category === 'WAITING_FOR_RESOURCES'), undefined)
})

test('self-improvement resource wait: finding-specific and host-wide WAITING_FOR_RESOURCES items remain distinct without duplication', () => {
  const finding = repairFinding('resource-wait-with-host-pressure')
  const resourcePressureState = buildResourcePressureState(
    { hostMemory: { totalBytes: 16e9, freeBytes: 2e9, availableBytes: 2e9 } },
    clock
  )
  const [missionId, record] = plannerRecordForRepair(finding, {
    tier: resourcePressureState.tier,
    reason: resourcePressureState.admission.reason,
    observedAt: resourcePressureState.observedAt
  })

  const items = buildFleetAttentionItems({
    projects: [],
    selfImprovementFindings: { [finding.findingId]: finding },
    plannerMissionRecords: { [missionId]: record },
    resourcePressureState,
    clock
  })
  const resourceItems = items.filter((item) => item.category === 'WAITING_FOR_RESOURCES')

  assert.equal(resourceItems.length, 2)
  assert.deepEqual(new Set(resourceItems.map((item) => item.id)).size, 2)
  assert.ok(resourceItems.some((item) => item.source.kind === 'SELF_IMPROVEMENT_FINDING'))
  assert.ok(resourceItems.some((item) => item.source.kind === 'RESOURCE_PRESSURE_TIER'))
})

test('resource pressure: appears only at CRITICAL/EMERGENCY, never fabricates a per-mission entry', () => {
  const healthy = buildResourcePressureState({ hostMemory: { totalBytes: 16e9, freeBytes: 8e9, availableBytes: 8e9 } }, clock)
  const pressured = buildResourcePressureState({ hostMemory: { totalBytes: 16e9, freeBytes: 3e9, availableBytes: 3e9 } }, clock)
  const critical = buildResourcePressureState({ hostMemory: { totalBytes: 16e9, freeBytes: 2e9, availableBytes: 2e9 } }, clock)
  const emergency = buildResourcePressureState({ hostMemory: { totalBytes: 16e9, freeBytes: 1e9, availableBytes: 1e9 } }, clock)

  assert.deepEqual(buildFleetAttentionItems({ projects: [], resourcePressureState: healthy, clock }), [])
  assert.deepEqual(buildFleetAttentionItems({ projects: [], resourcePressureState: pressured, clock }), [])

  const criticalItems = buildFleetAttentionItems({ projects: [], resourcePressureState: critical, clock })
  assert.equal(criticalItems.length, 1)
  assert.equal(criticalItems[0].category, 'WAITING_FOR_RESOURCES')
  assert.equal(criticalItems[0].project, null)
  assert.equal(criticalItems[0].id, 'resource-pressure:CRITICAL')

  const emergencyItems = buildFleetAttentionItems({ projects: [], resourcePressureState: emergency, clock })
  assert.equal(emergencyItems.length, 1)
  assert.equal(emergencyItems[0].id, 'resource-pressure:EMERGENCY')
})

test('Resource-Wait Auto-Resume V1: a per-project resource-blocked run appears WITHOUT needing resourcePressureState, and honestly distinguishes will-auto-resume from will-not', () => {
  let waiting = newRun('r1', 'p1')
  waiting = recordPendingDispatch(waiting, [{ id: 't1', scope: ['**/*'], worktree: '/wt' }], clock, waiting.revision)
  waiting = checkpointRun(waiting, { phase: 'DISPATCH_WAITING_FOR_RESOURCES', note: 'host memory critical' }, clock, waiting.revision)

  const items = buildFleetAttentionItems({
    projects: [project('p1', { displayName: 'Project One' })],
    keepGoingRuns: { p1: waiting },
    resourcePressureState: null, // deliberately absent -- this item must not depend on it
    clock
  })
  const item = items.find((i) => i.id === 'run:p1:waitingForResources')
  assert.ok(item, 'a resource-blocked run must appear even with no resourcePressureState supplied')
  assert.equal(item.category, 'WAITING_FOR_RESOURCES')
  assert.equal(item.project.id, 'p1')
  assert.match(item.reason, /will resume automatically/)

  // A run resource-refused before this feature existed (or one refused for
  // any reason other than a genuine dispatch attempt) has no pendingDispatch
  // -- must be reported honestly as NOT auto-resuming, never claim it will.
  let stuck = newRun('r2', 'p2')
  stuck = checkpointRun(stuck, { phase: 'DISPATCH_WAITING_FOR_RESOURCES', note: 'host memory critical' }, clock, stuck.revision)
  const stuckItems = buildFleetAttentionItems({
    projects: [project('p2', { displayName: 'Project Two' })],
    keepGoingRuns: { p2: stuck },
    resourcePressureState: null,
    clock
  })
  const stuckItem = stuckItems.find((i) => i.id === 'run:p2:waitingForResources')
  assert.ok(stuckItem)
  assert.doesNotMatch(stuckItem.reason, /will resume automatically/)

  // A run whose last checkpoint is NOT a resource wait produces no item here.
  const settled = completeRun(newRun('r3', 'p3'), clock)
  const noItems = buildFleetAttentionItems({
    projects: [project('p3', { displayName: 'Project Three' })],
    keepGoingRuns: { p3: settled },
    resourcePressureState: null,
    clock
  })
  assert.equal(noItems.find((i) => i.id === 'run:p3:waitingForResources'), undefined)
})

test('determinism: calling with the same input twice produces byte-identical output, including ids', () => {
  let run = raiseNeedsYou(newRun('r1', 'p1'), { question: 'Which provider?' }, clock, 0)
  const stalledRun = markStalled(newRun('r2', 'p2'), [], clock)
  let mission = baseMission('mission:needs')
  mission = raiseResearchNeedsYou(mission, { question: 'q' }, clock, mission.revision)
  const finding = createFinding(rawFinding(), clock)

  const input = {
    projects: [project('p1'), project('p2')],
    keepGoingRuns: { p1: run, p2: stalledRun },
    researchMissions: { [mission.id]: mission },
    selfImprovementFindings: { [finding.findingId]: finding },
    clock
  }
  const first = buildFleetAttentionItems(input)
  const second = buildFleetAttentionItems(input)
  assert.deepEqual(first, second)
  assert.deepEqual(first.map((i) => i.id).sort(), second.map((i) => i.id).sort())
})

test('every emitted category is a real member of ATTENTION_CATEGORIES', () => {
  const run = markStalled(newRun('r1', 'p1'), [], clock)
  const items = buildFleetAttentionItems({ projects: [project('p1')], keepGoingRuns: { p1: run }, clock })
  for (const item of items) {
    assert.ok(ATTENTION_CATEGORIES.includes(item.category))
  }
})

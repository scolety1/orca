import assert from 'node:assert/strict'
import test from 'node:test'
import { summarizeWorkFromRuns } from '../domain/work-feed-summary.mjs'
import { addResearchNode, createResearchMission, raiseResearchNeedsYou, transitionResearchMission } from '../domain/research-mission.mjs'
import { recordDispatchAttempt } from '../domain/research-dispatch-bookkeeping.mjs'
import {
  createOvernightRun,
  dispatchWave,
  recordWave,
  markStalled,
  raiseNeedsYou,
  completeRun,
  checkpointRun
} from '../domain/keep-going.mjs'

const clock = () => new Date('2026-08-25T00:00:00.000Z')

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
  return createOvernightRun(
    { id, projectId, originalGoal: 'Fix it.', acceptanceCriteria: ['X'] },
    clock
  )
}

test('the exact Started->Work bug: an onboarded project (mission.state ONBOARDED, no legacy bucket) with a fresh Keep Going run appears in active, not nowhere', () => {
  const p = project('tsf-orca')
  const run = newRun('keep-going-tsf-orca-1', 'tsf-orca')
  const summary = summarizeWorkFromRuns([p], { 'tsf-orca': run }, clock)
  assert.equal(summary.active.length, 1)
  assert.equal(summary.active[0].id, 'tsf-orca')
  assert.equal(summary.active[0].liveWorkFeed.state, 'PLANNING')
  assert.equal(summary.active[0].runId, run.id)
  // Never appears in any other section.
  assert.equal(summary.blocked.length, 0)
  assert.equal(summary.needsYou.length, 0)
  assert.equal(summary.verifying.length, 0)
})

// Persistent-visibility feature (bug-ledger.json): the real lastCheckpointAt
// fleet-work-status.mjs now computes must thread all the way through this
// bucketing into the item the UI (global-run-status.ts) actually reads --
// verified at this layer too, not just fleet-work-status.mjs's own.
test('lastCheckpointAt threads through into the bucketed item', () => {
  const p = project('tsf-orca')
  let run = newRun('keep-going-tsf-orca-1', 'tsf-orca')
  run = checkpointRun(run, { phase: 'RUN_STARTED' }, clock)
  const summary = summarizeWorkFromRuns([p], { 'tsf-orca': run }, clock)
  assert.equal(summary.active[0].lastCheckpointAt, run.checkpoints.at(-1).at)
  assert.equal(summary.readyForAdoption.length, 0)
})

test('a project with no Keep Going run falls through to the unchanged legacy classification', () => {
  const active = project('legacy-active', {
    mission: { state: 'ACTIVE', id: 'm1', blockedReason: null }
  })
  const blocked = project('legacy-blocked', {
    mission: { state: 'BLOCKED_SOMETHING', id: null, blockedReason: 'x' }
  })
  const ready = project('legacy-ready', { candidate: { state: 'READY_FOR_ADOPTION' } })
  const adopted = project('legacy-adopted', {
    mission: { state: 'ADOPTED', id: 'm2', blockedReason: null },
    receipts: { chain: [{ timestamp: '2026-08-01T00:00:00.000Z' }] }
  })
  const summary = summarizeWorkFromRuns([active, blocked, ready, adopted], {}, clock)
  assert.deepEqual(
    summary.active.map((p) => p.id),
    ['legacy-active']
  )
  assert.deepEqual(
    summary.blocked.map((p) => p.id),
    ['legacy-blocked']
  )
  assert.deepEqual(
    summary.readyForAdoption.map((p) => p.id),
    ['legacy-ready']
  )
  assert.deepEqual(
    summary.recentlyCompleted.map((p) => p.id),
    ['legacy-adopted']
  )
  assert.equal(summary.recentlyCompleted[0].adoptedAt, '2026-08-01T00:00:00.000Z')
})

test('a run in WORKING/NEEDS_YOU/STALLED/COMPLETE buckets into active/needsYou/stalled/readyForAdoption respectively', () => {
  let workingRun = newRun('r-working', 'p-working')
  const wavePlan = {
    schemaVersion: 'TSF_KEEP_GOING_WAVE_PLAN_V1',
    runId: workingRun.id,
    waveNumber: 1,
    batches: []
  }
  workingRun = dispatchWave(
    workingRun,
    wavePlan,
    [{ workItemId: 't1', taskId: 'task-1' }],
    clock,
    workingRun.revision
  )

  const needsYouRun = raiseNeedsYou(
    newRun('r-needs-you', 'p-needs-you'),
    { question: 'Which provider?' },
    clock,
    0
  )

  const stalledRun = markStalled(newRun('r-stalled', 'p-stalled'), [], clock)

  const completeRunView = completeRun(newRun('r-complete', 'p-complete'), clock)

  const projects = [
    project('p-working'),
    project('p-needs-you'),
    project('p-stalled'),
    project('p-complete')
  ]
  const runs = {
    'p-working': workingRun,
    'p-needs-you': needsYouRun,
    'p-stalled': stalledRun,
    'p-complete': completeRunView
  }
  const summary = summarizeWorkFromRuns(projects, runs, clock)
  assert.deepEqual(
    summary.active.map((p) => p.id),
    ['p-working']
  )
  assert.equal(summary.active[0].liveWorkFeed.state, 'WORKING')
  assert.deepEqual(
    summary.needsYou.map((p) => p.id),
    ['p-needs-you']
  )
  assert.deepEqual(
    summary.stalled.map((p) => p.id),
    ['p-stalled']
  )
  assert.deepEqual(
    summary.readyForAdoption.map((p) => p.id),
    ['p-complete']
  )
})

test('a run with a recorded wave and no independent verification lands in verifying, not silently in active', () => {
  let run = newRun('r-verifying', 'p-verifying')
  run = recordWave(
    run,
    { schemaVersion: 'TSF_KEEP_GOING_WAVE_PLAN_V1', runId: run.id, waveNumber: 1, batches: [] },
    { schemaVersion: 'TSF_KEEP_GOING_WAVE_RESULT_V1', outcomes: [] },
    clock
  )
  const summary = summarizeWorkFromRuns([project('p-verifying')], { 'p-verifying': run }, clock)
  assert.deepEqual(
    summary.verifying.map((p) => p.id),
    ['p-verifying']
  )
  assert.equal(summary.active.length, 0)
})

test('blocked stays a legacy, run-independent bucket -- a project can be both legacy-blocked and have an active run', () => {
  const p = project('mixed', {
    mission: { state: 'BLOCKED_X', id: null, blockedReason: 'sensitive' }
  })
  const run = newRun('r-mixed', 'mixed')
  const summary = summarizeWorkFromRuns([p], { mixed: run }, clock)
  assert.deepEqual(
    summary.blocked.map((x) => x.id),
    ['mixed']
  )
  assert.deepEqual(
    summary.active.map((x) => x.id),
    ['mixed']
  )
})

test('queued is always empty in this pass -- no domain signal fabricated', () => {
  const summary = summarizeWorkFromRuns([project('a')], {}, clock)
  assert.deepEqual(summary.queued, [])
})

// Real free-path research execution finding: this aggregation (the Work
// page / Home) had zero ResearchMission awareness at all -- a mission
// genuinely EXECUTING never appeared here even though it already appeared
// in Command's own fleet-status text.
function baseMissionSpec() {
  return {
    schemaVersion: 'TSF_RESEARCH_SPECIFICATION_V1',
    id: 'spec:x',
    researchQuestion: 'q',
    entityType: 'FIXTURE',
    requestedFields: [],
    sourcePolicy: { preferredSources: [], disallowedSources: [], licensingConstraints: [], freshnessPolicy: 'UNSPECIFIED', requireIndependentSources: false, minSourceCount: 0, allowCrossMissionLibraryReuse: true },
    temporalRequirements: { asOfDate: '2026-08-25', periodScope: 'UNSPECIFIED' },
    budget: { maxCostUsd: 0, maxLatencyMs: null, maxToolCallsPerNode: null },
    toolPermissions: []
  }
}

test('a research mission with a real dispatch attempt (EXECUTING) appears in active, the exact Round 5 aggregation gap fix', () => {
  let mission = createResearchMission({ id: 'mission:executing', projectId: 'p', specification: baseMissionSpec(), expectedUniverse: { schemaVersion: 'TSF_EXPECTED_UNIVERSE_V1', entityType: 'FIXTURE', expectedCount: 1, expectedEntities: [] } }, clock)
  mission = addResearchNode(mission, { id: 'node:a', nodeRole: 'PRIMARY_RESEARCH', requestedFields: [], requestedOutputSchema: {} }, clock)
  mission = recordDispatchAttempt(mission, 'node:a', { taskFingerprint: 'a'.repeat(64) }, clock, mission.revision)
  const summary = summarizeWorkFromRuns([], {}, clock, { [mission.id]: mission })
  assert.deepEqual(summary.active.map((x) => x.missionId), ['mission:executing'])
  assert.equal(summary.active[0].kind, 'RESEARCH_MISSION')
  assert.equal(summary.active[0].phase, 'EXECUTING')
})

// IA consolidation: HQ/Work render a real title/stats line straight from
// this item -- no second round-trip needed.
test('a research work item carries enough fields to render on HQ/Work without a second fetch', () => {
  let mission = createResearchMission({ id: 'mission:enriched', projectId: 'proj-1', specification: baseMissionSpec(), expectedUniverse: { schemaVersion: 'TSF_EXPECTED_UNIVERSE_V1', entityType: 'FIXTURE', expectedCount: 3, expectedEntities: [] } }, clock)
  mission = addResearchNode(mission, { id: 'node:a', nodeRole: 'PRIMARY_RESEARCH', requestedFields: [], requestedOutputSchema: {} }, clock)
  mission = recordDispatchAttempt(mission, 'node:a', { taskFingerprint: 'a'.repeat(64) }, clock, mission.revision)
  const item = summarizeWorkFromRuns([], {}, clock, { [mission.id]: mission }).active[0]
  assert.equal(item.researchQuestion, 'q')
  assert.equal(item.entityType, 'FIXTURE')
  assert.equal(item.expectedCount, 3)
  assert.equal(item.freePathOnly, true)
  assert.equal(item.projectId, 'proj-1')
})

test('a research mission WAITING_NEEDS_INPUT appears in needsYou, alongside any real Keep Going needsYou items', () => {
  let mission = createResearchMission({ id: 'mission:needs-you', projectId: 'p', specification: baseMissionSpec(), expectedUniverse: { schemaVersion: 'TSF_EXPECTED_UNIVERSE_V1', entityType: 'FIXTURE', expectedCount: 1, expectedEntities: [] } }, clock)
  mission = raiseResearchNeedsYou(mission, { question: 'approve paid access?' }, clock, mission.revision)
  const summary = summarizeWorkFromRuns([], {}, clock, { [mission.id]: mission })
  assert.deepEqual(summary.needsYou.map((x) => x.missionId), ['mission:needs-you'])
})

test('a COMPLETE research mission appears in recentlyCompleted', () => {
  let mission = createResearchMission({ id: 'mission:complete', projectId: 'p', specification: baseMissionSpec(), expectedUniverse: { schemaVersion: 'TSF_EXPECTED_UNIVERSE_V1', entityType: 'FIXTURE', expectedCount: 1, expectedEntities: [] } }, clock)
  mission = addResearchNode(mission, { id: 'node:a', nodeRole: 'PRIMARY_RESEARCH', requestedFields: [], requestedOutputSchema: {} }, clock)
  mission = transitionResearchMission(mission, 'COMPLETE', { reason: 'x', expectedRevision: mission.revision }, clock)
  const summary = summarizeWorkFromRuns([], {}, clock, { [mission.id]: mission })
  assert.deepEqual(summary.recentlyCompleted.map((x) => x.missionId), ['mission:complete'])
})

test('a genuinely untouched CREATED research mission (no dispatch attempt at all) does not appear anywhere -- "started must mean something real"', () => {
  let mission = createResearchMission({ id: 'mission:created', projectId: 'p', specification: baseMissionSpec(), expectedUniverse: { schemaVersion: 'TSF_EXPECTED_UNIVERSE_V1', entityType: 'FIXTURE', expectedCount: 1, expectedEntities: [] } }, clock)
  mission = addResearchNode(mission, { id: 'node:a', nodeRole: 'PRIMARY_RESEARCH', requestedFields: [], requestedOutputSchema: {} }, clock)
  const summary = summarizeWorkFromRuns([], {}, clock, { [mission.id]: mission })
  assert.deepEqual(summary.active, [])
  assert.deepEqual(summary.needsYou, [])
  assert.deepEqual(summary.recentlyCompleted, [])
})

test('backward compatible: omitting researchMissions entirely (existing callers) behaves exactly as before', () => {
  const summary = summarizeWorkFromRuns([project('a')], {}, clock)
  assert.deepEqual(summary.active, [])
})

// Adversarial review finding: RESEARCH_PHASE_SECTION previously had no
// BLOCKED entry at all, so a mission genuinely awaiting a human decision
// was invisible in every bucket -- neither active, needsYou, nor blocked.
test('a BLOCKED research mission appears in blocked, not nowhere', () => {
  let mission = createResearchMission({ id: 'mission:blocked', projectId: 'p', specification: baseMissionSpec(), expectedUniverse: { schemaVersion: 'TSF_EXPECTED_UNIVERSE_V1', entityType: 'FIXTURE', expectedCount: 1, expectedEntities: [] } }, clock)
  mission = transitionResearchMission(mission, 'BLOCKED', { reason: 'no legal source found', expectedRevision: mission.revision }, clock)
  const summary = summarizeWorkFromRuns([], {}, clock, { [mission.id]: mission })
  assert.deepEqual(summary.blocked.filter((x) => x.kind === 'RESEARCH_MISSION').map((x) => x.missionId), ['mission:blocked'])
  assert.deepEqual(summary.active, [])
  assert.deepEqual(summary.needsYou, [])
})

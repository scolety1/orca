import assert from 'node:assert/strict'
import test from 'node:test'
import { fleetNeedsYouStatus, fleetResearchStatus, fleetWorkStatus } from '../domain/fleet-work-status.mjs'
import { createOvernightRun, dispatchWave, checkpointRun } from '../domain/keep-going.mjs'
import { addResearchNode, createResearchMission, raiseResearchNeedsYou } from '../domain/research-mission.mjs'
import { markResearchNodeReady, recordResearchNodeDispatch } from '../domain/research-node.mjs'
import { createPlannerMissionCheckpoint, raisePlannerNeedsYou } from '../domain/planner-mission-checkpoint.mjs'

const clock = () => new Date('2026-08-25T00:00:00.000Z')

function project(id, overrides = {}) {
  return { id, displayName: id, mission: { state: 'ONBOARDED' }, ...overrides }
}

test('fleetWorkStatus reports hasRun:false and feed:null for a project with no Keep Going run', () => {
  const statuses = fleetWorkStatus([project('a')], {}, clock)
  assert.deepEqual(statuses, [
    {
      projectId: 'a',
      displayName: 'a',
      hasRun: false,
      feed: null,
      runId: null,
      executing: false,
      lastCheckpointAt: null
    }
  ])
})

// Persistent-visibility feature (bug-ledger.json): lastCheckpointAt is the
// real, honest "last activity" fact a global run-status indicator needs --
// derived directly from the run's own last checkpoint, never fabricated.
test('fleetWorkStatus: a run with no checkpoint recorded yet -> honestly null, not fabricated', () => {
  const run = createOvernightRun(
    { id: 'run-a', projectId: 'a', originalGoal: 'Fix it.', acceptanceCriteria: ['X'] },
    clock
  )
  const statuses = fleetWorkStatus([project('a')], { a: run }, clock)
  assert.equal(statuses[0].lastCheckpointAt, null)
})

test('fleetWorkStatus exposes the real last checkpoint timestamp once one is recorded', () => {
  let run = createOvernightRun(
    { id: 'run-a', projectId: 'a', originalGoal: 'Fix it.', acceptanceCriteria: ['X'] },
    clock
  )
  run = checkpointRun(run, { phase: 'RUN_STARTED' }, clock)
  const statuses = fleetWorkStatus([project('a')], { a: run }, clock)
  assert.equal(statuses[0].lastCheckpointAt, run.checkpoints.at(-1).at)
})

test('fleetWorkStatus reports PLANNING for a freshly-started run with no dispatched wave -- the exact Started->Work bug', () => {
  const run = createOvernightRun(
    { id: 'run-a', projectId: 'a', originalGoal: 'Fix it.', acceptanceCriteria: ['X'] },
    clock
  )
  const statuses = fleetWorkStatus([project('a')], { a: run }, clock)
  assert.equal(statuses[0].hasRun, true)
  assert.equal(statuses[0].runId, 'run-a')
  assert.equal(statuses[0].feed.state, 'PLANNING')
})

test('fleetWorkStatus reports WORKING once a wave is in flight', () => {
  let run = createOvernightRun(
    { id: 'run-a', projectId: 'a', originalGoal: 'Fix it.', acceptanceCriteria: ['X'] },
    clock
  )
  const wavePlan = {
    schemaVersion: 'TSF_KEEP_GOING_WAVE_PLAN_V1',
    runId: run.id,
    waveNumber: 1,
    batches: []
  }
  run = dispatchWave(run, wavePlan, [{ workItemId: 't1', taskId: 'task-1' }], clock, run.revision)
  const statuses = fleetWorkStatus([project('a')], { a: run }, clock)
  assert.equal(statuses[0].feed.state, 'WORKING')
  assert.equal(statuses[0].executing, true)
})

test('fleetWorkStatus is unaffected by an unrelated project with no run in the same fleet', () => {
  const run = createOvernightRun(
    { id: 'run-a', projectId: 'a', originalGoal: 'Fix it.', acceptanceCriteria: ['X'] },
    clock
  )
  const statuses = fleetWorkStatus([project('a'), project('b')], { a: run }, clock)
  const byId = Object.fromEntries(statuses.map((s) => [s.projectId, s]))
  assert.equal(byId.a.hasRun, true)
  assert.equal(byId.b.hasRun, false)
})

// Hands-on pilot Finding 3: "Command, Work/Home/global indicator and
// Research status must agree." fleetResearchStatus is the one place "is
// research currently active" is computed for fleet-wide surfaces.
function baseMission(id = 'mission:a') {
  return createResearchMission(
    {
      id,
      projectId: 'test',
      specification: { schemaVersion: 'TSF_RESEARCH_SPECIFICATION_V1', id: 's', researchQuestion: 'q', entityType: 'T', requestedFields: [], sourcePolicy: { preferredSources: [], disallowedSources: [], licensingConstraints: [], freshnessPolicy: 'UNSPECIFIED', requireIndependentSources: false, minSourceCount: 0, allowCrossMissionLibraryReuse: true }, temporalRequirements: { asOfDate: null, periodScope: null }, budget: { maxCostUsd: null, maxLatencyMs: null, maxToolCallsPerNode: null }, toolPermissions: [] },
      expectedUniverse: { schemaVersion: 'TSF_EXPECTED_UNIVERSE_V1', entityType: 'T', expectedCount: 0, expectedEntities: [], source: 'test' }
    },
    clock
  )
}

test('fleetResearchStatus: a DRAFT (zero-node) or CREATED (nodes, nothing dispatched) mission is never reported as active', () => {
  const draft = baseMission('mission:draft')
  let created = baseMission('mission:created')
  created = addResearchNode(created, { id: 'n1', requestedFields: [], requestedOutputSchema: {} }, clock)
  assert.deepEqual(fleetResearchStatus({ [draft.id]: draft, [created.id]: created }), [])
})

test('fleetResearchStatus: an EXECUTING mission (real dispatch history) IS reported as active', () => {
  let mission = baseMission('mission:executing')
  mission = addResearchNode(mission, { id: 'n1', requestedFields: [], requestedOutputSchema: {} }, clock)
  mission = markResearchNodeReady(mission, 'n1', clock, mission.revision)
  mission = recordResearchNodeDispatch(mission, 'n1', { taskFingerprint: 'a'.repeat(64), workerRunRef: { provider: 'FAKE', providerRunId: 'r1', dispatchedAt: clock().toISOString() } }, clock, mission.revision)
  assert.deepEqual(fleetResearchStatus({ [mission.id]: mission }), [{ missionId: mission.id, phase: 'EXECUTING', state: 'ACTIVE' }])
})

test('fleetResearchStatus: a WAITING_NEEDS_INPUT mission IS reported as active, distinctly labeled', () => {
  let mission = baseMission('mission:needs-you')
  mission = raiseResearchNeedsYou(mission, { question: 'x' }, clock, mission.revision)
  const statuses = fleetResearchStatus({ [mission.id]: mission })
  assert.equal(statuses.length, 1)
  assert.equal(statuses[0].phase, 'WAITING_NEEDS_INPUT')
})

test('fleetResearchStatus: defaults to empty for an absent/undefined researchMissions map -- never throws', () => {
  assert.deepEqual(fleetResearchStatus(), [])
  assert.deepEqual(fleetResearchStatus(undefined), [])
})

// "What needs me?" (Command architecture round 2): both real sources
// (Keep Going runs, ResearchMissions) aggregated from the exact same
// durable needsYou arrays Work/Flight Recorder/Research status already
// read.
test('fleetNeedsYouStatus: aggregates open Needs You across projects AND research missions, resolved entries excluded, real displayName used', () => {
  const run = { needsYou: [{ id: 'q1', question: 'Real question A', resolvedAt: null }, { id: 'q1b', question: 'already resolved', resolvedAt: '2026-01-01T00:00:00.000Z' }] }
  let mission = baseMission('mission:needs')
  mission = raiseResearchNeedsYou(mission, { question: 'Real research question B' }, clock, mission.revision)
  const items = fleetNeedsYouStatus([project('proj-a', { displayName: 'Project A' })], { 'proj-a': run }, { [mission.id]: mission })
  assert.equal(items.length, 2)
  assert.deepEqual(items.map((i) => i.source).sort(), ['PROJECT', 'RESEARCH'])
  const projectItem = items.find((i) => i.source === 'PROJECT')
  assert.equal(projectItem.label, 'Project A')
  assert.equal(projectItem.question, 'Real question A')
  const researchItem = items.find((i) => i.source === 'RESEARCH')
  assert.match(researchItem.label, /mission:needs/)
  assert.equal(researchItem.question, 'Real research question B')
})

test('fleetNeedsYouStatus: empty when nothing is actually outstanding', () => {
  assert.deepEqual(fleetNeedsYouStatus([], {}, {}), [])
  assert.deepEqual(fleetNeedsYouStatus([], {}, {}, {}), [])
})

// Phase 6 finding (F18 follow-up): Planner Context Lifecycle's own
// checkpoint.needsYou (raised via raisePlannerNeedsYou) was never wired
// into this aggregator at all -- a real planner-raised Needs You item was
// structurally invisible to "what needs me?". Fixed by adding
// plannerMissionRecords as a 4th source, read from the SAME { lease,
// checkpoint } shape server/planner-mission-store.mjs's
// readAllPlannerMissionRecords already returns (opState.plannerMissions).
test('fleetNeedsYouStatus: a real Planner Context Lifecycle needsYou entry is now a real 4th source, alongside PROJECT and RESEARCH', () => {
  const run = { needsYou: [{ id: 'q1', question: 'Real question A', resolvedAt: null }] }
  let mission = baseMission('mission:needs')
  mission = raiseResearchNeedsYou(mission, { question: 'Real research question B' }, clock, mission.revision)
  let checkpoint = createPlannerMissionCheckpoint(
    { missionId: 'planner-x', missionGoal: 'ship it', phase: 'BUILD', repoState: { branch: 'main', sha: 'a'.repeat(40) } },
    clock
  )
  checkpoint = raisePlannerNeedsYou(checkpoint, { question: 'Real planner question C', category: 'AUTHORITY_REQUIRED' }, clock)
  const plannerMissionRecords = { 'planner-x': { lease: null, checkpoint } }

  const items = fleetNeedsYouStatus(
    [project('proj-a', { displayName: 'Project A' })],
    { 'proj-a': run },
    { [mission.id]: mission },
    plannerMissionRecords
  )
  assert.equal(items.length, 3)
  assert.deepEqual(items.map((i) => i.source).sort(), ['PLANNER', 'PROJECT', 'RESEARCH'])
  const plannerItem = items.find((i) => i.source === 'PLANNER')
  assert.match(plannerItem.label, /planner-x/)
  assert.equal(plannerItem.question, 'Real planner question C')
  // No reliable project association exists on a planner checkpoint --
  // honestly null, never fabricated.
  assert.equal(plannerItem.projectId, null)
  // PROJECT/RESEARCH items now carry a real projectId too, for deep-linking.
  const projectItem = items.find((i) => i.source === 'PROJECT')
  assert.equal(projectItem.projectId, 'proj-a')
  const researchItem = items.find((i) => i.source === 'RESEARCH')
  assert.equal(researchItem.projectId, 'test')
})

test('fleetNeedsYouStatus: a resolved planner needsYou entry is excluded, matching PROJECT/RESEARCH resolved-entry handling', () => {
  let checkpoint = createPlannerMissionCheckpoint(
    { missionId: 'planner-y', missionGoal: 'ship it', phase: 'BUILD', repoState: { branch: 'main', sha: 'b'.repeat(40) } },
    clock
  )
  checkpoint = raisePlannerNeedsYou(checkpoint, { question: 'resolved already' }, clock)
  checkpoint = { ...checkpoint, needsYou: checkpoint.needsYou.map((n) => ({ ...n, resolvedAt: clock().toISOString() })) }
  const items = fleetNeedsYouStatus([], {}, {}, { 'planner-y': { lease: null, checkpoint } })
  assert.deepEqual(items, [])
})

test('fleetNeedsYouStatus: a planner mission record with no checkpoint yet (lease-only) never throws', () => {
  assert.deepEqual(fleetNeedsYouStatus([], {}, {}, { 'planner-z': { lease: {}, checkpoint: null } }), [])
})

// TSF_PRE_UI_PLATFORM_COHERENCE_V1, Stage 3. Proves: for each real durable
// state, keepGoingRunWorkItem/researchMissionWorkItem produce the correct
// owner-level state -- one canonical answer, reusing (never re-deriving)
// live-work-feed.mjs's/research-mission.mjs's own real classifiers.
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  OWNER_WORK_STATES,
  buildOwnerWorkItems,
  keepGoingRunWorkItem,
  researchMissionWorkItem
} from '../domain/owner-work-model.mjs'
import {
  createOvernightRun,
  planWave,
  dispatchWave,
  pauseRun,
  markStalled,
  raiseNeedsYou,
  completeRun,
  checkpointRun,
  recordPendingDispatch
} from '../domain/keep-going.mjs'
import {
  createResearchMission,
  addResearchNode,
  checkpointResearchMission,
  raiseResearchNeedsYou,
  transitionResearchMission
} from '../domain/research-mission.mjs'
import { recordDispatchAttempt } from '../domain/research-dispatch-bookkeeping.mjs'

const clock = () => new Date('2026-09-13T00:00:00.000Z')

function newRun(id, projectId) {
  return createOvernightRun(
    { id, projectId, originalGoal: 'ship it', acceptanceCriteria: ['X'] },
    clock
  )
}

function baseMission(id = 'mission:1') {
  return createResearchMission(
    {
      id,
      projectId: 'p1',
      specification: {
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
        temporalRequirements: { asOfDate: '2026-09-13', periodScope: 'UNSPECIFIED' },
        budget: { maxCostUsd: 0, maxLatencyMs: null, maxToolCallsPerNode: null },
        toolPermissions: []
      },
      expectedUniverse: {
        schemaVersion: 'TSF_EXPECTED_UNIVERSE_V1',
        entityType: 'FIXTURE',
        expectedCount: 1,
        expectedEntities: []
      }
    },
    clock
  )
}

test("OWNER_WORK_STATES has no QUEUED -- no real domain signal backs it (see work-feed-summary.mjs's own assertion)", () => {
  assert.equal(OWNER_WORK_STATES.includes('QUEUED'), false)
})

test('Keep Going: PLANNING (fresh run, no wave)', () => {
  const item = keepGoingRunWorkItem(newRun('r1', 'p1'))
  assert.equal(item.state, 'PLANNING')
  assert.equal(item.kind, 'KEEP_GOING_RUN')
  assert.equal(item.id, 'run:r1')
})

test('Keep Going: WORKING (in-flight wave)', () => {
  let run = newRun('r2', 'p1')
  const plan = planWave(run, [{ id: 't1', scope: ['a.mjs'] }], clock)
  run = dispatchWave(
    run,
    plan,
    [{ workItemId: 't1', scope: ['a.mjs'], taskId: 'task-1', dispatchId: 'ctx-1' }],
    clock,
    run.revision
  )
  assert.equal(keepGoingRunWorkItem(run).state, 'WORKING')
})

test('Keep Going: PAUSED (distinct from resource-wait WAITING)', () => {
  const run = pauseRun(newRun('r3', 'p1'), 'OPERATOR_PAUSE', clock)
  const item = keepGoingRunWorkItem(run)
  assert.equal(item.state, 'PAUSED')
  assert.deepEqual(item.availableActions.includes('RESUME'), true)
})

test('Keep Going resource wait: WAITING, not confused with PAUSED', () => {
  let run = recordPendingDispatch(newRun('r4', 'p1'), [{ id: 't1', scope: ['a.mjs'] }], clock, 0)
  run = checkpointRun(
    run,
    { phase: 'DISPATCH_WAITING_FOR_RESOURCES', note: 'host memory critical' },
    clock,
    run.revision
  )
  const item = keepGoingRunWorkItem(run)
  assert.equal(item.state, 'WAITING')
  assert.match(item.reason, /host memory critical/)
})

test('Keep Going: NEEDS_YOU (open needsYou entry)', () => {
  const run = raiseNeedsYou(newRun('r5', 'p1'), { question: 'which provider?' }, clock, 0)
  assert.equal(keepGoingRunWorkItem(run).state, 'NEEDS_YOU')
})

test('Keep Going: FAILED (real equivalent: STALLED)', () => {
  const run = markStalled(newRun('r6', 'p1'), ['no progress'], clock)
  assert.equal(keepGoingRunWorkItem(run).state, 'FAILED')
})

test('Keep Going: READY (COMPLETE, not yet adopted)', () => {
  const run = completeRun(newRun('r7', 'p1'), clock)
  const item = keepGoingRunWorkItem(run)
  assert.equal(item.state, 'READY')
  assert.deepEqual(item.availableActions.includes('ADOPT'), true)
})

test('Keep Going: DONE (COMPLETE + a real ADVANCED adoption merge landed)', () => {
  const run = completeRun(newRun('r8', 'p1'), clock)
  const advancedEntry = { action: 'ADVANCED', missionId: run.id, at: '2026-09-13T01:00:00.000Z' }
  const item = keepGoingRunWorkItem(run, { advancedEntry })
  assert.equal(item.state, 'DONE')
  assert.equal(item.updatedAt, advancedEntry.at)
  assert.deepEqual(
    item.availableActions.includes('ADOPT'),
    false,
    'an already-adopted run must never still offer ADOPT'
  )
})

test("Keep Going: HOLD/RELEASE_HOLD are always available regardless of run state -- a hold is orthogonal to the run's own mechanical state (Stage 1C's own HELD finding)", () => {
  for (const run of [
    newRun('rh1', 'p1'),
    pauseRun(newRun('rh2', 'p1'), 'x', clock),
    markStalled(newRun('rh3', 'p1'), [], clock)
  ]) {
    const actions = keepGoingRunWorkItem(run).availableActions
    assert.ok(actions.includes('HOLD'))
    assert.ok(actions.includes('RELEASE_HOLD'))
  }
})

test('ResearchMission: PLANNING (CREATED, no real progress)', () => {
  let mission = baseMission('m1')
  mission = addResearchNode(
    mission,
    { id: 'n1', requestedFields: [], requestedOutputSchema: {} },
    clock
  )
  assert.equal(researchMissionWorkItem(mission).state, 'PLANNING')
})

test('ResearchMission: WORKING (EXECUTING, real dispatch attempt)', () => {
  let mission = baseMission('m2')
  mission = addResearchNode(
    mission,
    { id: 'n1', requestedFields: [], requestedOutputSchema: {} },
    clock
  )
  mission = recordDispatchAttempt(
    mission,
    'n1',
    { taskFingerprint: 'a'.repeat(64) },
    clock,
    mission.revision
  )
  assert.equal(researchMissionWorkItem(mission).state, 'WORKING')
})

test('ResearchMission resource wait: WAITING, same word Keep Going uses for its own resource wait', () => {
  let mission = baseMission('m3')
  mission = addResearchNode(
    mission,
    { id: 'n1', requestedFields: [], requestedOutputSchema: {} },
    clock
  )
  mission = checkpointResearchMission(
    mission,
    { phase: 'DISPATCH_WAITING_FOR_RESOURCES', note: 'host memory critical' },
    clock,
    mission.revision
  )
  const item = researchMissionWorkItem(mission)
  assert.equal(item.state, 'WAITING')
  assert.match(item.reason, /host memory critical/)
})

test('ResearchMission: NEEDS_YOU (WAITING_NEEDS_INPUT)', () => {
  const mission = raiseResearchNeedsYou(baseMission('m4'), { question: 'x' }, clock, 0)
  assert.equal(researchMissionWorkItem(mission).state, 'NEEDS_YOU')
})

test('ResearchMission: DONE (COMPLETE)', () => {
  const mission = transitionResearchMission(baseMission('m5'), 'COMPLETE', { reason: 'x' }, clock)
  const item = researchMissionWorkItem(mission)
  assert.equal(item.state, 'DONE')
  assert.deepEqual(item.availableActions, [], 'a terminal mission offers no further action')
})

test('ResearchMission: PAUSED (BLOCKED -- the real, sole production meaning is an operator-initiated cancel, not a failure)', () => {
  const mission = transitionResearchMission(
    baseMission('m6'),
    'BLOCKED',
    { reason: 'OPERATOR_CHAT_CANCEL' },
    clock
  )
  const item = researchMissionWorkItem(mission)
  assert.equal(item.state, 'PAUSED')
  assert.match(item.reason, /OPERATOR_CHAT_CANCEL/)
  assert.deepEqual(item.availableActions, [], 'BLOCKED is terminal per MISSION_ALLOWED')
})

test('ResearchMission: CANCEL_RESEARCH is offered from every non-terminal state', () => {
  const active = baseMission('m7')
  assert.deepEqual(researchMissionWorkItem(active).availableActions, ['CANCEL_RESEARCH'])
  const needsYou = raiseResearchNeedsYou(baseMission('m8'), { question: 'x' }, clock, 0)
  assert.deepEqual(researchMissionWorkItem(needsYou).availableActions, ['CANCEL_RESEARCH'])
})

test('buildOwnerWorkItems: assembles Keep Going runs and research missions into ONE list, a project with no run contributes nothing (never fabricated)', () => {
  const projects = [{ id: 'p1' }, { id: 'p2' }]
  const run = newRun('r1', 'p1')
  const mission = baseMission('m9')
  const items = buildOwnerWorkItems(projects, { p1: run }, { [mission.id]: mission })
  assert.deepEqual(new Set(items.map((i) => i.id)), new Set(['run:r1', 'research:m9']))
})

test('buildOwnerWorkItems: threads real canonicalBases ADVANCED evidence into DONE, exactly like keepGoingRunWorkItem alone would', () => {
  const run = completeRun(newRun('r9', 'p1'), clock)
  const canonicalBases = {
    p1: { history: [{ action: 'ADVANCED', missionId: run.id, at: '2026-09-13T02:00:00.000Z' }] }
  }
  const items = buildOwnerWorkItems([{ id: 'p1' }], { p1: run }, {}, canonicalBases)
  assert.equal(items[0].state, 'DONE')
})

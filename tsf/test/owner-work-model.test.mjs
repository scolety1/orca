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
  assert.equal(item.runId, 'r1')
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

test('buildOwnerWorkItems: assembles Keep Going runs and research missions into ONE list, a project with no run and no real legacy classification contributes nothing (never fabricated)', () => {
  // DRAFT: a real mission.state that is neither a legacy-active value nor
  // ADOPTED nor BLOCKED -- the genuinely honest "no classification applies"
  // case, not an artificially incomplete fixture.
  const projects = [
    { id: 'p1', mission: { state: 'DRAFT' } },
    { id: 'p2', mission: { state: 'DRAFT' } }
  ]
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
  const items = buildOwnerWorkItems(
    [{ id: 'p1', mission: { state: 'DRAFT' } }],
    { p1: run },
    {},
    canonicalBases
  )
  assert.equal(items[0].state, 'DONE')
})

// Overnight Completion, finish item A: a run-less project's legacy
// mission.state/candidate.state classification -- the exact real fields
// work-feed-summary.mjs's own legacyActive/legacyReadyForAdoption/
// legacyRecentlyCompleted checks use, re-labeled onto the owner
// vocabulary, never re-derived.
for (const [missionState, ownerState] of [
  ['ACTIVE', 'WORKING'],
  ['PLANNING', 'PLANNING'],
  ['REVIEW', 'VERIFYING']
]) {
  test(`buildOwnerWorkItems: a run-less project with legacy mission.state ${missionState} projects as owner state ${ownerState}`, () => {
    const items = buildOwnerWorkItems([{ id: 'p1', mission: { state: missionState } }], {})
    assert.deepEqual(items, [
      {
        id: 'legacy-mission:p1',
        projectId: 'p1',
        goalId: null,
        kind: 'PROJECT',
        parentId: null,
        state: ownerState,
        reason: `legacy mission state is ${missionState} (no Keep Going run exists yet)`,
        progress: null,
        startedAt: null,
        updatedAt: null,
        availableActions: []
      }
    ])
  })
}

test('buildOwnerWorkItems: a run-less ADOPTED project (legacy candidate flow) projects as DONE', () => {
  const items = buildOwnerWorkItems([
    {
      id: 'p1',
      mission: { id: 'mission:legacy-1', state: 'ADOPTED' },
      receipts: { chain: [{ timestamp: '2026-09-01T00:00:00.000Z' }] }
    }
  ])
  assert.equal(items.length, 1)
  assert.equal(items[0].id, 'legacy-mission:p1')
  assert.equal(items[0].state, 'DONE')
  assert.equal(items[0].reason, 'adopted (legacy candidate flow)')
  assert.equal(items[0].updatedAt, '2026-09-01T00:00:00.000Z')
})

test('buildOwnerWorkItems: a run-less project with candidate.state READY_FOR_ADOPTION projects as READY, independent of mission.state', () => {
  const items = buildOwnerWorkItems([
    { id: 'p1', mission: { state: 'DRAFT' }, candidate: { state: 'READY_FOR_ADOPTION' } }
  ])
  assert.equal(items.length, 1)
  assert.equal(items[0].id, 'legacy-candidate:p1')
  assert.equal(items[0].state, 'READY')
  assert.deepEqual(items[0].availableActions, ['ADOPT'])
})

test('buildOwnerWorkItems: a run-less project can be BOTH legacy-active AND legacy-ready-for-adoption at once (two independent real fields), exactly like work-feed-summary.mjs allows', () => {
  const items = buildOwnerWorkItems([
    { id: 'p1', mission: { state: 'ACTIVE' }, candidate: { state: 'READY_FOR_ADOPTION' } }
  ])
  assert.deepEqual(
    new Set(items.map((i) => i.id)),
    new Set(['legacy-mission:p1', 'legacy-candidate:p1'])
  )
})

test('buildOwnerWorkItems: a legacy BLOCKED mission.state projects as NEEDS_YOU, using the real blockedReason verbatim', () => {
  const items = buildOwnerWorkItems([
    { id: 'p1', mission: { state: 'BLOCKED_ON_HEALTH', blockedReason: 'real degraded finding' } }
  ])
  assert.equal(items.length, 1)
  assert.equal(items[0].id, 'legacy-blocked:p1')
  assert.equal(items[0].state, 'NEEDS_YOU')
  assert.equal(items[0].reason, 'real degraded finding')
})

test('buildOwnerWorkItems: legacy BLOCKED is independent of run existence -- a project can be run-based WORKING and legacy-blocked at the same time (real, confirmed BUG-14 overlap)', () => {
  const run = newRun('r1', 'p1')
  const items = buildOwnerWorkItems(
    [{ id: 'p1', mission: { state: 'BLOCKED_ON_HEALTH', blockedReason: 'real degraded finding' } }],
    { p1: run }
  )
  assert.deepEqual(new Set(items.map((i) => i.id)), new Set(['run:r1', 'legacy-blocked:p1']))
  assert.equal(items.find((i) => i.id === 'legacy-blocked:p1').state, 'NEEDS_YOU')
})

// HQ Snapshot Migration (finish item A): researchMissionWorkItem carries
// the SAME real passthrough fields work-feed-summary.mjs's own
// researchMissionWorkItem already exposes -- ResearchMissionCard.tsx (one
// real, already-shared renderer) reads these directly regardless of which
// backend aggregation produced the item.
test('researchMissionWorkItem: carries the real missionId/phase/researchQuestion/entityType/expectedCount/freePathOnly ResearchMissionCard.tsx needs, alongside the owner state', () => {
  const item = researchMissionWorkItem(baseMission('m1'))
  assert.equal(item.missionId, 'm1')
  assert.equal(item.phase, 'DRAFT')
  assert.equal(item.state, 'PLANNING')
  assert.equal(item.researchQuestion, 'q')
  assert.equal(item.entityType, 'FIXTURE')
  assert.equal(item.expectedCount, 1)
  assert.equal(item.freePathOnly, true)
})

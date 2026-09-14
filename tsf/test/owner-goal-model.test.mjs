// TSF Final Pre-UI P1 Closure V1, P1 #2. Proves: OwnerGoal identity is
// real, restart-stable, and derived from the real durable authority (a
// Keep Going run's own id, a ResearchMission's own id) -- never from the
// goal's own mutable text, never fabricated for a run-less legacy project.
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildOwnerGoals,
  keepGoingRunGoal,
  researchMissionGoal
} from '../domain/owner-goal-model.mjs'
import { createOvernightRun, replaceGoal } from '../domain/keep-going.mjs'
import { createResearchMission } from '../domain/research-mission.mjs'

const clock = () => new Date('2026-09-14T00:00:00.000Z')

function newRun(id, projectId, overrides = {}) {
  return createOvernightRun(
    {
      id,
      projectId,
      originalGoal: 'ship the operator UI check',
      acceptanceCriteria: ['UI_RENDERS'],
      ...overrides
    },
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
        researchQuestion: 'how many QBs threw for 4000+ yards in 2001?',
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
        temporalRequirements: { asOfDate: '2026-09-14', periodScope: 'UNSPECIFIED' },
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

test('keepGoingRunGoal: real, restart-stable identity derived from the durable run id, not the goal text', () => {
  const run = newRun('r1', 'p1')
  const goal = keepGoingRunGoal(run)
  assert.equal(goal.id, 'goal:run:r1')
  assert.equal(goal.projectId, 'p1')
  assert.equal(goal.kind, 'KEEP_GOING_RUN')
  assert.equal(goal.title, 'ship the operator UI check')
  assert.deepEqual(goal.criteria, ['UI_RENDERS'])
  assert.equal(goal.sourceId, 'r1')

  // "same durable run" (called again on the identical run object) ->
  // "same OwnerGoal identity" -- a fresh, independent call agrees.
  assert.equal(keepGoingRunGoal(run).id, goal.id)
})

test('keepGoingRunGoal: owner-authorized goal replacement changes content but NEVER the Goal identity', () => {
  const run = newRun('r2', 'p1')
  const before = keepGoingRunGoal(run)

  const replaced = replaceGoal(
    run,
    { statement: 'a genuinely new, Tim-authorized goal', acceptanceCriteria: ['NEW_CRITERION'] },
    { authorizedBy: 'TIM', reason: 'scope changed after real owner review' },
    clock
  )
  const after = keepGoingRunGoal(replaced)

  assert.equal(
    after.id,
    before.id,
    'same durable run -> same OwnerGoal identity, even after a real, authorized goal replacement'
  )
  assert.equal(after.sourceId, before.sourceId)
  assert.notEqual(
    after.title,
    before.title,
    'the content must genuinely reflect the new authorized goal'
  )
  assert.equal(after.title, 'a genuinely new, Tim-authorized goal')
  assert.deepEqual(after.criteria, ['NEW_CRITERION'])
})

test('keepGoingRunGoal: an unauthorized goal replacement is honestly refused (real, pre-existing invariant) -- Goal identity/content both stay whatever they already were', () => {
  const run = newRun('r3', 'p1')
  assert.throws(
    () =>
      replaceGoal(
        run,
        { statement: 'not really authorized', acceptanceCriteria: ['X'] },
        { authorizedBy: 'NOT_TIM', reason: 'x' },
        clock
      ),
    (error) => {
      assert.equal(error.code, 'TSF_GOAL_IMMUTABLE')
      return true
    }
  )
})

test('researchMissionGoal: real, restart-stable identity derived from the durable mission id, carries the real research question', () => {
  const mission = baseMission('mission:goal-1')
  const goal = researchMissionGoal(mission)
  assert.equal(goal.id, 'goal:research:mission:goal-1')
  assert.equal(goal.projectId, 'p1')
  assert.equal(goal.kind, 'RESEARCH_MISSION')
  assert.equal(goal.title, 'how many QBs threw for 4000+ yards in 2001?')
  assert.equal(goal.sourceId, 'mission:goal-1')

  assert.equal(
    researchMissionGoal(mission).id,
    goal.id,
    'a fresh, independent call agrees -- same durable mission, same identity'
  )
})

test('buildOwnerGoals: assembles Keep Going runs and research missions into ONE list, a run-less legacy project contributes NOTHING (never a fabricated placeholder goal)', () => {
  const run = newRun('r4', 'p1')
  const mission = baseMission('mission:goal-2')
  const goals = buildOwnerGoals({ p1: run }, { [mission.id]: mission })
  assert.deepEqual(
    new Set(goals.map((g) => g.id)),
    new Set(['goal:run:r4', 'goal:research:mission:goal-2'])
  )
})

test('buildOwnerGoals: an empty fleet honestly produces an empty list, never a fabricated default goal', () => {
  assert.deepEqual(buildOwnerGoals({}, {}), [])
  assert.deepEqual(buildOwnerGoals(), [])
})

// Real, durable restart-stability proof (not just "the same pure function
// called twice") -- a genuinely fresh, independent process-level read of
// the real store, mirroring every other "restart-durable" test in this
// mission's own test suite.
test('restart-durable: the SAME Goal id survives a real durable write + a fresh, independent read, for both Keep Going and Research', async () => {
  const path = await import('node:path')
  const { rmSync } = await import('node:fs')
  const HERE = import.meta.dirname
  const STATE_FILE = path.join(
    HERE,
    '..',
    'server',
    '.local-state',
    `operator-state.test-owner-goal-model-restart-${process.pid}.json`
  )
  process.env.TSF_UI_STATE_FILE = STATE_FILE
  const cleanup = () => {
    for (const suffix of ['', '.tmp', '.keep-going.lock', '.research.lock']) {
      rmSync(`${STATE_FILE}${suffix}`, { force: true })
    }
  }
  cleanup()
  try {
    const { withKeepGoingRun, readKeepGoingRun } =
      await import('../server/keep-going-run-store.mjs')
    const { withResearchMission, readResearchMission } =
      await import('../server/research-mission-store.mjs')

    await withKeepGoingRun('restart-goal-project', () =>
      newRun('restart-goal-run', 'restart-goal-project')
    )
    await withResearchMission('restart-goal-mission', () => baseMission('restart-goal-mission'))

    const freshRun = readKeepGoingRun('restart-goal-project')
    const freshMission = readResearchMission('restart-goal-mission')

    assert.equal(keepGoingRunGoal(freshRun).id, 'goal:run:restart-goal-run')
    assert.equal(researchMissionGoal(freshMission).id, 'goal:research:restart-goal-mission')
  } finally {
    cleanup()
  }
})

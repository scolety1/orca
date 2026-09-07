// Command architecture, final conversational-context pass, Gap 1:
// explanatory follow-ups. Isolated-state-file pattern (env var set before
// any dynamic import that transitively touches server/data-store.mjs) --
// "why is it stuck?" needs a REAL Keep Going run's real state, not a
// hand-built stub.
import assert from 'node:assert/strict'
import test from 'node:test'
import { rmSync } from 'node:fs'
import path from 'node:path'

const HERE = import.meta.dirname
const STATE_FILE = path.join(HERE, '..', 'server', '.local-state', `operator-state.test-command-followup-context-${process.pid}.json`)
process.env.TSF_UI_STATE_FILE = STATE_FILE
const NONEXISTENT = path.join(HERE, 'fixtures', 'does-not-exist-binary')
process.env.TSF_PLANNER_CLAUDE_COMMAND = NONEXISTENT
process.env.TSF_PLANNER_CODEX_COMMAND = NONEXISTENT

const { respondCommand } = await import('../server/command-responder.mjs')
const { isExplanatoryFollowUp, explainPriorAnswer } = await import('../server/command-followup-context.mjs')
const { withKeepGoingRun } = await import('../server/keep-going-run-store.mjs')
const { createOvernightRun } = await import('../domain/keep-going.mjs')
const { createResearchMissionDurable, readResearchMissionStatus } = await import('../server/research-mission-driver.mjs')
const { raiseResearchNeedsYou } = await import('../domain/research-mission.mjs')
const { withResearchMission } = await import('../server/research-mission-store.mjs')
const { withPlannerMissionRecord } = await import('../server/planner-mission-store.mjs')
const { createPlannerMissionCheckpoint, raisePlannerNeedsYou, resolvePlannerNeedsYou } = await import('../domain/planner-mission-checkpoint.mjs')
const { loadState } = await import('../server/data-store.mjs')

function cleanupStateFile() {
  for (const suffix of ['', '.tmp', '.keep-going.lock', '.research.lock']) rmSync(`${STATE_FILE}${suffix}`, { force: true })
}
cleanupStateFile()

const clock = () => new Date('2026-09-05T09:00:00.000Z')

function project(id, displayName, sourceClass = 'REAL') {
  return { id, displayName, sourceClass, mission: { state: 'ONBOARDED', id: null, blockedReason: null }, candidate: null, receipts: { chain: [] } }
}

// keepGoingRuns comes from REAL, freshly-loaded disk state -- exactly the
// contract http-server.mjs itself relies on (opState is reloaded fresh per
// request), never a stale/incomplete stub. Seed real runs via
// seedActiveRun/seedStalledRun BEFORE calling this.
function opStateWithLastTurn({ resolvedProjectIds = [], researchMissionId = null, intent = 'STATUS', scope }) {
  return {
    ...loadState(),
    chatThreads: {
      __command__: [
        { role: 'user', content: 'x', at: clock().toISOString() },
        {
          role: 'assistant',
          content: 'some prior rendered text -- must never be read back by the explainer',
          at: clock().toISOString(),
          decisionClass: 'AUTO_DECIDE',
          intent,
          resolvedProjectIds,
          researchMissionId,
          scope: scope ?? (resolvedProjectIds.length === 1 ? 'PROJECT' : researchMissionId ? 'RESEARCH' : 'FLEET')
        }
      ]
    }
  }
}

async function seedActiveRun(projectId) {
  await withKeepGoingRun(projectId, () => createOvernightRun({ id: `run-${projectId}`, projectId, originalGoal: 'Test goal.', acceptanceCriteria: ['X'] }, clock))
}

async function seedStalledRun(projectId) {
  await withKeepGoingRun(projectId, (current) => {
    const run = current ?? createOvernightRun({ id: `run-${projectId}`, projectId, originalGoal: 'Test goal.', acceptanceCriteria: ['X'] }, clock)
    return { ...run, state: 'STALLED' }
  })
}

test('isExplanatoryFollowUp: recognizes the required shapes, and does not misfire on unrelated per-project RATIONALE phrasing', () => {
  for (const m of ['what does that mean?', 'why?', 'why', 'why is it stuck?', 'why is it blocked?', 'why is that blocked?', 'why that one?', "what's blocking it?", 'explain that', 'is that bad?', 'is this bad']) {
    assert.equal(isExplanatoryFollowUp(m), true, `"${m}" should be recognized`)
  }
  // "why did you ..." is chat-responder.mjs's own RATIONALE pattern's
  // territory (a different, pre-existing per-project intent) -- this
  // file's bare "why?" anchor must not also swallow it.
  assert.equal(isExplanatoryFollowUp('why did you choose that approach'), false)
})

test('explanatory follow-up: project status -> "what does that mean?" explains the REAL current project state, grounded not replayed', async () => {
  await seedActiveRun('followup-proj-active')
  const result = await respondCommand({
    message: 'what does that mean?',
    projects: [project('followup-proj-active', 'Followup Project Active')],
    opState: opStateWithLastTurn({ resolvedProjectIds: ['followup-proj-active'] }),
    clock
  })
  assert.equal(result.intent, 'FOLLOW_UP_EXPLANATION')
  assert.doesNotMatch(result.text, /some prior rendered text/, 'must never replay the raw prior answer text')
  assert.match(result.text, /Followup Project Active/)
  assert.deepEqual(result.resolvedProjectIds, ['followup-proj-active'])
})

test('explanatory follow-up: a STALLED run -> "why is it stuck?" explains the real reason and judges it worth attention', async () => {
  await seedStalledRun('followup-proj-stalled')
  const result = await respondCommand({
    message: 'why is it stuck?',
    projects: [project('followup-proj-stalled', 'Followup Project Stalled')],
    opState: opStateWithLastTurn({ resolvedProjectIds: ['followup-proj-stalled'] }),
    clock
  })
  assert.match(result.text, /STALLED/)
  assert.match(result.text, /worth a look/i)
})

test('explanatory follow-up: a healthy (non-NEEDS_YOU, non-STALLED) run -> "is that bad?" honestly says no', async () => {
  await seedActiveRun('followup-proj-healthy')
  const result = await respondCommand({
    message: 'is that bad?',
    projects: [project('followup-proj-healthy', 'Followup Project Healthy')],
    opState: opStateWithLastTurn({ resolvedProjectIds: ['followup-proj-healthy'] }),
    clock
  })
  assert.match(result.text, /expected/i)
})

test('explanatory follow-up: Needs You result -> "what\'s blocking it?" explains the real open item', async () => {
  const result = await respondCommand({
    message: "what's blocking it?",
    projects: [project('followup-needsyou-proj', 'Followup NeedsYou Project')],
    opState: {
      ...opStateWithLastTurn({ intent: 'NEEDS_YOU_QUERY', scope: 'FLEET' }),
      keepGoingRuns: { 'followup-needsyou-proj': { needsYou: [{ id: 'q1', question: 'A real decision is pending', resolvedAt: null }] } }
    },
    clock
  })
  assert.match(result.text, /Followup NeedsYou Project/)
  assert.match(result.text, /A real decision is pending/)
})

// Phase 6 finding, F18 follow-up: a real Planner Context Lifecycle
// needsYou item (raised via the real durable withPlannerMissionRecord +
// raisePlannerNeedsYou path, not a hand-built stub) is now discoverable
// through the SAME "why?"/"what's blocking it?" follow-up query
// explainNeedsYou uses, proving the fix reaches this second real call
// site too, not just command-responder.mjs's own NEEDS_YOU_QUERY branch.
test('explanatory follow-up: Needs You result -> "what\'s blocking it?" explains a real Planner Context Lifecycle needsYou item', async () => {
  const missionId = 'followup-planner-mission'
  let raisedId
  await withPlannerMissionRecord(missionId, (current) => {
    let checkpoint = current?.checkpoint ?? createPlannerMissionCheckpoint(
      { missionId, missionGoal: 'ship the followup fix', phase: 'BUILD', repoState: { branch: 'main', sha: 'c'.repeat(40) } },
      clock
    )
    checkpoint = raisePlannerNeedsYou(checkpoint, { question: 'A real planner decision is pending', category: 'AUTHORITY_REQUIRED' }, clock)
    raisedId = checkpoint.needsYou.at(-1).id
    return { ...(current ?? { lease: null }), checkpoint }
  })
  try {
    const result = await respondCommand({
      message: "what's blocking it?",
      projects: [],
      opState: opStateWithLastTurn({ intent: 'NEEDS_YOU_QUERY', scope: 'FLEET' }),
      clock
    })
    assert.match(result.text, /A real planner decision is pending/)
    // Honest: no project association exists on a planner checkpoint, so no
    // deep link is fabricated for this item.
    assert.deepEqual(result.resolvedProjectIds, [])
  } finally {
    // Resolve before this test ends -- this file's durable state accumulates
    // across tests (same on-disk state file, real store writes), and the
    // later "nothing actually open" test below depends on no OTHER test
    // leaving a real unresolved Needs You item behind.
    await withPlannerMissionRecord(missionId, (current) => ({
      ...current,
      checkpoint: resolvePlannerNeedsYou(current.checkpoint, raisedId, { note: 'test cleanup' }, clock)
    }))
  }
})

test('explanatory follow-up: Needs You result with nothing actually open -> honest empty explanation', async () => {
  const result = await respondCommand({
    message: "what's blocking it?",
    projects: [],
    opState: opStateWithLastTurn({ intent: 'NEEDS_YOU_QUERY', scope: 'FLEET' }),
    clock
  })
  assert.match(result.text, /nothing actually blocking/i)
})

test('explanatory follow-up: global advisory -> "why?" explains the real safety reasoning', async () => {
  const result = await respondCommand({
    message: 'why?',
    projects: [project('followup-fixture', 'Followup Fixture', 'FIXTURE'), project('followup-real', 'Followup Real')],
    opState: opStateWithLastTurn({ intent: 'GLOBAL_ADVISORY', scope: 'FLEET' }),
    clock
  })
  assert.match(result.text, /Followup Fixture/)
  assert.match(result.text, /deterministic fixture/i)
})

test('explanatory follow-up: research status -> "explain that" explains the REAL current mission phase', async () => {
  const missionId = 'mission:followup-explain-test'
  await createResearchMissionDurable(missionId, {
    projectId: 'test',
    specification: { schemaVersion: 'TSF_RESEARCH_SPECIFICATION_V1', id: 's', researchQuestion: 'q', entityType: 'T', requestedFields: [], sourcePolicy: { preferredSources: [], disallowedSources: [], licensingConstraints: [], freshnessPolicy: 'UNSPECIFIED', requireIndependentSources: false, minSourceCount: 0, allowCrossMissionLibraryReuse: true }, temporalRequirements: { asOfDate: null, periodScope: null }, budget: { maxCostUsd: null, maxLatencyMs: null, maxToolCallsPerNode: null }, toolPermissions: [] },
    expectedUniverse: { schemaVersion: 'TSF_EXPECTED_UNIVERSE_V1', entityType: 'T', expectedCount: 0, expectedEntities: [], source: 'test' }
  }, clock)
  const result = await respondCommand({
    message: 'explain that',
    projects: [],
    opState: opStateWithLastTurn({ intent: 'RESEARCH_STATUS', researchMissionId: missionId }),
    clock
  })
  assert.match(result.text, new RegExp(missionId))
  assert.match(result.text, /DRAFT/)
  assert.equal(result.researchMissionId, missionId)
})

test('explanatory follow-up: a WAITING_NEEDS_INPUT research mission explains the real open question, not just the phase label', async () => {
  const missionId = 'mission:followup-needs-input'
  await createResearchMissionDurable(missionId, {
    projectId: 'test',
    specification: { schemaVersion: 'TSF_RESEARCH_SPECIFICATION_V1', id: 's', researchQuestion: 'q', entityType: 'T', requestedFields: [], sourcePolicy: { preferredSources: [], disallowedSources: [], licensingConstraints: [], freshnessPolicy: 'UNSPECIFIED', requireIndependentSources: false, minSourceCount: 0, allowCrossMissionLibraryReuse: true }, temporalRequirements: { asOfDate: null, periodScope: null }, budget: { maxCostUsd: null, maxLatencyMs: null, maxToolCallsPerNode: null }, toolPermissions: [] },
    expectedUniverse: { schemaVersion: 'TSF_EXPECTED_UNIVERSE_V1', entityType: 'T', expectedCount: 0, expectedEntities: [], source: 'test' }
  }, clock)
  await withResearchMission(missionId, (mission) => raiseResearchNeedsYou(mission, { question: 'A real research decision is pending' }, clock, mission.revision))
  const result = await respondCommand({
    message: 'what does that mean?',
    projects: [],
    opState: opStateWithLastTurn({ intent: 'RESEARCH_STATUS', researchMissionId: missionId }),
    clock
  })
  assert.match(result.text, /A real research decision is pending/)
})

// --- explicit new topic outranks stale context ---
test('explanatory follow-up: an explicit NEW project name always outranks stale explanatory context -- normal resolution wins, no explanation path taken', async () => {
  const result = await respondCommand({
    message: 'what is the current state of followup-other-project',
    projects: [project('followup-stale', 'Followup Stale'), project('followup-other-project', 'Followup Other Project')],
    opState: opStateWithLastTurn({ resolvedProjectIds: ['followup-stale'] }),
    clock
  })
  assert.deepEqual(result.resolvedProjectIds, ['followup-other-project'])
  assert.notEqual(result.intent, 'FOLLOW_UP_EXPLANATION')
})

// --- ambiguous prior answer ---
test('explanatory follow-up: an ambiguous prior answer (more than one project) refuses rather than guesses', async () => {
  const result = await respondCommand({
    message: 'why is it stuck?',
    projects: [project('followup-amb-a', 'A'), project('followup-amb-b', 'B')],
    opState: opStateWithLastTurn({ resolvedProjectIds: ['followup-amb-a', 'followup-amb-b'] }),
    clock
  })
  assert.match(result.text, /more than one project/i)
  assert.deepEqual(result.resolvedProjectIds, [])
})

// --- deleted/completed run ---
test('explanatory follow-up: the referenced project has since been removed from the catalog -- never fabricates an explanation for something that no longer exists', async () => {
  const result = await respondCommand({
    message: 'what does that mean?',
    projects: [project('followup-someone-else', 'Someone Else')],
    opState: opStateWithLastTurn({ resolvedProjectIds: ['followup-deleted-project'] }),
    clock
  })
  assert.match(result.text, /no longer exists|isn'?t in the current catalog/i)
})

test('explanatory follow-up: a COMPLETE run explains honestly, not as if it were still in flight', async () => {
  await withKeepGoingRun('followup-proj-complete', () => {
    const run = createOvernightRun({ id: 'run-complete', projectId: 'followup-proj-complete', originalGoal: 'x', acceptanceCriteria: ['X'] }, clock)
    return { ...run, state: 'COMPLETE' }
  })
  const result = await respondCommand({
    message: 'what does that mean?',
    projects: [project('followup-proj-complete', 'Followup Project Complete')],
    opState: opStateWithLastTurn({ resolvedProjectIds: ['followup-proj-complete'] }),
    clock
  })
  assert.match(result.text, /READY_FOR_ADOPTION|COMPLETE/)
})

// --- authorization leakage ---
test('explanatory follow-up: never grants authorization -- a follow-up "run it" style verb inside an explanatory question still never dispatches', async () => {
  await seedActiveRun('followup-no-leak')
  const result = await respondCommand({
    message: 'why is it stuck, should I just run it again?',
    projects: [project('followup-no-leak', 'Followup No Leak')],
    opState: opStateWithLastTurn({ resolvedProjectIds: ['followup-no-leak'] }),
    clock
  })
  assert.equal(result.dispatchResults, undefined, 'an explanatory question must never itself trigger a dispatch')
})

test('explanatory follow-up: with no prior context at all, asks rather than fabricates', async () => {
  const result = await respondCommand({ message: 'why is it stuck?', projects: [], opState: { keepGoingRuns: {} }, clock })
  assert.match(result.text, /nothing recent to explain/i)
})

// --- direct unit coverage of explainPriorAnswer's own read-only contract ---
test('explainPriorAnswer: returns null (not a follow-up) for an unrelated message -- caller falls through unchanged', () => {
  assert.equal(explainPriorAnswer({ message: 'go ahead and fix alpha-widgets', opState: {}, projects: [], clock }), null)
})

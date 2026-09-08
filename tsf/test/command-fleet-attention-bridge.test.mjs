// FLEET_ATTENTION_CHANGED_WHILE_AWAY calls the real
// drainDueAttentionNotifications reconciler, which durably writes to the
// attention-notification-event store (attention-status-reconciler.test.mjs's
// own idiom) -- isolated here for the same reason.
import assert from 'node:assert/strict'
import test from 'node:test'
import path from 'node:path'
import { rmSync } from 'node:fs'

const HERE = import.meta.dirname
const STATE_FILE = path.join(HERE, '..', 'server', '.local-state', `operator-state.test-command-fleet-attention-bridge-${process.pid}.json`)
process.env.TSF_UI_STATE_FILE = STATE_FILE

function cleanupStateFile() {
  for (const suffix of ['', '.tmp', '.attention-notification-event.lock']) {
    rmSync(`${STATE_FILE}${suffix}`, { force: true })
  }
}
cleanupStateFile()
test.after(cleanupStateFile)

const {
  classifyFleetAttentionRequest,
  respondFleetAttentionCommand,
  shouldRouteToFleetAttentionBridge
} = await import('../server/command-fleet-attention-bridge.mjs')
const { createFinding, transitionFinding } = await import('../domain/self-improvement-finding.mjs')
const { createOvernightRun, markStalled } = await import('../domain/keep-going.mjs')
const { addResearchNode, createResearchMission, transitionResearchMission } = await import('../domain/research-mission.mjs')
const { buildResourcePressureState } = await import('../domain/resource-pressure-governor.mjs')

const CLOCK = () => new Date('2026-09-07T12:00:00.000Z')

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

function project(id, overrides = {}) {
  return { id, displayName: id, mission: { state: 'ONBOARDED', id: null, blockedReason: null }, candidate: null, receipts: { chain: [] }, ...overrides }
}

function emptyDeps(overrides = {}) {
  return { projects: [], keepGoingRuns: {}, researchMissions: {}, plannerMissionRecords: {}, selfImprovementFindings: {}, ...overrides }
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
      projectId: 'p1',
      specification: baseMissionSpec(),
      expectedUniverse: { schemaVersion: 'TSF_EXPECTED_UNIVERSE_V1', entityType: 'FIXTURE', expectedCount: 1, expectedEntities: [] },
      ...overrides
    },
    CLOCK
  )
}

test('classifyFleetAttentionRequest recognizes the real trigger phrasings', () => {
  assert.equal(classifyFleetAttentionRequest('what finished?'), 'FLEET_ATTENTION_COMPLETED')
  assert.equal(classifyFleetAttentionRequest('what just finished?'), 'FLEET_ATTENTION_COMPLETED')
  assert.equal(classifyFleetAttentionRequest('what completed?'), 'FLEET_ATTENTION_COMPLETED')
  assert.equal(classifyFleetAttentionRequest("what's waiting on resources?"), 'FLEET_ATTENTION_WAITING_ON_RESOURCES')
  assert.equal(classifyFleetAttentionRequest('anything waiting on resources?'), 'FLEET_ATTENTION_WAITING_ON_RESOURCES')
  assert.equal(classifyFleetAttentionRequest('what failed today?'), 'FLEET_ATTENTION_FAILED_TODAY')
  assert.equal(classifyFleetAttentionRequest('did anything change while I was gone?'), 'FLEET_ATTENTION_CHANGED_WHILE_AWAY')
  assert.equal(classifyFleetAttentionRequest('what changed while I was away?'), 'FLEET_ATTENTION_CHANGED_WHILE_AWAY')
})

test('classifyFleetAttentionRequest does not hijack ordinary chat', () => {
  assert.equal(classifyFleetAttentionRequest("what's the status?"), null)
  assert.equal(classifyFleetAttentionRequest('hello there'), null)
})

// REQUIRED PROOF: zero collision with messages the OTHER bridges/handlers
// already own.
test('REQUIRED PROOF: zero collision with messages already owned elsewhere', () => {
  assert.equal(classifyFleetAttentionRequest('what needs me?'), null)
  assert.equal(classifyFleetAttentionRequest('what is ready for adoption?'), null)
  assert.equal(classifyFleetAttentionRequest("what's ready to adopt?"), null)
  assert.equal(classifyFleetAttentionRequest('dogfood orca'), null)
  assert.equal(classifyFleetAttentionRequest('review the UI'), null)
  assert.equal(classifyFleetAttentionRequest('what did TSF find?'), null)
  assert.equal(classifyFleetAttentionRequest('what failed verification?'), null)
  assert.equal(classifyFleetAttentionRequest('research the market size for widgets'), null)
  assert.equal(classifyFleetAttentionRequest('build a dataset of companies'), null)
  // Operator Polish V1, Wave A, Phase 5: the 3 broadened self-improvement
  // phrasings must not collide with this bridge's own intents either.
  assert.equal(classifyFleetAttentionRequest('What did TSF fix by itself?'), null)
  assert.equal(classifyFleetAttentionRequest('What needs approval?'), null)
  assert.equal(classifyFleetAttentionRequest("Why didn't TSF fix this?"), null)
})

test('shouldRouteToFleetAttentionBridge mirrors classifyFleetAttentionRequest', () => {
  assert.equal(shouldRouteToFleetAttentionBridge('what finished?'), true)
  assert.equal(shouldRouteToFleetAttentionBridge('hello'), false)
})

test('respondFleetAttentionCommand returns null for a non-matching message (falls through to normal chat)', async () => {
  assert.equal(await respondFleetAttentionCommand({ message: 'what is running right now?' }), null)
})

test('FLEET_ATTENTION_COMPLETED: honest empty state, then a real completed research mission appears', async () => {
  const empty = await respondFleetAttentionCommand({ message: 'what finished?', clock: CLOCK, deps: emptyDeps() })
  assert.equal(empty.intent, 'FLEET_ATTENTION_COMPLETED')
  assert.match(empty.text, /Nothing has completed recently/)
  assert.deepEqual(empty.resolvedProjectIds, [])

  // COMPLETED_RECENTLY is only real for a research mission reaching COMPLETE
  // (or a legacy-reserved run state live-work-feed.mjs never actually emits
  // -- see fleet-attention-status.mjs's own header comment) -- mirrors
  // fleet-attention-status.test.mjs's own fixture for this category.
  let mission = baseMission('mission:complete')
  mission = addResearchNode(mission, { id: 'node:a', nodeRole: 'PRIMARY_RESEARCH', requestedFields: [], requestedOutputSchema: {} }, CLOCK)
  mission = transitionResearchMission(mission, 'COMPLETE', { reason: 'done', expectedRevision: mission.revision }, CLOCK)
  const result = await respondFleetAttentionCommand({
    message: 'what just finished?',
    clock: CLOCK,
    deps: emptyDeps({ projects: [project('p1', { displayName: 'Project One' })], researchMissions: { [mission.id]: mission } })
  })
  assert.match(result.text, /research mission reached COMPLETE/)
  assert.deepEqual(result.resolvedProjectIds, ['p1'])
})

test('FLEET_ATTENTION_WAITING_ON_RESOURCES: honest empty state at HEALTHY, real item at CRITICAL', async () => {
  const healthy = buildResourcePressureState({ hostMemory: { totalBytes: 16e9, freeBytes: 8e9, availableBytes: 8e9 } }, CLOCK)
  const empty = await respondFleetAttentionCommand({
    message: "what's waiting on resources?",
    clock: CLOCK,
    deps: emptyDeps({ resourcePressureState: healthy })
  })
  assert.match(empty.text, /Nothing is currently waiting on host resources/)

  const critical = buildResourcePressureState({ hostMemory: { totalBytes: 16e9, freeBytes: 2e9, availableBytes: 2e9 } }, CLOCK)
  const result = await respondFleetAttentionCommand({
    message: 'anything waiting on resources?',
    clock: CLOCK,
    deps: emptyDeps({ resourcePressureState: critical })
  })
  assert.match(result.text, /Host resource pressure/)
})

test('FLEET_ATTENTION_FAILED_TODAY: excludes an item whose changedAt is yesterday, includes one from today', async () => {
  // A real lastCheckpointAt requires a real checkpoint entry -- markStalled
  // alone leaves `checkpoints` empty, which is honestly excluded (null
  // changedAt) rather than assumed "today"; added here so this test
  // exercises the real date-boundary comparison, not the null-exclusion path.
  const runToday = {
    ...markStalled(createOvernightRun({ id: 'r-today', projectId: 'p-today', originalGoal: 'x', acceptanceCriteria: ['X'] }, CLOCK), [], CLOCK),
    checkpoints: [{ at: CLOCK().toISOString() }]
  }
  const yesterdayClock = () => new Date('2026-09-06T12:00:00.000Z')
  const runYesterday = {
    ...markStalled(createOvernightRun({ id: 'r-yesterday', projectId: 'p-yesterday', originalGoal: 'x', acceptanceCriteria: ['X'] }, yesterdayClock), [], yesterdayClock),
    checkpoints: [{ at: yesterdayClock().toISOString() }]
  }

  const result = await respondFleetAttentionCommand({
    message: 'what failed today?',
    clock: CLOCK,
    deps: emptyDeps({
      projects: [project('p-today', { displayName: 'Today Project' }), project('p-yesterday', { displayName: 'Yesterday Project' })],
      keepGoingRuns: { 'p-today': runToday, 'p-yesterday': runYesterday }
    })
  })
  assert.match(result.text, /Today Project/)
  assert.doesNotMatch(result.text, /Yesterday Project/)
  assert.deepEqual(result.resolvedProjectIds, ['p-today'])
})

test('FLEET_ATTENTION_FAILED_TODAY: honest empty state when nothing failed', async () => {
  const result = await respondFleetAttentionCommand({ message: 'what failed today?', clock: CLOCK, deps: emptyDeps() })
  assert.match(result.text, /Nothing has failed today/)
})

test('FLEET_ATTENTION_CHANGED_WHILE_AWAY: drains and reports real due notices, empty on a second call (already-delivered)', async () => {
  let finding = createFinding(rawFinding({ affectedSurface: 'changed-while-away-surface' }), CLOCK)
  finding = transitionFinding(finding, 'VERIFIED', { reason: 'x' }, CLOCK)
  finding = transitionFinding(finding, 'NEEDS_OWNER', { reason: 'AUTOFIX_ELIGIBILITY_CLASSIFIED' }, CLOCK)
  const deps = emptyDeps({ selfImprovementFindings: { [finding.findingId]: finding } })

  const first = await respondFleetAttentionCommand({ message: 'did anything change while I was gone?', clock: CLOCK, deps })
  assert.match(first.text, /changed-while-away-surface/)

  const second = await respondFleetAttentionCommand({ message: 'what changed while I was away?', clock: CLOCK, deps })
  assert.match(second.text, /Nothing changed while you were away/)
})

test('FLEET_ATTENTION_CHANGED_WHILE_AWAY: honest empty state when nothing is due', async () => {
  const result = await respondFleetAttentionCommand({ message: 'did anything change while I was away?', clock: CLOCK, deps: emptyDeps() })
  assert.match(result.text, /Nothing changed while you were away/)
})

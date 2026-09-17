// TSF Research-Driven Development V1 -- bridge integration test. Proves
// the full CHALLENGE -> BUILD sequencing end to end against a REAL,
// durably-stored, integrity-checked ResearchMission (built through the
// same decideReconciliation/admitReconciliationDecision path
// research-reconciliation.mjs's own header says is the ONLY way a real
// CanonicalFact can ever be constructed -- never hand-faked), driven
// through the REAL Keep Going dispatch loop (stub Orca CLI only; no new
// dispatch/poll code of this module's own is exercised here that isn't
// already covered by keep-going-dispatch-loop.test.mjs itself).
import assert from 'node:assert/strict'
import test from 'node:test'
import { rmSync, mkdtempSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const HERE = import.meta.dirname
const STATE_FILE = path.join(HERE, '..', 'server', '.local-state', `operator-state.test-research-driven-development-bridge-${process.pid}.json`)
process.env.TSF_UI_STATE_FILE = STATE_FILE
process.env.TSF_ORCA_CLI_COMMAND = path.join(HERE, 'fixtures', 'stub-orca-cli.mjs')
process.env.STUB_ORCA_MODE = 'success'
process.env.TSF_RESOURCE_PRESSURE_TEST_TOTAL_BYTES = String(16 * 1024 ** 3)
process.env.TSF_RESOURCE_PRESSURE_TEST_FREE_BYTES = String(8 * 1024 ** 3)
process.env.STUB_ORCA_TASKS = JSON.stringify([{ id: 'stub-task-id', status: 'completed' }])
delete process.env.ORCA_TERMINAL_HANDLE

for (const suffix of ['', '.tmp', '.keep-going.lock', '.research-mission.lock']) {
  rmSync(`${STATE_FILE}${suffix}`, { force: true })
}

const { startResearchDrivenRun, tickUntilWaveSettled } = await import('../server/research-driven-development-bridge.mjs')
const { withResearchMission, readResearchMission } = await import('../server/research-mission-store.mjs')
const { readKeepGoingRun } = await import('../server/keep-going-run-store.mjs')
const { createResearchMission, addResearchNode, completeResearchMission } = await import('../domain/research-mission.mjs')
const { decideReconciliation, admitReconciliationDecision } = await import('../domain/research-reconciliation.mjs')

const clock = () => new Date('2026-09-17T00:00:00.000Z')
const PROJECT_ID = 'research-driven-bridge-fixture'
const MISSION_ID = 'research-driven-bridge-mission'

// Matches command-research-bridge.test.mjs's own fieldSpec/universe
// helpers -- the minimum real TSF_RESEARCH_SPECIFICATION_V1 shape
// createResearchMission validates against.
function fixtureSpecification() {
  return {
    schemaVersion: 'TSF_RESEARCH_SPECIFICATION_V1',
    id: 'spec:research-driven-bridge-test',
    researchQuestion: 'What is the real rate-limit strategy?',
    entityType: 'API',
    requestedFields: [{ fieldName: 'rateLimitStrategy', valueType: 'string', required: true }],
    sourcePolicy: {
      preferredSources: [],
      disallowedSources: [],
      licensingConstraints: [],
      freshnessPolicy: 'HISTORICAL_STATIC',
      requireIndependentSources: false,
      minSourceCount: 0,
      allowCrossMissionLibraryReuse: true
    },
    temporalRequirements: { asOfDate: '2026-09-17T00:00:00.000Z', periodScope: 'test-period' },
    budget: { maxCostUsd: null, maxLatencyMs: null, maxToolCallsPerNode: null },
    toolPermissions: []
  }
}

function fixtureExpectedUniverse() {
  return {
    schemaVersion: 'TSF_EXPECTED_UNIVERSE_V1',
    entityType: 'API',
    expectedCount: 1,
    expectedEntities: [{ entityId: 'PaymentAPI', identityHints: {} }],
    source: 'test fixture'
  }
}

async function seedGroundedCompleteMission({ missionId = MISSION_ID, complete = true } = {}) {
  await withResearchMission(missionId, () =>
    createResearchMission(
      { id: missionId, projectId: PROJECT_ID, specification: fixtureSpecification(), expectedUniverse: fixtureExpectedUniverse() },
      clock
    )
  )
  await withResearchMission(missionId, (m) =>
    addResearchNode(m, { id: 'node-1', nodeRole: 'PRIMARY_RESEARCH', targetEntity: { entityId: 'PaymentAPI' } }, clock, m.revision)
  )
  await withResearchMission(missionId, (m) =>
    decideReconciliation(
      m,
      'node-1',
      {
        fieldName: 'rateLimitStrategy',
        decisionType: 'ACCEPT_DERIVED_VALUE',
        decidedValue: 'exponential backoff, 3 retries',
        rationale: 'derived from the documented API rate-limit headers',
        decidedBy: 'test'
      },
      clock,
      m.revision
    )
  )
  const withDecision = readResearchMission(missionId)
  const decisionId = withDecision.nodes.find((n) => n.id === 'node-1').reconciliationDecisions[0].id
  await withResearchMission(missionId, (m) => admitReconciliationDecision(m, 'node-1', decisionId, clock, m.revision))
  if (complete) {
    await withResearchMission(missionId, (m) => completeResearchMission(m, clock, m.revision))
  }
}

test('startResearchDrivenRun: refuses honestly when the research mission does not exist', async () => {
  const result = await startResearchDrivenRun(PROJECT_ID, 'no-such-mission', { clock, challengeWorktree: os.tmpdir() })
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'RESEARCH_MISSION_NOT_FOUND')
})

// Real adversarial-review finding: readResearchMissionArtifacts integrity-
// checks individual CanonicalFacts but never checked the MISSION's own
// state -- "one real fact already exists" is not the same claim as "this
// research is actually done." An ACTIVE, still-in-progress mission must
// never ground a real BUILD run.
test('startResearchDrivenRun: refuses honestly when the research mission has a real CanonicalFact but is not yet COMPLETE', async () => {
  const missionId = 'research-driven-bridge-mission-incomplete'
  await seedGroundedCompleteMission({ missionId, complete: false })
  const result = await startResearchDrivenRun(PROJECT_ID, missionId, { clock, challengeWorktree: os.tmpdir() })
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'RESEARCH_MISSION_NOT_COMPLETE')
  assert.equal(result.detail, 'ACTIVE')
})

// Real adversarial-review finding: a dispatch refused before any real
// wave ever went in flight (resource pressure here) previously left
// tickUntilWaveSettled's own "no wave in flight" check reading that as
// an already-settled, successful CHALLENGE -- silently starting the real
// BUILD run with an empty, unreviewed finding set.
test('startResearchDrivenRun: fails closed, never starting BUILD, when the CHALLENGE dispatch is refused by the Resource Pressure Governor before any real wave goes in flight', async () => {
  const missionId = 'research-driven-bridge-mission-resource-refused'
  await seedGroundedCompleteMission({ missionId })
  const previousTotal = process.env.TSF_RESOURCE_PRESSURE_TEST_TOTAL_BYTES
  const previousFree = process.env.TSF_RESOURCE_PRESSURE_TEST_FREE_BYTES
  process.env.TSF_RESOURCE_PRESSURE_TEST_TOTAL_BYTES = String(16 * 1024 ** 3)
  process.env.TSF_RESOURCE_PRESSURE_TEST_FREE_BYTES = String(1 * 1024 ** 3) // CRITICAL tier
  try {
    const result = await startResearchDrivenRun('research-driven-bridge-resource-refused-proj', missionId, {
      clock,
      challengeWorktree: os.tmpdir(),
      tickOptions: { maxTicks: 1, pollIntervalMs: 1 }
    })
    assert.equal(result.ok, false)
    assert.equal(result.reason, 'CHALLENGE_NOT_DISPATCHED')
  } finally {
    process.env.TSF_RESOURCE_PRESSURE_TEST_TOTAL_BYTES = previousTotal
    process.env.TSF_RESOURCE_PRESSURE_TEST_FREE_BYTES = previousFree
  }
})

// Real adversarial-review finding: a CHALLENGE task that genuinely
// dispatched but ended FAILED (not completed) must never be read as "ran
// successfully, found nothing" -- distinguishing "never ran" from "ran
// and failed" from "ran and succeeded" is the whole point of this check.
test('startResearchDrivenRun: fails closed when the real CHALLENGE task reaches a FAILED (not completed) outcome', async () => {
  const missionId = 'research-driven-bridge-mission-challenge-failed'
  await seedGroundedCompleteMission({ missionId })
  const previousTasks = process.env.STUB_ORCA_TASKS
  process.env.STUB_ORCA_TASKS = JSON.stringify([{ id: 'stub-task-id', status: 'failed' }])
  try {
    const result = await startResearchDrivenRun('research-driven-bridge-challenge-failed-proj', missionId, {
      clock,
      challengeWorktree: os.tmpdir(),
      tickOptions: { maxTicks: 5, pollIntervalMs: 1 }
    })
    assert.equal(result.ok, false)
    assert.equal(result.reason, 'CHALLENGE_TASK_FAILED')
  } finally {
    process.env.STUB_ORCA_TASKS = previousTasks
  }
})

// Real adversarial-review finding: a genuinely COMPLETED CHALLENGE task
// whose one required output (challenge-findings.json) never showed up or
// was unreadable must never silently proceed as "reviewed, found
// nothing" -- the real BUILD run's own spec would then falsely claim
// "Challenge review raised no findings" for a review nobody can actually
// verify happened.
test('startResearchDrivenRun: fails closed when the CHALLENGE task completes but its required findings file is missing', async () => {
  const missionId = 'research-driven-bridge-mission-challenge-missing-output'
  await seedGroundedCompleteMission({ missionId })
  const emptyWorktree = mkdtempSync(path.join(os.tmpdir(), 'rdd-challenge-missing-'))
  const result = await startResearchDrivenRun('research-driven-bridge-challenge-missing-output-proj', missionId, {
    clock,
    challengeWorktree: emptyWorktree,
    tickOptions: { maxTicks: 5, pollIntervalMs: 1 }
  })
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'CHALLENGE_FINDINGS_UNREADABLE')
})

test('startResearchDrivenRun: CHALLENGE runs first through the REAL Keep Going dispatch loop, its findings become traceable acceptance criteria, then the real BUILD run starts grounded in the research (RESEARCH_GROUNDED, CHALLENGE, SPEC_TRACEABILITY, REAL_CODEX via the real orchestration bridge/stub CLI boundary)', async () => {
  await seedGroundedCompleteMission()
  const challengeWorktree = mkdtempSync(path.join(os.tmpdir(), 'rdd-challenge-'))
  // Stands in for the real Codex worker's own file write during the real
  // pilot -- the stub CLI never actually runs a worker process, so the
  // test supplies what a real one would have produced, at the exact path
  // the bridge's own documented contract (CHALLENGE_FINDINGS_FILENAME)
  // says it reads from.
  writeFileSync(
    path.join(challengeWorktree, 'challenge-findings.json'),
    JSON.stringify([
      { id: 'chal-1', severity: 'MUST_FIX', summary: 'Handle a missing Retry-After header honestly instead of assuming a fixed backoff.' }
    ])
  )

  const result = await startResearchDrivenRun(PROJECT_ID, MISSION_ID, {
    clock,
    challengeWorktree,
    tickOptions: { maxTicks: 5, pollIntervalMs: 5 }
  })

  assert.equal(result.ok, true)
  assert.equal(result.challenge.timedOut, false, 'the disposable CHALLENGE run must reach a real terminal state, not time out')
  assert.equal(result.challenge.findings.length, 1)
  assert.equal(result.challenge.warning, null)

  // SPEC_TRACEABILITY: the real research CanonicalFact AND the resolved
  // CHALLENGE finding both show up as distinctly-tagged, traceable
  // acceptance criteria on the real BUILD run.
  const factCriteria = result.missionSpec.acceptanceCriteria.filter((c) => c.startsWith('[FACT:'))
  const challengeCriteria = result.missionSpec.acceptanceCriteria.filter((c) => c.startsWith('[CHALLENGE:'))
  assert.equal(factCriteria.length, 1)
  assert.match(factCriteria[0], /rateLimitStrategy/)
  assert.equal(challengeCriteria.length, 1)
  assert.match(challengeCriteria[0], /Retry-After/)
  assert.equal(result.missionSpec.researchDrivenProvenance.researchMissionId, MISSION_ID)

  // RESTART_DURABILITY (partial, real-store half): the BUILD run this
  // produced is really, durably readable back through the SAME real
  // store every other Keep Going caller uses -- not just returned in
  // memory.
  const durable = readKeepGoingRun(PROJECT_ID)
  assert.equal(durable.id, result.run.id)
  assert.equal(durable.missionSpec.researchDrivenProvenance.researchMissionId, MISSION_ID)
  assert.equal(durable.state, 'ACTIVE', 'the real build run is left ACTIVE, ready for the normal autonomous dispatch loop to advance it')
})

test('tickUntilWaveSettled: honestly reports a timeout rather than fabricating a settled wave when the dispatched task never reaches a terminal status', async () => {
  const previousTasks = process.env.STUB_ORCA_TASKS
  // A real task stuck 'in_progress' forever -- the wave dispatches (real
  // inFlightWave), but every settle tick's listOrchestrationTasks keeps
  // reporting it non-terminal, exactly the shape a genuinely hung/slow
  // real worker would produce.
  process.env.STUB_ORCA_TASKS = JSON.stringify([{ id: 'stub-task-id', status: 'in_progress' }])
  try {
    const { withKeepGoingRun } = await import('../server/keep-going-run-store.mjs')
    const { createOvernightRun } = await import('../domain/keep-going.mjs')
    const projectId = 'research-driven-bridge-timeout-fixture'
    await withKeepGoingRun(projectId, () =>
      createOvernightRun({ id: 'run-timeout', projectId, originalGoal: 'x', acceptanceCriteria: ['x'], usageMode: 'BALANCED' }, clock)
    )
    const item = [{ id: 'stuck-item', scope: ['x.md'], worktree: 'C:/TSF_ORCA' }]
    const { run, timedOut } = await tickUntilWaveSettled(projectId, item, clock, { maxTicks: 3, pollIntervalMs: 1 })
    assert.equal(timedOut, true, 'never fabricates a settled wave for a task that never reached a terminal status')
    assert.ok(run.inFlightWave, 'the wave is still genuinely, honestly in flight')
  } finally {
    process.env.STUB_ORCA_TASKS = previousTasks
  }
})

// REQ-002 real wiring proof: a mission that genuinely reaches COMPLETE
// through the real fleet driver (advanceOneMission's CHECK_COMPLETE branch)
// durably records a real lesson into the cross-mission Platform Learning
// Ledger -- not just a standalone, never-called extraction function.
// Before/after: the ledger is empty before completion, and durably holds
// the evidenced lesson after, surviving a fresh read.
import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { rmSync } from 'node:fs'

const STATE_FILE = path.join(import.meta.dirname, '..', 'server', '.local-state', `operator-state.test-fleet-driver-learning-ledger-${process.pid}.json`)
process.env.TSF_UI_STATE_FILE = STATE_FILE
function cleanupStateFile() {
  for (const suffix of ['', '.tmp', '.research.lock', '.platform-learning-ledger.lock']) {
    rmSync(`${STATE_FILE}${suffix}`, { force: true })
  }
}
cleanupStateFile()
test.after(cleanupStateFile)

const { createResearchMissionDurable } = await import('../server/research-mission-driver.mjs')
const { withResearchMission } = await import('../server/research-mission-store.mjs')
const { advanceOneMission } = await import('../server/research-mission-fleet-driver.mjs')
const { readPlatformLearningLedger } = await import('../server/platform-learning-ledger-store.mjs')

const clock = () => new Date('2026-09-06T12:00:00.000Z')

async function setupMission(missionId) {
  const spec = {
    schemaVersion: 'TSF_RESEARCH_SPECIFICATION_V1',
    id: `spec:${missionId}`,
    researchQuestion: 'q',
    entityType: 'FIXTURE',
    requestedFields: [{ fieldName: 'salaryCap', valueType: 'number', required: true }],
    sourcePolicy: { preferredSources: [], disallowedSources: [], licensingConstraints: [], freshnessPolicy: 'UNSPECIFIED', requireIndependentSources: false, minSourceCount: 0, allowCrossMissionLibraryReuse: true },
    temporalRequirements: { asOfDate: '2026-09-06', periodScope: '2020' },
    budget: { maxCostUsd: 0, maxLatencyMs: null, maxToolCallsPerNode: null },
    toolPermissions: []
  }
  await createResearchMissionDurable(
    missionId,
    {
      projectId: 'test',
      specification: spec,
      expectedUniverse: { schemaVersion: 'TSF_EXPECTED_UNIVERSE_V1', entityType: 'FIXTURE', expectedCount: 1, expectedEntities: [{ entityId: 'x', identityHints: {} }] },
      nodes: [{ id: 'node:x', nodeRole: 'PRIMARY_RESEARCH', targetEntity: { entityId: 'x', name: 'X' }, requestedFields: spec.requestedFields, requestedOutputSchema: { type: 'object', properties: {} } }]
    },
    clock
  )
}

test('BEFORE: the Platform Learning Ledger has no lesson for this mission before it completes', async () => {
  assert.equal(readPlatformLearningLedger(), null)
})

test('AFTER: a mission that genuinely completes through advanceOneMission durably records a real, evidenced lesson', async () => {
  const missionId = 'mission:learning-ledger-wiring-proof'
  await setupMission(missionId)
  // Real, durable evidence a real provider dispatch genuinely failed once
  // before this node's field was eventually resolved -- the exact shape
  // PROVIDER_RELIABILITY_SIGNAL extracts from.
  await withResearchMission(missionId, (mission) => ({
    ...mission,
    nodes: [
      {
        ...mission.nodes[0],
        status: 'ADMITTED',
        rawResults: [
          { digest: 'd1', result: { provider: 'FLAKY_TEST_PROVIDER', status: 'FAILED' } },
          { digest: 'd2', result: { provider: 'FLAKY_TEST_PROVIDER', status: 'SUCCEEDED' } }
        ],
        canonicalFacts: [
          { schemaVersion: 'TSF_CANONICAL_FACT_V1', id: 'fact:salaryCap', fieldName: 'salaryCap', value: 1, temporalScope: null, reconciliationDecisionId: 'decision:test', derivationLineage: null, canonicalizedAt: clock().toISOString() }
        ]
      }
    ]
  }))

  const result = await advanceOneMission(missionId, clock, {})
  assert.equal(result.action, 'COMPLETED')
  assert.equal(result.lessonsRecorded, 1, 'the real FAILED raw result must produce exactly one durable PROVIDER_RELIABILITY_SIGNAL lesson')

  // Durable proof, not just the in-memory return value: a fresh read of the
  // store sees the same lesson.
  const ledger = readPlatformLearningLedger()
  assert.equal(ledger.lessons.length, 1)
  const lesson = ledger.lessons[0]
  assert.equal(lesson.category, 'PROVIDER_RELIABILITY_SIGNAL')
  assert.equal(lesson.epistemicKind, 'SYSTEM_GUIDANCE')
  assert.deepEqual(lesson.sourceMissionIds, [missionId])
  assert.match(lesson.statement, /FLAKY_TEST_PROVIDER/)
})

test('a second completed mission with no real failures adds zero new lessons -- the ledger never fabricates a signal that is not really there', async () => {
  const missionId = 'mission:learning-ledger-wiring-proof-clean'
  await setupMission(missionId)
  await withResearchMission(missionId, (mission) => ({
    ...mission,
    nodes: [
      {
        ...mission.nodes[0],
        status: 'ADMITTED',
        canonicalFacts: [
          { schemaVersion: 'TSF_CANONICAL_FACT_V1', id: 'fact:salaryCap', fieldName: 'salaryCap', value: 1, temporalScope: null, reconciliationDecisionId: 'decision:test', derivationLineage: null, canonicalizedAt: clock().toISOString() }
        ]
      }
    ]
  }))
  const before = readPlatformLearningLedger().lessons.length
  const result = await advanceOneMission(missionId, clock, {})
  assert.equal(result.action, 'COMPLETED')
  assert.equal(result.lessonsRecorded, 0)
  assert.equal(readPlatformLearningLedger().lessons.length, before)
})

// F3 (REQ-002 read side): retrieveLessonGuidance's ONE live production
// consumer -- advisory-only, surfaced on a real DISPATCH/RETRY_DISPATCH
// result from advanceOneMission. Proves: (a) a lesson recorded through the
// REAL recordLessonsFromCompletedMission path (not a hand-built fixture) is
// retrievable and surfaces here; (b) the advisory never changes what a real
// dispatch does -- a lesson warning about a provider never blocks/reroutes a
// dispatch that real current evidence (a scripted successful worker result)
// says is fine; (c) an empty ledger produces a true no-op (no `advisories`
// key), never a fabricated one.
import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { rmSync } from 'node:fs'
import { createDeterministicFakeResearchWorker } from '../adapters/deterministic-fake-research-worker.mjs'
import { buildBoundedResearchRequest } from '../domain/research-node.mjs'

const STATE_FILE = path.join(import.meta.dirname, '..', 'server', '.local-state', `operator-state.test-fleet-driver-dispatch-advisories-${process.pid}.json`)
process.env.TSF_UI_STATE_FILE = STATE_FILE
// Forces HEALTHY so the Resource Pressure Governor (F1) never refuses these
// dispatches under real host memory load -- this file's own real subject is
// advisory wiring, not governor gating (chat-dispatch-bridge.test.mjs's own
// established convention).
process.env.TSF_RESOURCE_PRESSURE_TEST_TOTAL_BYTES = String(16 * 1024 ** 3)
process.env.TSF_RESOURCE_PRESSURE_TEST_FREE_BYTES = String(8 * 1024 ** 3)
function cleanupStateFile() {
  for (const suffix of ['', '.tmp', '.research.lock', '.platform-learning-ledger.lock']) {
    rmSync(`${STATE_FILE}${suffix}`, { force: true })
  }
}
cleanupStateFile()
test.after(cleanupStateFile)

const { createResearchMissionDurable } = await import('../server/research-mission-driver.mjs')
const { withResearchMission, readResearchMission } = await import('../server/research-mission-store.mjs')
const { advanceOneMission } = await import('../server/research-mission-fleet-driver.mjs')
const { readPlatformLearningLedger } = await import('../server/platform-learning-ledger-store.mjs')

const clock = () => new Date('2026-09-07T12:00:00.000Z')

async function setupMission(missionId, { requiredValue = true } = {}) {
  const spec = {
    schemaVersion: 'TSF_RESEARCH_SPECIFICATION_V1',
    id: `spec:${missionId}`,
    researchQuestion: 'q',
    entityType: 'FIXTURE',
    requestedFields: [{ fieldName: 'salaryCap', valueType: 'number', required: requiredValue }],
    sourcePolicy: { preferredSources: [], disallowedSources: [], licensingConstraints: [], freshnessPolicy: 'UNSPECIFIED', requireIndependentSources: false, minSourceCount: 0, allowCrossMissionLibraryReuse: true },
    temporalRequirements: { asOfDate: '2026-09-07', periodScope: '2020' },
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

// Real prior mission: a genuinely FAILED raw result for PROVIDER_UNDER_TEST,
// then admitted/completed -- recordLessonsFromCompletedMission (called by
// advanceOneMission's own CHECK_COMPLETE branch, the same real path
// research-mission-fleet-driver-learning-ledger.test.mjs proves) durably
// records the real PROVIDER_RELIABILITY_SIGNAL lesson this whole test relies
// on -- never a hand-built LessonRecord fixture.
async function recordRealProviderFailureLesson(missionId, provider) {
  await setupMission(missionId)
  await withResearchMission(missionId, (mission) => ({
    ...mission,
    nodes: [
      {
        ...mission.nodes[0],
        status: 'ADMITTED',
        rawResults: [
          { digest: 'd1', result: { provider, status: 'FAILED' } },
          { digest: 'd2', result: { provider, status: 'SUCCEEDED' } }
        ],
        canonicalFacts: [
          { schemaVersion: 'TSF_CANONICAL_FACT_V1', id: 'fact:salaryCap', fieldName: 'salaryCap', value: 1, temporalScope: null, reconciliationDecisionId: 'decision:test', derivationLineage: null, canonicalizedAt: clock().toISOString() }
        ]
      }
    ]
  }))
  const result = await advanceOneMission(missionId, clock, {})
  assert.equal(result.action, 'COMPLETED')
  assert.equal(result.lessonsRecorded, 1)
}

test('empty ledger: a real dispatch produces no advisories field -- silent no-op, never a fabricated empty array', async () => {
  assert.equal(readPlatformLearningLedger(), null, 'precondition: ledger genuinely empty at this point')
  const missionId = 'mission:dispatch-advisories-empty-ledger'
  await setupMission(missionId)
  const request = buildBoundedResearchRequest(readResearchMission(missionId), readResearchMission(missionId).nodes[0], 'PROVIDER_UNDER_TEST', clock)
  const worker = createDeterministicFakeResearchWorker({ provider: 'PROVIDER_UNDER_TEST', clock, script: new Map([[request.taskFingerprint, {}]]) })
  const result = await advanceOneMission(missionId, clock, { worker, providerId: 'PROVIDER_UNDER_TEST' })
  assert.equal(result.action, 'DISPATCHED')
  assert.equal('advisories' in result, false, 'no relevant lesson exists yet -- must not fabricate an advisories field')
})

test('a real, previously-recorded lesson surfaces as an advisory on a matching dispatch, and never overrides the real dispatch outcome', async () => {
  await recordRealProviderFailureLesson('mission:dispatch-advisories-lesson-source', 'FLAKY_TEST_PROVIDER')
  assert.equal(readPlatformLearningLedger().lessons.length, 1)

  const missionId = 'mission:dispatch-advisories-consumer'
  await setupMission(missionId)
  const request = buildBoundedResearchRequest(readResearchMission(missionId), readResearchMission(missionId).nodes[0], 'FLAKY_TEST_PROVIDER', clock)
  // Real current evidence for THIS dispatch: the scripted worker succeeds
  // outright, directly contradicting the ledger's "this provider failed
  // before" lesson.
  const worker = createDeterministicFakeResearchWorker({ provider: 'FLAKY_TEST_PROVIDER', clock, script: new Map([[request.taskFingerprint, {}]]) })
  const result = await advanceOneMission(missionId, clock, { worker, providerId: 'FLAKY_TEST_PROVIDER' })

  assert.equal(result.action, 'DISPATCHED', 'real current evidence (a real successful dispatch) determines the action, unaffected by the advisory')
  assert.equal(result.dispatchResult.ok, true, 'the advisory never blocks or rewrites a real dispatch outcome')

  assert.ok(result.advisories, 'the real, previously-recorded lesson must surface here')
  assert.equal(result.advisories.length, 1)
  const advisory = result.advisories[0]
  assert.match(advisory.statement, /FLAKY_TEST_PROVIDER/)
  assert.equal(advisory.advisoryOnly, true)
  assert.equal(advisory.neverOverridesVerifiedEvidence, true)
  assert.equal('fieldName' in advisory, false, 'structurally never mistakable for a Claim/CanonicalFact')
})

test('a lesson recorded for a DIFFERENT provider never contaminates an unrelated dispatch -- filtered by real provider identity, not fabricated relevance', async () => {
  await recordRealProviderFailureLesson('mission:dispatch-advisories-unrelated-lesson-source', 'UNRELATED_PROVIDER')

  const missionId = 'mission:dispatch-advisories-no-match'
  await setupMission(missionId)
  const request = buildBoundedResearchRequest(readResearchMission(missionId), readResearchMission(missionId).nodes[0], 'CLEAN_PROVIDER', clock)
  const worker = createDeterministicFakeResearchWorker({ provider: 'CLEAN_PROVIDER', clock, script: new Map([[request.taskFingerprint, {}]]) })
  const result = await advanceOneMission(missionId, clock, { worker, providerId: 'CLEAN_PROVIDER' })

  assert.equal(result.action, 'DISPATCHED')
  assert.equal('advisories' in result, false, 'a lesson about a different provider must never be surfaced as if relevant here')
})

test('RETRY_DISPATCH surfaces a real RECURRING_DISPATCH_FAILURE lesson recorded from a different completed mission', async () => {
  const lessonMissionId = 'mission:dispatch-advisories-recurring-source'
  await setupMission(lessonMissionId)
  await withResearchMission(lessonMissionId, (mission) => ({
    ...mission,
    nodes: [
      {
        ...mission.nodes[0],
        status: 'ADMITTED',
        rawResults: [
          { digest: 'd1', result: { provider: 'ANY', status: 'FAILED' } },
          { digest: 'd2', result: { provider: 'ANY', status: 'FAILED' } },
          { digest: 'd3', result: { provider: 'ANY', status: 'SUCCEEDED' } }
        ],
        canonicalFacts: [
          { schemaVersion: 'TSF_CANONICAL_FACT_V1', id: 'fact:salaryCap', fieldName: 'salaryCap', value: 1, temporalScope: null, reconciliationDecisionId: 'decision:test', derivationLineage: null, canonicalizedAt: clock().toISOString() }
        ]
      }
    ]
  }))
  const lessonResult = await advanceOneMission(lessonMissionId, clock, {})
  assert.equal(lessonResult.action, 'COMPLETED')
  assert.ok(lessonResult.lessonsRecorded >= 1)
  const recurring = readPlatformLearningLedger().lessons.find((l) => l.category === 'RECURRING_DISPATCH_FAILURE')
  assert.ok(recurring, 'precondition: a real RECURRING_DISPATCH_FAILURE lesson exists')

  const missionId = 'mission:dispatch-advisories-retry'
  await setupMission(missionId)
  await withResearchMission(missionId, (mission) => ({
    ...mission,
    nodes: [{ ...mission.nodes[0], status: 'FAILED', retryCount: 1 }]
  }))
  const request = buildBoundedResearchRequest(readResearchMission(missionId), readResearchMission(missionId).nodes[0], 'RETRY_PROVIDER', clock)
  const worker = createDeterministicFakeResearchWorker({ provider: 'RETRY_PROVIDER', clock, script: new Map([[request.taskFingerprint, {}]]) })
  const result = await advanceOneMission(missionId, clock, { worker, providerId: 'RETRY_PROVIDER' })

  assert.equal(result.action, 'DISPATCHED', 'RETRY_DISPATCH still results in a real dispatch attempt')
  assert.equal(result.dispatchResult.ok, true)
  assert.ok(result.advisories, 'a real RECURRING_DISPATCH_FAILURE lesson must surface on this genuine retry')
  assert.ok(result.advisories.some((a) => /2\+ FAILED dispatch results/.test(a.statement)))
})

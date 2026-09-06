// CHECK_COMPLETE gate proof: gates on requiredFieldCoverage, not
// fieldCoverage -- an unresolved OPTIONAL_ENRICHMENT field must never block
// a mission that has genuinely resolved everything the user actually asked
// for (real free-path research execution finding).
import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { rmSync } from 'node:fs'

const STATE_FILE = path.join(import.meta.dirname, '..', 'server', '.local-state', `operator-state.test-fleet-driver-complete-${process.pid}.json`)
process.env.TSF_UI_STATE_FILE = STATE_FILE
function cleanupStateFile() {
  for (const suffix of ['', '.tmp', '.research.lock']) rmSync(`${STATE_FILE}${suffix}`, { force: true })
}
cleanupStateFile()
test.after(cleanupStateFile)

const { createResearchMissionDurable } = await import('../server/research-mission-driver.mjs')
const { withResearchMission } = await import('../server/research-mission-store.mjs')
const { advanceOneMission } = await import('../server/research-mission-fleet-driver.mjs')

const clock = () => new Date('2026-09-06T12:00:00.000Z')

async function setupMission(missionId, requestedFields) {
  const spec = {
    schemaVersion: 'TSF_RESEARCH_SPECIFICATION_V1',
    id: `spec:${missionId}`,
    researchQuestion: 'q',
    entityType: 'FIXTURE',
    requestedFields,
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
      nodes: [{ id: 'node:x', nodeRole: 'PRIMARY_RESEARCH', targetEntity: { entityId: 'x', name: 'X' }, requestedFields, requestedOutputSchema: { type: 'object', properties: {} } }]
    },
    clock
  )
}

function fact(fieldName, value) {
  return { schemaVersion: 'TSF_CANONICAL_FACT_V1', id: `fact:${fieldName}`, fieldName, value, temporalScope: null, reconciliationDecisionId: 'decision:test', derivationLineage: null, canonicalizedAt: clock().toISOString() }
}

async function admitNodeWithFacts(missionId, facts) {
  await withResearchMission(missionId, (mission) => ({
    ...mission,
    nodes: [{ ...mission.nodes[0], status: 'ADMITTED', canonicalFacts: facts }]
  }))
}

test('a resolved required field completes the mission even while an optional enrichment field stays unresolved', async () => {
  const missionId = 'mission:complete-gate-optional-unresolved'
  await setupMission(missionId, [
    { fieldName: 'salaryCap', valueType: 'number', required: true },
    { fieldName: 'yearOverYearChange', valueType: 'number', required: false }
  ])
  await admitNodeWithFacts(missionId, [fact('salaryCap', 198_200_000)])
  const result = await advanceOneMission(missionId, clock, {})
  assert.equal(result.action, 'COMPLETED', 'unresolved optional field must never block COMPLETE')
  assert.equal(result.completeness.requiredFieldCoverage, 1)
  assert.equal(result.completeness.fieldCoverage, 0.5, 'fieldCoverage stays informational, counting every field')
})

test('an unresolved REQUIRED field still correctly blocks COMPLETE', async () => {
  const missionId = 'mission:complete-gate-required-unresolved'
  await setupMission(missionId, [{ fieldName: 'salaryCap', valueType: 'number', required: true }])
  await admitNodeWithFacts(missionId, [])
  const result = await advanceOneMission(missionId, clock, {})
  assert.equal(result.action, 'SKIPPED')
  assert.equal(result.completeness.requiredFieldCoverage, 0)
})

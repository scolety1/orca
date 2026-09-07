// Phase 3 Wave 2 (3C): the worker-level proof -- dispatch/fetchResult, and
// REAL end-to-end durable admission through the SAME admission path
// web-table-research-worker.test.mjs already proves (dispatchResearchNodeDurable
// -> pollAndAdmitResearchNodeDurable -> admitBoundedResearchResult), not a
// parallel local-file research system.
import test from 'node:test'
import assert from 'node:assert/strict'
import { rmSync } from 'node:fs'
import path from 'node:path'
import {
  createOwnerSuppliedLocalArtifactResearchWorker,
  OWNER_SUPPLIED_LOCAL_ARTIFACT_PROVIDER_ID
} from '../adapters/owner-supplied-local-artifact-research-worker.mjs'

const HERE = import.meta.dirname
const STATE_FILE = path.join(HERE, '..', 'server', '.local-state', `operator-state.test-owner-artifact-worker-${process.pid}.json`)
process.env.TSF_UI_STATE_FILE = STATE_FILE
function cleanupStateFile() {
  for (const suffix of ['', '.tmp', '.research.lock']) {
    rmSync(`${STATE_FILE}${suffix}`, { force: true })
  }
}
cleanupStateFile()
test.after(cleanupStateFile)
const { createResearchMissionDurable, dispatchResearchNodeDurable, pollAndAdmitResearchNodeDurable } = await import('../server/research-mission-driver.mjs')
const { readResearchMission } = await import('../server/research-mission-store.mjs')

const clock = () => new Date('2026-09-08T10:00:00.000Z')
const TABLE_HTML = '<html><body><table><tr><th>Player</th><th>Passing / Yards</th></tr><tr><td>Brett Favre</td><td>4413</td></tr></table></body></html>'

function baseRequest(overrides = {}) {
  return {
    schemaVersion: 'TSF_BOUNDED_RESEARCH_REQUEST_V1',
    nodeId: 'node:brett-favre',
    taskFingerprint: 'b'.repeat(64),
    nodeRole: 'PRIMARY_RESEARCH',
    researchQuestion: 'q',
    targetEntity: { entityId: 'Brett Favre', name: 'Brett Favre' },
    scope: ['node:brett-favre'],
    requestedOutputSchema: { properties: { 'Passing / Yards': {} } },
    temporalRequirements: { asOfDate: '2026-09-08', periodScope: '1995' },
    sourcePolicy: {},
    preferredSources: [],
    localArtifactCandidates: [{ content: TABLE_HTML, ownerAssertion: { assertedBy: 'TIM', assertionDescription: 'a saved snapshot' } }],
    disallowedSources: [],
    licensingConstraints: [],
    freshnessPolicy: 'UNSPECIFIED',
    budget: {},
    toolPermissions: [],
    ...overrides
  }
}

test('dispatch+fetchResult produces a real SUCCEEDED result from a local artifact', async () => {
  const worker = createOwnerSuppliedLocalArtifactResearchWorker({ clock })
  const dispatched = await worker.dispatch(baseRequest())
  assert.equal(dispatched.ok, true)
  const fetched = await worker.fetchResult(dispatched.workerRunRef)
  assert.equal(fetched.ok, true)
  const { result } = fetched
  assert.equal(result.status, 'SUCCEEDED')
  assert.equal(result.provider, OWNER_SUPPLIED_LOCAL_ARTIFACT_PROVIDER_ID)
  assert.equal(result.proposedClaims[0].proposedValue, '4413')
  assert.equal(result.usage.providerReportedCostUsd, 0)
  const snapshot = result.sourceSnapshotsOrSnapshotRefs[0]
  assert.equal(snapshot.acquisitionMode, 'OWNER_SUPPLIED_LOCAL_ARTIFACT')
  assert.equal(snapshot.accessClassification, 'NOT_APPLICABLE_LOCAL_ARTIFACT')
  assert.equal(snapshot.provenanceStrength, 'ASSERTED_UNLOGGED')
  assert.equal(typeof snapshot.schemaFingerprint, 'string')
  assert.equal(snapshot.transformationVersion, '1.0.0')
})

test('{ok:false} when the mission specification names no localArtifactCandidates', async () => {
  const worker = createOwnerSuppliedLocalArtifactResearchWorker({ clock })
  const dispatched = await worker.dispatch(baseRequest({ localArtifactCandidates: [] }))
  assert.equal(dispatched.ok, false)
  assert.equal(dispatched.reason, 'NO_CANDIDATE_SOURCE_CONFIGURED')
})

test('a genuine no-match reports {ok:false}, never a fabricated claim', async () => {
  const worker = createOwnerSuppliedLocalArtifactResearchWorker({ clock })
  const request = baseRequest({ nodeId: 'node:someone-else', targetEntity: { entityId: 'Someone Else', name: 'Someone Else' } })
  const dispatched = await worker.dispatch(request)
  assert.equal(dispatched.ok, false)
  assert.match(dispatched.detail, /no row matched this entity/)
})

test('REAL DURABLE ADMISSION: a genuinely successful dispatch admits a SourceSnapshotReference with ASSERTED_UNLOGGED chain-of-custody, honoring REQ-003 (Wave 1) unmodified', async () => {
  const missionId = 'mission:owner-artifact-admission-proof'
  const spec = {
    schemaVersion: 'TSF_RESEARCH_SPECIFICATION_V1',
    id: 'spec:owner-artifact-admission-proof',
    researchQuestion: 'q',
    entityType: 'FIXTURE',
    requestedFields: [{ fieldName: 'Passing / Yards', valueType: 'number', required: true, derivationRule: null }],
    sourcePolicy: {
      preferredSources: [],
      disallowedSources: [],
      licensingConstraints: [],
      freshnessPolicy: 'UNSPECIFIED',
      requireIndependentSources: false,
      minSourceCount: 0,
      allowCrossMissionLibraryReuse: true,
      localArtifactCandidates: [{ content: TABLE_HTML, ownerAssertion: { assertedBy: 'TIM', assertionDescription: 'a saved snapshot' } }]
    },
    temporalRequirements: { asOfDate: '2026-09-08', periodScope: '1995' },
    budget: { maxCostUsd: 0, maxLatencyMs: null, maxToolCallsPerNode: null },
    toolPermissions: []
  }
  await createResearchMissionDurable(
    missionId,
    {
      projectId: 'test',
      specification: spec,
      expectedUniverse: { schemaVersion: 'TSF_EXPECTED_UNIVERSE_V1', entityType: 'FIXTURE', expectedCount: 1, expectedEntities: [{ entityId: 'Brett Favre', identityHints: {} }] },
      nodes: [{ id: 'node:brett-favre', nodeRole: 'PRIMARY_RESEARCH', targetEntity: { entityId: 'Brett Favre', name: 'Brett Favre' }, requestedFields: spec.requestedFields, requestedOutputSchema: { type: 'object', properties: { 'Passing / Yards': { type: 'number' } } } }]
    },
    clock
  )
  const worker = createOwnerSuppliedLocalArtifactResearchWorker({ clock })

  const dispatched = await dispatchResearchNodeDurable(missionId, 'node:brett-favre', OWNER_SUPPLIED_LOCAL_ARTIFACT_PROVIDER_ID, worker, clock)
  assert.equal(dispatched.ok, true)
  const polled = await pollAndAdmitResearchNodeDurable(missionId, 'node:brett-favre', worker, clock)
  assert.equal(polled.ok, true)

  const mission = readResearchMission(missionId)
  const node = mission.nodes[0]
  assert.equal(node.sourceSnapshots.length, 1)
  const snapshot = node.sourceSnapshots[0]
  assert.equal(snapshot.acquisitionMode, 'OWNER_SUPPLIED_LOCAL_ARTIFACT')
  assert.equal(snapshot.accessClassification, 'NOT_APPLICABLE_LOCAL_ARTIFACT')
  // REQ-003 (Wave 1, unmodified): provenanceStrength ASSERTED_UNLOGGED with
  // a single hash observation (filesystemStability UNCHECKED) computes RED
  // -- honest, not fabricated GREEN just because a human named an owner.
  assert.equal(snapshot.chainOfCustody.provenanceStrength, 'ASSERTED_UNLOGGED')
  assert.equal(snapshot.chainOfCustody.overallChainOfCustody, 'RED')
  assert.equal(snapshot.modeEvidence.ownerProvenance.assertedBy, 'TIM')
  assert.equal(snapshot.modeEvidence.artifactRef.rawContent, null, 'raw content never reaches durable mission state')
  // Phase 3 Wave 2 (3F): the richer snapshot metadata fields reach durable
  // admission additively.
  assert.equal(typeof snapshot.schemaFingerprint, 'string')
  assert.equal(snapshot.selectorOrAdapterVersion, 'owner-supplied-local-artifact-adapter@0.1.0')
  assert.equal(snapshot.transformationVersion, '1.0.0')
})

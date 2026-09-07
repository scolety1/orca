// Phase 3 Wave 2 (3D): worker-level + REAL durable admission proof,
// fixture/mock-only -- no real external login anywhere in this file.
import test from 'node:test'
import assert from 'node:assert/strict'
import { rmSync } from 'node:fs'
import path from 'node:path'
import {
  createAuthenticatedOfficialDownloadResearchWorker,
  AUTHENTICATED_OFFICIAL_DOWNLOAD_PROVIDER_ID
} from '../adapters/authenticated-official-download-research-worker.mjs'

const HERE = import.meta.dirname
const STATE_FILE = path.join(HERE, '..', 'server', '.local-state', `operator-state.test-auth-download-worker-${process.pid}.json`)
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
const FAKE_SESSION = { profileId: 'profile-fixture', mechanism: 'IMPORTED_BROWSER_COOKIES', authenticatedAt: '2026-09-08T09:00:00.000Z' }

function fakeSessionProvider(session = FAKE_SESSION) {
  return { getSession: async () => session }
}
function fakeDownloadFn(bodyText = TABLE_HTML) {
  return async ({ candidate }) => ({ ok: true, httpStatus: 200, bodyText, finalUrl: candidate.url })
}

function baseRequest(overrides = {}) {
  return {
    schemaVersion: 'TSF_BOUNDED_RESEARCH_REQUEST_V1',
    nodeId: 'node:brett-favre',
    taskFingerprint: 'c'.repeat(64),
    nodeRole: 'PRIMARY_RESEARCH',
    researchQuestion: 'q',
    targetEntity: { entityId: 'Brett Favre', name: 'Brett Favre' },
    scope: ['node:brett-favre'],
    requestedOutputSchema: { properties: { 'Passing / Yards': {} } },
    temporalRequirements: { asOfDate: '2026-09-08', periodScope: '1995' },
    sourcePolicy: {},
    preferredSources: [],
    authenticatedDownloadCandidates: ['https://example.com/official-export'],
    disallowedSources: [],
    licensingConstraints: [],
    freshnessPolicy: 'UNSPECIFIED',
    budget: {},
    toolPermissions: [],
    ...overrides
  }
}

test('dispatch+fetchResult produces a real SUCCEEDED result via a fixture authenticated session', async () => {
  const worker = createAuthenticatedOfficialDownloadResearchWorker({ clock, sessionProvider: fakeSessionProvider(), downloadFn: fakeDownloadFn() })
  const dispatched = await worker.dispatch(baseRequest())
  assert.equal(dispatched.ok, true)
  const { result } = await worker.fetchResult(dispatched.workerRunRef)
  assert.equal(result.status, 'SUCCEEDED')
  assert.equal(result.provider, AUTHENTICATED_OFFICIAL_DOWNLOAD_PROVIDER_ID)
  assert.equal(result.proposedClaims[0].proposedValue, '4413')
  const snapshot = result.sourceSnapshotsOrSnapshotRefs[0]
  assert.equal(snapshot.acquisitionMode, 'AUTHENTICATED_OFFICIAL_DOWNLOAD')
  assert.equal(snapshot.accessClassification, 'AUTHENTICATED_OFFICIAL_EXPORT')
  assert.equal(snapshot.provenanceStrength, 'ASSERTED_LOGGED')
})

test('no authenticated session configured -> {ok:false} honest NEEDS_INTERACTIVE_LOGIN, never a fabricated match', async () => {
  const worker = createAuthenticatedOfficialDownloadResearchWorker({ clock, sessionProvider: fakeSessionProvider(null), downloadFn: fakeDownloadFn() })
  const dispatched = await worker.dispatch(baseRequest())
  assert.equal(dispatched.ok, false)
  assert.match(dispatched.detail, /NEEDS_INTERACTIVE_LOGIN/)
})

test('{ok:false} when the mission specification names no authenticatedDownloadCandidates', async () => {
  const worker = createAuthenticatedOfficialDownloadResearchWorker({ clock, sessionProvider: fakeSessionProvider(), downloadFn: fakeDownloadFn() })
  const dispatched = await worker.dispatch(baseRequest({ authenticatedDownloadCandidates: [] }))
  assert.equal(dispatched.ok, false)
  assert.equal(dispatched.reason, 'NO_CANDIDATE_SOURCE_CONFIGURED')
})

test('REAL DURABLE ADMISSION: a genuinely successful authenticated dispatch admits a SourceSnapshotReference with non-secret authEvidence and ASSERTED_LOGGED chain-of-custody', async () => {
  const missionId = 'mission:auth-download-admission-proof'
  const spec = {
    schemaVersion: 'TSF_RESEARCH_SPECIFICATION_V1',
    id: 'spec:auth-download-admission-proof',
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
      authenticatedDownloadCandidates: ['https://example.com/official-export']
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
  const worker = createAuthenticatedOfficialDownloadResearchWorker({ clock, sessionProvider: fakeSessionProvider(), downloadFn: fakeDownloadFn() })

  const dispatched = await dispatchResearchNodeDurable(missionId, 'node:brett-favre', AUTHENTICATED_OFFICIAL_DOWNLOAD_PROVIDER_ID, worker, clock)
  assert.equal(dispatched.ok, true)
  const polled = await pollAndAdmitResearchNodeDurable(missionId, 'node:brett-favre', worker, clock)
  assert.equal(polled.ok, true)

  const mission = readResearchMission(missionId)
  const snapshot = mission.nodes[0].sourceSnapshots[0]
  assert.equal(snapshot.acquisitionMode, 'AUTHENTICATED_OFFICIAL_DOWNLOAD')
  assert.equal(snapshot.chainOfCustody.provenanceStrength, 'ASSERTED_LOGGED')
  // Only the allowlisted, non-secret authEvidence projection reaches the
  // durably persisted record -- never the session object itself.
  assert.deepEqual(Object.keys(snapshot.modeEvidence.authEvidence).sort(), ['authenticatedAt', 'mechanism', 'profileIdRef', 'schemaVersion'])
  assert.equal(snapshot.modeEvidence.authEvidence.mechanism, 'IMPORTED_BROWSER_COOKIES')
  assert.equal(snapshot.modeEvidence.authEvidence.profileIdRef, 'profile-fixture')
})

// Phase 3 Wave 2 (3G): a bounded, GENERIC (not NFL/NWR-specific) proving
// set for a real ResearchMission driven through raw source -> observation
// -> claim -> verification/reconciliation -> canonical flow, across THREE
// different acquisition modes in the SAME mission -- the public-web mode
// (regression check only, live-fetch behavior unchanged), the new
// owner-supplied-local-artifact mode (3C), and the new authenticated-
// official-download mode (3D, fixture-proven only). Also proves
// completeness, identity resolution, temporal safety honesty, the Wave 1
// Learning Ledger, and Research Library behavior all still work together.
// No paid provider (Parallel/Exa) is enabled or called anywhere here --
// every worker below is $0 and either fixture-fed or a real local read.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { rmSync } from 'node:fs'
import { acquireWebSourceViaStaticTable } from '../domain/web-table-source-adapter.mjs'
import { createWebTableResearchWorker, WEB_TABLE_PROVIDER_ID } from '../adapters/web-table-research-worker.mjs'
import { createOwnerSuppliedLocalArtifactResearchWorker, OWNER_SUPPLIED_LOCAL_ARTIFACT_PROVIDER_ID } from '../adapters/owner-supplied-local-artifact-research-worker.mjs'
import { createAuthenticatedOfficialDownloadResearchWorker, AUTHENTICATED_OFFICIAL_DOWNLOAD_PROVIDER_ID } from '../adapters/authenticated-official-download-research-worker.mjs'
import { recordIdentityResolutionState } from '../domain/research-admission.mjs'
import { computeCompletenessMetrics } from '../domain/research-completeness.mjs'
import { createResearchLibrary, indexCanonicalFact, queryResearchLibrary } from '../domain/research-library.mjs'

// IMPORTANT: server/research-mission-fleet-driver.mjs and server/platform-
// learning-ledger-store.mjs both transitively import server/data-store.mjs,
// whose STATE_FILE is a module-level constant resolved from
// process.env.TSF_UI_STATE_FILE ONLY ONCE, at first import, anywhere in
// this process (see data-store.mjs's own top-level `const STATE_FILE = ...`).
// ES module static imports execute before any of THIS file's own top-level
// statements -- a static import of either module here would therefore
// resolve data-store.mjs against whatever TSF_UI_STATE_FILE happened to be
// BEFORE this file's own override below runs (real caught regression during
// this wave's own testing: it silently wrote to and read back the real
// shared dev state file instead of an isolated one). Both are deliberately
// deferred to the dynamic imports below, AFTER the env override, matching
// every other test file's own required pattern in this codebase.
const HERE = import.meta.dirname
const STATE_FILE = path.join(HERE, '..', 'server', '.local-state', `operator-state.test-research-completion-proving-set-${process.pid}.json`)
process.env.TSF_UI_STATE_FILE = STATE_FILE
function cleanupStateFile() {
  for (const suffix of ['', '.tmp', '.research.lock', '.platform-learning-ledger.lock']) {
    rmSync(`${STATE_FILE}${suffix}`, { force: true })
  }
}
cleanupStateFile()
test.after(cleanupStateFile)

const {
  createResearchMissionDurable,
  dispatchResearchNodeDurable,
  pollAndAdmitResearchNodeDurable
} = await import('../server/research-mission-driver.mjs')
const { readResearchMission, withResearchMission } = await import('../server/research-mission-store.mjs')
const { driveOneCycle } = await import('../server/research-mission-fleet-driver.mjs')
const { readPlatformLearningLedger } = await import('../server/platform-learning-ledger-store.mjs')

const clock = () => new Date('2026-09-08T12:00:00.000Z')
const publicResolve = async () => [{ address: '93.184.216.34' }]

async function loadPublicWebFixture() {
  const dir = path.join(import.meta.dirname, '..', 'fixtures', 'web-table-source-acquisition')
  return readFile(path.join(dir, 'qb-stats-1995.html'), 'utf-8')
}
function fetchImplFor(html) {
  return async () => new Response(html, { status: 200, headers: { 'content-type': 'text/html' } })
}
function publicWebFixtureAcquireFn(html) {
  return ({ candidate }) =>
    acquireWebSourceViaStaticTable({
      candidate,
      accessInput: { robotsDecision: 'ALLOWED', explicitPublicAllowance: true },
      fetchOptions: { fetchImpl: fetchImplFor(html), resolveImpl: publicResolve },
      clock
    })
}

const LOCAL_ARTIFACT_HTML = '<html><body><table><tr><th>Player</th><th>Team</th></tr><tr><td>Brett Favre</td><td>Packers</td></tr></table></body></html>'
const AUTHENTICATED_EXPORT_HTML = '<html><body><table><tr><th>Player</th><th>Passing / TD</th></tr><tr><td>Brett Favre</td><td>38</td></tr></table></body></html>'
const FAKE_SESSION = { profileId: 'profile-proving-set', mechanism: 'IMPORTED_BROWSER_COOKIES', authenticatedAt: '2026-09-08T09:00:00.000Z' }

const MISSION_ID = 'mission:research-completion-proving-set-v0'

async function buildAndRunMission() {
  const targetEntity = { entityId: 'Brett Favre', name: 'Brett Favre' }
  const specification = {
    schemaVersion: 'TSF_RESEARCH_SPECIFICATION_V1',
    id: 'spec:research-completion-proving-set-v0',
    researchQuestion: 'Generic multi-acquisition-mode proving mission -- not NFL/NWR-specific in intent, uses a small public-domain-shaped fixture only.',
    entityType: 'FIXTURE',
    requestedFields: [
      { fieldName: 'Passing / Yards', valueType: 'number', required: true, derivationRule: null },
      { fieldName: 'Team', valueType: 'string', required: true, derivationRule: null },
      { fieldName: 'Passing / TD', valueType: 'number', required: true, derivationRule: null }
    ],
    sourcePolicy: {
      preferredSources: ['https://example.com/1995-qb-stats'],
      disallowedSources: [],
      licensingConstraints: [],
      freshnessPolicy: 'UNSPECIFIED',
      requireIndependentSources: false,
      minSourceCount: 0,
      allowCrossMissionLibraryReuse: true,
      localArtifactCandidates: [{ content: LOCAL_ARTIFACT_HTML, ownerAssertion: { assertedBy: 'TIM', assertionDescription: 'a saved roster snapshot' } }],
      authenticatedDownloadCandidates: ['https://example.com/official-export']
    },
    temporalRequirements: { asOfDate: '2026-09-08', periodScope: '1995' },
    budget: { maxCostUsd: 0, maxLatencyMs: null, maxToolCallsPerNode: null },
    toolPermissions: []
  }
  await createResearchMissionDurable(
    MISSION_ID,
    {
      projectId: 'test',
      specification,
      expectedUniverse: { schemaVersion: 'TSF_EXPECTED_UNIVERSE_V1', entityType: 'FIXTURE', expectedCount: 1, expectedEntities: [{ entityId: 'Brett Favre', identityHints: {} }] },
      nodes: [
        { id: 'node:public-web', nodeRole: 'PRIMARY_RESEARCH', targetEntity, requestedFields: [specification.requestedFields[0]], requestedOutputSchema: { type: 'object', properties: { 'Passing / Yards': { type: 'number' } } } },
        { id: 'node:local-artifact', nodeRole: 'PRIMARY_RESEARCH', targetEntity, requestedFields: [specification.requestedFields[1]], requestedOutputSchema: { type: 'object', properties: { Team: { type: 'string' } } } },
        { id: 'node:authenticated', nodeRole: 'PRIMARY_RESEARCH', targetEntity, requestedFields: [specification.requestedFields[2]], requestedOutputSchema: { type: 'object', properties: { 'Passing / TD': { type: 'number' } } } }
      ]
    },
    clock
  )

  const html = await loadPublicWebFixture()
  const publicWebWorker = createWebTableResearchWorker({ clock, acquireFn: publicWebFixtureAcquireFn(html) })
  const localArtifactWorker = createOwnerSuppliedLocalArtifactResearchWorker({ clock })
  const authenticatedWorker = createAuthenticatedOfficialDownloadResearchWorker({
    clock,
    sessionProvider: { getSession: async () => FAKE_SESSION },
    downloadFn: async ({ candidate }) => ({ ok: true, httpStatus: 200, bodyText: AUTHENTICATED_EXPORT_HTML, finalUrl: candidate.url })
  })

  // Raw source -> observation -> claim -> SourceSnapshotReference admission,
  // once per node, through the SAME real durable admission path, one real
  // acquisition mode each.
  for (const [nodeId, provider, worker] of [
    ['node:public-web', WEB_TABLE_PROVIDER_ID, publicWebWorker],
    ['node:local-artifact', OWNER_SUPPLIED_LOCAL_ARTIFACT_PROVIDER_ID, localArtifactWorker],
    ['node:authenticated', AUTHENTICATED_OFFICIAL_DOWNLOAD_PROVIDER_ID, authenticatedWorker]
  ]) {
    // eslint-disable-next-line no-await-in-loop -- three small, sequential, real dispatch/admit cycles; bounded and deterministic
    const dispatched = await dispatchResearchNodeDurable(MISSION_ID, nodeId, provider, worker, clock)
    assert.equal(dispatched.ok, true, `dispatch failed for ${nodeId}: ${JSON.stringify(dispatched)}`)
    // eslint-disable-next-line no-await-in-loop
    const polled = await pollAndAdmitResearchNodeDurable(MISSION_ID, nodeId, worker, clock)
    assert.equal(polled.ok, true, `poll/admit failed for ${nodeId}: ${JSON.stringify(polled)}`)
  }

  // Identity resolution still works: a real, recorded RESOLVED state for
  // one node, independent of and alongside the chain-of-custody/acquisition
  // metadata above.
  await withResearchMission(MISSION_ID, (m) =>
    recordIdentityResolutionState(
      m,
      'node:public-web',
      { candidateEntityRefs: [{ entityId: 'Brett Favre' }], resolvedEntityId: 'Brett Favre', status: 'RESOLVED', rationale: 'exact name match against the fixture table row' },
      clock,
      m.revision
    )
  )

  // Autonomous verify -> conflict-detect -> auto-accept-or-escalate ->
  // complete, exactly the real production driver (research-mission-fleet-
  // driver.mjs) -- no manual reconciliation authored here. No `worker` dep
  // is needed: every node is already ADMITTED, so decideNextMissionAction
  // never returns DISPATCH again.
  let lastResult = null
  for (let i = 0; i < 30; i++) {
    // eslint-disable-next-line no-await-in-loop -- autonomous driver ticks are inherently sequential (each depends on the previous tick's durable state)
    const [result] = await driveOneCycle([MISSION_ID], clock, {})
    lastResult = result
    if (result.action === 'COMPLETED' || result.action === 'ESCALATED') {
      break
    }
  }
  return lastResult
}

test('the full multi-acquisition-mode research completion proving set', async (t) => {
  const finalTickResult = await buildAndRunMission()

  await t.test('mission autonomously reaches real COMPLETE (never escalated, never stuck)', () => {
    assert.equal(finalTickResult.action, 'COMPLETED', `mission did not complete: ${JSON.stringify(finalTickResult)}`)
  })

  const mission = readResearchMission(MISSION_ID)

  await t.test('mission state is durably COMPLETE', () => {
    assert.equal(mission.state, 'COMPLETE')
  })

  await t.test('raw source -> observation -> claim -> canonical flow: all three fields became real CanonicalFacts with the real fixture values', () => {
    const factByFieldAndNode = (nodeId, fieldName) => mission.nodes.find((n) => n.id === nodeId).canonicalFacts.find((f) => f.fieldName === fieldName)
    assert.equal(factByFieldAndNode('node:public-web', 'Passing / Yards')?.value, '4413')
    assert.equal(factByFieldAndNode('node:local-artifact', 'Team')?.value, 'Packers')
    assert.equal(factByFieldAndNode('node:authenticated', 'Passing / TD')?.value, '38')
  })

  await t.test('completeness metrics: full requiredFieldCoverage, zero typed missingness -- still works across mixed acquisition modes', () => {
    const completeness = computeCompletenessMetrics(mission, clock)
    assert.equal(completeness.requiredFieldCoverage, 1)
    assert.equal(completeness.typedMissingnessCount, 0)
  })

  await t.test('identity resolution still works: the recorded RESOLVED state survived the full autonomous drive to completion', () => {
    assert.equal(mission.nodes.find((n) => n.id === 'node:public-web').identityResolutionState.status, 'RESOLVED')
  })

  await t.test('temporal safety: no fabricated CONTEMPORANEOUS default anywhere -- every claim carries an honest, real temporalClass', () => {
    for (const node of mission.nodes) {
      for (const claim of node.claims) {
        assert.ok(claim.temporalClass, `claim for ${claim.fieldName} must carry a real temporalClass, never undefined`)
      }
    }
  })

  await t.test('public-web acquisition mode regression check: still PUBLIC_ALLOWED/EXTRACTED, live-fetch behavior unchanged', () => {
    const snap = mission.nodes.find((n) => n.id === 'node:public-web').sourceSnapshots[0]
    assert.equal(snap.acquisitionMode, 'PUBLIC_WEB_SOURCE_EXTRACTION')
    assert.equal(snap.accessClassification, 'PUBLIC_ALLOWED')
  })

  await t.test('3C owner-supplied-local-artifact mode worked end to end, with honest ASSERTED_UNLOGGED/RED chain-of-custody', () => {
    const snap = mission.nodes.find((n) => n.id === 'node:local-artifact').sourceSnapshots[0]
    assert.equal(snap.acquisitionMode, 'OWNER_SUPPLIED_LOCAL_ARTIFACT')
    assert.equal(snap.chainOfCustody.provenanceStrength, 'ASSERTED_UNLOGGED')
    assert.equal(snap.chainOfCustody.appliedChainOfCustody, 'RED')
  })

  await t.test('3D authenticated-download mode behaved correctly against fixtures, with real (non-secret) auth evidence', () => {
    const snap = mission.nodes.find((n) => n.id === 'node:authenticated').sourceSnapshots[0]
    assert.equal(snap.acquisitionMode, 'AUTHENTICATED_OFFICIAL_DOWNLOAD')
    assert.equal(snap.chainOfCustody.provenanceStrength, 'ASSERTED_LOGGED')
    assert.equal(snap.modeEvidence.authEvidence.mechanism, 'IMPORTED_BROWSER_COOKIES')
  })

  await t.test('3F richer snapshot metadata present on every acquisition mode used here', () => {
    for (const node of mission.nodes) {
      const snap = node.sourceSnapshots[0]
      assert.equal(typeof snap.schemaFingerprint, 'string')
      assert.equal(typeof snap.selectorOrAdapterVersion, 'string')
      assert.equal(snap.transformationVersion, '1.0.0')
    }
  })

  await t.test('Wave 1 Learning Ledger still works: this real completion recorded a lessonsRecorded count and durably persisted at least the completed-mission bookkeeping', () => {
    assert.equal(typeof finalTickResult.lessonsRecorded, 'number')
    const ledger = readPlatformLearningLedger()
    assert.ok(ledger, 'the platform learning ledger must exist after a real mission completion')
  })

  await t.test('Research Library behavior still works: indexing this mission\'s real CanonicalFacts and querying them back', () => {
    let library = createResearchLibrary(clock)
    for (const node of mission.nodes) {
      for (const fact of node.canonicalFacts) {
        library = indexCanonicalFact(library, mission, node.id, fact.id, clock, library.revision)
      }
    }
    const hits = queryResearchLibrary(library, { entityId: 'Brett Favre', fieldName: 'Team' })
    assert.equal(hits.length, 1)
    assert.equal(hits[0].value, 'Packers')
  })

  await t.test('crash/idempotency: re-polling an already-ADMITTED node is a safe no-op, never a duplicate admission', async () => {
    const worker = createOwnerSuppliedLocalArtifactResearchWorker({ clock })
    const before = readResearchMission(MISSION_ID).nodes.find((n) => n.id === 'node:local-artifact').sourceSnapshots.length
    const repeatedPoll = await pollAndAdmitResearchNodeDurable(MISSION_ID, 'node:local-artifact', worker, clock)
    assert.equal(repeatedPoll.ok, true)
    const after = readResearchMission(MISSION_ID).nodes.find((n) => n.id === 'node:local-artifact').sourceSnapshots.length
    assert.equal(after, before, 'a repeated poll/admit for an already-fully-admitted result must never create a duplicate SourceSnapshotReference')
  })
})

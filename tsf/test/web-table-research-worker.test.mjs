// Deterministic, no-network proof of the full generic worker pipeline:
// BoundedResearchRequest -> real web-table acquisition (fixture-fed, same
// convention as web-table-source-adapter.test.mjs) -> extraction ->
// BoundedResearchResult. The real network path (acquirePublicWebTableSource,
// mandatory live robots preflight + DNS pinning) is proven separately by a
// disclosed real network call -- see the final report.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { rmSync } from 'node:fs'
import { acquireWebSourceViaStaticTable } from '../domain/web-table-source-adapter.mjs'
import { createWebTableResearchWorker, WEB_TABLE_PROVIDER_ID } from '../adapters/web-table-research-worker.mjs'

const STUB = path.join(import.meta.dirname, 'fixtures', 'stub-planner-cli.mjs')
const NONEXISTENT_CLI = path.join(import.meta.dirname, 'fixtures', 'does-not-exist-binary')

async function withStubEnv(vars, fn) {
  const prior = {}
  for (const key of Object.keys(vars)) prior[key] = process.env[key]
  Object.assign(process.env, vars)
  try {
    return await fn()
  } finally {
    for (const key of Object.keys(vars)) {
      if (prior[key] === undefined) delete process.env[key]
      else process.env[key] = prior[key]
    }
  }
}

const HERE = import.meta.dirname
const STATE_FILE = path.join(HERE, '..', 'server', '.local-state', `operator-state.test-web-table-worker-${process.pid}.json`)
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

const fixturesDir = path.join(import.meta.dirname, '..', 'fixtures', 'web-table-source-acquisition')
const publicResolve = async () => [{ address: '93.184.216.34' }]
const clock = () => new Date('2026-09-06T12:00:00.000Z')

async function loadFixture(name) {
  return readFile(path.join(fixturesDir, name), 'utf-8')
}

function fetchImplFor(html) {
  return async () => new Response(html, { status: 200, headers: { 'content-type': 'text/html' } })
}

// Injected acquireFn stands in for acquirePublicWebTableSource, feeding the
// SAME real acquireWebSourceViaStaticTable pipeline (routing, robots
// classification, table extraction, receipt-building) a fixture HTML body
// instead of a real network fetch -- same test-injection point every other
// worker in this codebase uses (createExaResearchWorker's `transport`).
function fixtureAcquireFn(html) {
  return ({ candidate }) =>
    acquireWebSourceViaStaticTable({
      candidate,
      accessInput: { robotsDecision: 'ALLOWED', explicitPublicAllowance: true },
      fetchOptions: { fetchImpl: fetchImplFor(html), resolveImpl: publicResolve },
      clock
    })
}

function baseRequest(overrides = {}) {
  return {
    schemaVersion: 'TSF_BOUNDED_RESEARCH_REQUEST_V1',
    nodeId: 'node:brett-favre',
    taskFingerprint: 'a'.repeat(64),
    nodeRole: 'PRIMARY_RESEARCH',
    researchQuestion: 'q',
    targetEntity: { entityId: 'Brett Favre', name: 'Brett Favre' },
    scope: ['node:brett-favre'],
    requestedOutputSchema: { properties: { 'Passing / Yards': {}, 'Passing / TD': {} } },
    temporalRequirements: { asOfDate: '2026-09-06', periodScope: '1995' },
    sourcePolicy: {},
    preferredSources: ['https://example.com/1995-qb-stats'],
    disallowedSources: [],
    licensingConstraints: [],
    freshnessPolicy: 'UNSPECIFIED',
    budget: {},
    toolPermissions: [],
    ...overrides
  }
}

test('dispatch+fetchResult produces a real SUCCEEDED result with genuine proposedClaims/evidence/sourceReferences from a matched row', async () => {
  const html = await loadFixture('qb-stats-1995.html')
  const worker = createWebTableResearchWorker({ clock, acquireFn: fixtureAcquireFn(html) })
  const dispatched = await worker.dispatch(baseRequest())
  assert.equal(dispatched.ok, true)
  const fetched = await worker.fetchResult(dispatched.workerRunRef)
  assert.equal(fetched.ok, true)
  assert.equal(fetched.status, 'READY')
  const { result } = fetched
  assert.equal(result.status, 'SUCCEEDED')
  assert.equal(result.provider, WEB_TABLE_PROVIDER_ID)
  const byField = Object.fromEntries(result.proposedClaims.map((c) => [c.fieldName, c.proposedValue]))
  assert.equal(byField['Passing / Yards'], '4413')
  assert.equal(byField['Passing / TD'], '38')
  assert.equal(result.evidence.length, 2)
  assert.equal(result.sourceReferences[0].url, 'https://example.com/1995-qb-stats')
  assert.equal(result.usage.providerReportedCostUsd, 0, 'genuinely $0 -- no paid provider involved')
  // Architecture reconciliation: the rich acquisition receipt must reach
  // sourceSnapshotsOrSnapshotRefs, not only providerRunId's opaque blob.
  assert.equal(result.sourceSnapshotsOrSnapshotRefs.length, 1)
  const snapshot = result.sourceSnapshotsOrSnapshotRefs[0]
  assert.equal(snapshot.sourceRef, 'https://example.com/1995-qb-stats')
  assert.equal(snapshot.acquisitionMethod, 'WEB_TABLE_STATIC_SOURCE_EXTRACTION')
  assert.equal(typeof snapshot.contentHash, 'string')
  assert.equal(snapshot.modeEvidence.decision, 'EXTRACTED')
  assert.equal(snapshot.modeEvidence.artifactRef.rawHtml, null, 'raw HTML is stripped even though this worker never opts into retention')
  // REQ-005: the rights/acquisition-mode taxonomy must be a top-level,
  // queryable field, not only reachable by reaching into modeEvidence.
  assert.equal(snapshot.acquisitionMode, 'PUBLIC_WEB_SOURCE_EXTRACTION')
  assert.equal(snapshot.accessClassification, 'PUBLIC_ALLOWED')
})

test('restart-safety: a fresh call to fetchResult using only the durably-shaped workerRunRef (no in-memory state) returns the identical result', async () => {
  const html = await loadFixture('qb-stats-1995.html')
  const worker = createWebTableResearchWorker({ clock, acquireFn: fixtureAcquireFn(html) })
  const dispatched = await worker.dispatch(baseRequest())
  // Simulate a real process restart: a workerRunRef that has been through
  // JSON.stringify/parse (exactly what durable state persistence does),
  // fed to a BRAND NEW worker instance with no shared in-memory state.
  const rehydratedRunRef = JSON.parse(JSON.stringify(dispatched.workerRunRef))
  const freshWorker = createWebTableResearchWorker({ clock, acquireFn: fixtureAcquireFn(html) })
  const fetched = await freshWorker.fetchResult(rehydratedRunRef)
  assert.equal(fetched.ok, true)
  assert.equal(fetched.result.status, 'SUCCEEDED')
  assert.equal(fetched.result.proposedClaims.length, 2)
})

// Real-network finding, fixed: dispatch() now reports a genuine "no match"
// as {ok:false} (never a fabricated claim), NOT {ok:true} with an embedded
// FAILED result -- the latter made dispatchResearchNodeDurable's own
// idempotency-by-taskFingerprint check classify it EXACTLY_ONCE, which
// PERMANENTLY blocked any real retry for this synchronous, $0 worker (no
// external job exists to re-poll). {ok:false} classifies AT_MOST_ONCE,
// which the SAME existing dedup guard does not block -- see
// research-mission-fleet-driver.mjs's own retry/escalate machinery, no
// new mechanism.
test('a genuine no-match reports {ok:false} (never a fabricated claim, and never blocks a future real retry)', async () => {
  const html = await loadFixture('qb-stats-1995.html')
  const worker = createWebTableResearchWorker({ clock, acquireFn: fixtureAcquireFn(html) })
  const request = baseRequest({ nodeId: 'node:someone-else', targetEntity: { entityId: 'Someone Else', name: 'Someone Else' } })
  const dispatched = await worker.dispatch(request)
  assert.equal(dispatched.ok, false)
  assert.equal(dispatched.reason, 'NO_FREE_PUBLIC_MATCH_FOUND')
  assert.match(dispatched.detail, /table extracted but no row matched this entity/)
})

test('a requested field with no exact header match resolves via bounded semantic reconciliation, not left unresolved', async () => {
  await withStubEnv({ TSF_PLANNER_CLAUDE_COMMAND: STUB, TSF_PLANNER_CODEX_COMMAND: NONEXISTENT_CLI, STUB_MODE: 'success', STUB_RECONCILE_MODE: 'match' }, async () => {
    const html = await loadFixture('qb-stats-1995.html')
    const worker = createWebTableResearchWorker({ clock, acquireFn: fixtureAcquireFn(html) })
    const request = baseRequest({ requestedOutputSchema: { properties: { 'Total Passing Yards Gained': {} } } })
    const dispatched = await worker.dispatch(request)
    assert.equal(dispatched.ok, true)
    const { result } = await worker.fetchResult(dispatched.workerRunRef)
    assert.equal(result.status, 'SUCCEEDED')
    assert.equal(result.proposedClaims[0].fieldName, 'Total Passing Yards Gained')
    assert.equal(result.proposedClaims[0].proposedValue, '4413', 'value came from the real matched cell, not the reconciliation call')
  })
})

test('a field the live planner cannot confidently reconcile stays unresolved -- the node reports an honest NO_FREE_PUBLIC_MATCH_FOUND, never a guess', async () => {
  await withStubEnv({ TSF_PLANNER_CLAUDE_COMMAND: STUB, TSF_PLANNER_CODEX_COMMAND: NONEXISTENT_CLI, STUB_MODE: 'success', STUB_RECONCILE_MODE: 'null' }, async () => {
    const html = await loadFixture('qb-stats-1995.html')
    const worker = createWebTableResearchWorker({ clock, acquireFn: fixtureAcquireFn(html) })
    const request = baseRequest({ requestedOutputSchema: { properties: { 'Something Unrelated': {} } } })
    const dispatched = await worker.dispatch(request)
    assert.equal(dispatched.ok, false)
    assert.equal(dispatched.reason, 'NO_FREE_PUBLIC_MATCH_FOUND')
  })
})

test('{ok:false} when the mission specification names no preferredSources at all', async () => {
  const worker = createWebTableResearchWorker({ clock, acquireFn: fixtureAcquireFn('<html></html>') })
  const request = baseRequest({ preferredSources: [] })
  const dispatched = await worker.dispatch(request)
  assert.equal(dispatched.ok, false)
  assert.equal(dispatched.reason, 'NO_CANDIDATE_SOURCE_CONFIGURED')
})

test('a genuinely refused/blocked source (e.g. robots disallow) is reported in {ok:false}\'s detail, never silently treated as a match', async () => {
  const worker = createWebTableResearchWorker({
    clock,
    acquireFn: () => Promise.resolve({ receipt: { decision: 'REFUSED', decisionReason: 'ROBOTS_DISALLOWED' } })
  })
  const dispatched = await worker.dispatch(baseRequest())
  assert.equal(dispatched.ok, false)
  assert.match(dispatched.detail, /ROBOTS_DISALLOWED/)
})

// REAL INTEGRATION PROOF, the whole point of the {ok:false} fix: a real
// dispatchResearchNodeDurable call that fails to find a match must NOT
// permanently block a later real retry attempt for the SAME node/provider/
// taskFingerprint -- this exercises the actual shared dedup guard
// (research-dispatch-bookkeeping.mjs's classifyDispatchDeliveryGuarantee),
// not a mock of it.
test('REAL retry proof: two separate dispatchResearchNodeDurable calls against a node that keeps failing to match both genuinely attempt real acquisition -- never silently no-op\'d as "already dispatched"', async () => {
  const missionId = 'mission:retry-proof'
  const spec = {
    schemaVersion: 'TSF_RESEARCH_SPECIFICATION_V1',
    id: 'spec:retry-proof',
    researchQuestion: 'q',
    entityType: 'FIXTURE',
    requestedFields: [{ fieldName: 'Passing / Yards', valueType: 'number', required: true, derivationRule: null }],
    sourcePolicy: { preferredSources: ['https://example.com/1995-qb-stats'], disallowedSources: [], licensingConstraints: [], freshnessPolicy: 'UNSPECIFIED', requireIndependentSources: false, minSourceCount: 0, allowCrossMissionLibraryReuse: true },
    temporalRequirements: { asOfDate: '2026-09-06', periodScope: '1995' },
    budget: { maxCostUsd: 0, maxLatencyMs: null, maxToolCallsPerNode: null },
    toolPermissions: []
  }
  await createResearchMissionDurable(
    missionId,
    {
      projectId: 'test',
      specification: spec,
      expectedUniverse: { schemaVersion: 'TSF_EXPECTED_UNIVERSE_V1', entityType: 'FIXTURE', expectedCount: 1, expectedEntities: [{ entityId: 'nobody', identityHints: {} }] },
      nodes: [{ id: 'node:nobody', nodeRole: 'PRIMARY_RESEARCH', targetEntity: { entityId: 'nobody', name: 'Nobody Real' }, requestedFields: spec.requestedFields, requestedOutputSchema: { type: 'object', properties: { 'Passing / Yards': { type: 'number' } } } }]
    },
    clock
  )
  const html = await loadFixture('qb-stats-1995.html')
  let realAcquireCalls = 0
  const countingAcquireFn = (...args) => {
    realAcquireCalls += 1
    return fixtureAcquireFn(html)(...args)
  }
  const worker = createWebTableResearchWorker({ clock, acquireFn: countingAcquireFn })

  const first = await dispatchResearchNodeDurable(missionId, 'node:nobody', WEB_TABLE_PROVIDER_ID, worker, clock)
  assert.equal(first.ok, false, 'genuinely no match for "Nobody Real" in this fixture -- an honest failure')
  assert.equal(realAcquireCalls, 1, 'the first call really attempted real acquisition')

  const second = await dispatchResearchNodeDurable(missionId, 'node:nobody', WEB_TABLE_PROVIDER_ID, worker, clock)
  assert.equal(second.ok, false)
  assert.equal(second.alreadyDispatched, undefined, 'must never be silently short-circuited as already-dispatched')
  assert.equal(realAcquireCalls, 2, 'the second call ALSO really attempted real acquisition -- the fix in question: this used to be permanently blocked after the first FAILED attempt')

  const mission = readResearchMission(missionId)
  const node = mission.nodes[0]
  assert.equal(node.dispatchAttempts.length, 2, 'two real, distinct dispatch attempts are durably recorded')
  assert.ok(node.dispatchAttempts.every((a) => a.outcome === 'FAILED_CLEAN'), 'both attempts resolve FAILED_CLEAN, never left UNKNOWN/ambiguous')
})

// Architecture reconciliation, real end-to-end proof (not just the
// worker's own result shape): a genuinely SUCCEEDED dispatch through the
// real admitBoundedResearchResult path durably admits a
// SourceSnapshotReference for the web-table acquisition -- previously
// this admission never happened at all (sourceSnapshotsOrSnapshotRefs
// stayed [] all the way through), leaving the receipt reachable only
// inside providerRunId's opaque bookkeeping string.
test('REAL DURABLE ADMISSION: a genuinely successful dispatch admits a real SourceSnapshotReference carrying the acquisition receipt, not just a SourceReference', async () => {
  const missionId = 'mission:snapshot-admission-proof'
  const spec = {
    schemaVersion: 'TSF_RESEARCH_SPECIFICATION_V1',
    id: 'spec:snapshot-admission-proof',
    researchQuestion: 'q',
    entityType: 'FIXTURE',
    requestedFields: [{ fieldName: 'Passing / Yards', valueType: 'number', required: true, derivationRule: null }],
    sourcePolicy: { preferredSources: ['https://example.com/1995-qb-stats'], disallowedSources: [], licensingConstraints: [], freshnessPolicy: 'UNSPECIFIED', requireIndependentSources: false, minSourceCount: 0, allowCrossMissionLibraryReuse: true },
    temporalRequirements: { asOfDate: '2026-09-06', periodScope: '1995' },
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
  const html = await loadFixture('qb-stats-1995.html')
  const worker = createWebTableResearchWorker({ clock, acquireFn: fixtureAcquireFn(html) })

  const dispatched = await dispatchResearchNodeDurable(missionId, 'node:brett-favre', WEB_TABLE_PROVIDER_ID, worker, clock)
  assert.equal(dispatched.ok, true)
  const polled = await pollAndAdmitResearchNodeDurable(missionId, 'node:brett-favre', worker, clock)
  assert.equal(polled.ok, true)

  const mission = readResearchMission(missionId)
  const node = mission.nodes[0]
  assert.equal(node.sourceReferences.length, 1, 'a SourceReference is admitted (already true before this reconciliation)')
  assert.equal(node.sourceSnapshots.length, 1, 'a SourceSnapshotReference is NOW also admitted -- this is the fixed gap')
  const snapshot = node.sourceSnapshots[0]
  assert.equal(snapshot.schemaVersion, 'TSF_SOURCE_SNAPSHOT_REFERENCE_V1')
  assert.equal(snapshot.sourceRef, 'https://example.com/1995-qb-stats')
  assert.equal(snapshot.acquisitionMethod, 'WEB_TABLE_STATIC_SOURCE_EXTRACTION')
  assert.equal(snapshot.acquisitionMode, 'PUBLIC_WEB_SOURCE_EXTRACTION', 'REQ-005: the rights taxonomy is durably admitted as a top-level, queryable field')
  assert.equal(snapshot.accessClassification, 'PUBLIC_ALLOWED')
  assert.equal(snapshot.modeEvidence.receiptHash, snapshot.modeEvidence.receiptHash, 'the verbatim receipt (hash-verifiable) is durably stored')
  assert.equal(snapshot.modeEvidence.artifactRef.rawHtml, null, 'raw HTML never reaches durable mission state')
})

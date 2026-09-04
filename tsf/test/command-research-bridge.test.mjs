// Phase 3: Command <-> Dataset Research bridge. Proves the required
// conversational shapes route to REAL, durable ResearchMission state (not
// an ad-hoc chat reply), and proves the paid-provider authority boundary
// HQ decided: free/no-new-spend paths run under normal mission authority;
// paid dispatch is refused by default and only becomes possible through an
// explicit, scoped, mission+provider-specific owner grant parsed directly
// out of chat -- never inferred, never global, never leaking to another
// mission or provider. Isolated-state-file pattern per
// NWR_HISTORICAL_REDRAFT_DATASET_RESEARCH_HANDOFF.md -- env var set BEFORE
// any dynamic import that transitively touches server/data-store.mjs.
import assert from 'node:assert/strict'
import test from 'node:test'
import { rmSync } from 'node:fs'
import path from 'node:path'

const HERE = import.meta.dirname
const STATE_FILE = path.join(HERE, '..', 'server', '.local-state', `operator-state.test-command-research-bridge-${process.pid}.json`)
process.env.TSF_UI_STATE_FILE = STATE_FILE

const { classifyResearchIntent, respondResearchCommand } = await import('../server/command-research-bridge.mjs')
const { respondCommand } = await import('../server/command-responder.mjs')
const {
  createResearchMissionDurable,
  dispatchResearchNodeWithApprovalDurable,
  grantResearchPaidApprovalDurable,
  pollAndAdmitResearchNodeDurable,
  readActiveResearchPaidApproval,
  readResearchMissionReviewItems,
  readResearchMissionStatus
} = await import('../server/research-mission-driver.mjs')
const { readResearchMission } = await import('../server/research-mission-store.mjs')
const { loadState } = await import('../server/data-store.mjs')
const { withResearchLibrary } = await import('../server/research-library-store.mjs')
const { createResearchLibrary, indexCanonicalFact } = await import('../domain/research-library.mjs')
const { addResearchNode, createResearchMission } = await import('../domain/research-mission.mjs')
const { buildBoundedResearchRequest, markResearchNodeReady, recordResearchNodeDispatch, recordResearchNodeResult } = await import('../domain/research-node.mjs')
const { admitBoundedResearchResult } = await import('../domain/research-admission.mjs')
const { admitReconciliationDecision, decideReconciliation } = await import('../domain/research-reconciliation.mjs')
const { EXA_PROVIDER_ID } = await import('../adapters/exa-research-worker.mjs')
const { PARALLEL_PROVIDER_ID } = await import('../adapters/parallel-research-worker.mjs')
const { createDeterministicFakeResearchWorker } = await import('../adapters/deterministic-fake-research-worker.mjs')

function cleanupStateFile() {
  for (const suffix of ['', '.tmp', '.research.lock', '.research-library.lock']) rmSync(`${STATE_FILE}${suffix}`, { force: true })
}
cleanupStateFile()

const clock = () => new Date('2026-11-01T09:00:00.000Z')

// Simulates what http-server.mjs actually does per request: load fresh
// state from disk, then call the bridge with it -- never a stale in-memory
// opState carried across turns, exactly like production.
function freshOpState() {
  return loadState()
}

function fieldSpec(fieldNames, { allowLibraryReuse = true } = {}) {
  return {
    schemaVersion: 'TSF_RESEARCH_SPECIFICATION_V1',
    id: 'spec:bridge-test',
    researchQuestion: 'bridge test',
    entityType: 'TEST_ENTITY',
    requestedFields: fieldNames.map((f) => ({ fieldName: f, valueType: 'number', required: true })),
    sourcePolicy: {
      preferredSources: [],
      disallowedSources: [],
      licensingConstraints: [],
      freshnessPolicy: 'HISTORICAL_STATIC',
      requireIndependentSources: false,
      minSourceCount: 0,
      allowCrossMissionLibraryReuse: allowLibraryReuse
    },
    temporalRequirements: { asOfDate: '2026-11-01T09:00:00.000Z', periodScope: 'test-period' },
    budget: { maxCostUsd: null, maxLatencyMs: null, maxToolCallsPerNode: null },
    toolPermissions: []
  }
}

// Real donor mission with a genuine, fully-reconciled CanonicalFact --
// mirrors test/research-library.test.mjs's own missionWithCanonicalFact
// helper exactly (that file's the canonical worked example for how a real
// CanonicalFact is built end to end, not something this file reinvents).
function donorMissionWithCanonicalFact({ entityId, fieldName, value, temporalScope = 'test-period' }) {
  const spec = fieldSpec([fieldName])
  let mission = createResearchMission({ id: 'mission:donor', projectId: 'test', specification: spec, expectedUniverse: universe(entityId) }, clock)
  mission = addResearchNode(mission, { id: 'donor-node', nodeRole: 'PRIMARY_RESEARCH', targetEntity: { entityId }, requestedFields: [{ fieldName, valueType: 'number', required: true }], requestedOutputSchema: { type: 'object' } }, clock)
  const request = buildBoundedResearchRequest(mission, mission.nodes[0], 'FAKE', clock)
  mission = markResearchNodeReady(mission, 'donor-node', clock, mission.revision)
  const workerRunRef = { provider: 'FAKE', providerRunId: 'r1', dispatchedAt: clock().toISOString() }
  mission = recordResearchNodeDispatch(mission, 'donor-node', { taskFingerprint: request.taskFingerprint, workerRunRef }, clock, mission.revision)
  mission = recordResearchNodeResult(
    mission,
    'donor-node',
    {
      schemaVersion: 'TSF_BOUNDED_RESEARCH_RESULT_V1',
      nodeId: 'donor-node',
      taskFingerprint: request.taskFingerprint,
      provider: 'FAKE',
      providerRunRef: workerRunRef,
      status: 'SUCCEEDED',
      observations: [{ rawContent: 'raw', extractedAt: clock().toISOString(), providerConfidence: 0.9, providerReasoning: 'r' }],
      proposedClaims: [{ fieldName, proposedValue: value, temporalScope, providerConfidence: 0.9, providerReasoning: 'r' }],
      evidence: [{ claimFieldName: fieldName, sourceRef: 'src:1', snippet: 's', supportsClaim: true }],
      sourceReferences: [{ sourceRef: 'src:1', url: 'https://example.invalid', publisher: 'pub', retrievedAt: clock().toISOString() }],
      sourceSnapshotsOrSnapshotRefs: [{ sourceRef: 'src:1', contentHash: 'sha256:x', rawContentRef: 'fixture://x' }],
      newGapProposals: [],
      warnings: [],
      unresolvedQuestions: [],
      usage: { requestCount: 1, tokensOrUnits: 5, providerReportedCostUsd: 0 },
      failureDetails: null
    },
    clock,
    mission.revision
  )
  const digest = mission.nodes[0].rawResults.at(-1).digest
  mission = admitBoundedResearchResult(mission, 'donor-node', digest, clock, mission.revision)
  mission = decideReconciliation(mission, 'donor-node', { fieldName, decisionType: 'ACCEPT_DERIVED_VALUE', decidedValue: value, temporalScope, rationale: 'test setup', decidedBy: 'TEST' }, clock, mission.revision)
  const decisionId = mission.nodes[0].reconciliationDecisions.at(-1).id
  mission = admitReconciliationDecision(mission, 'donor-node', decisionId, clock, mission.revision)
  return { mission, canonicalFactId: mission.nodes[0].canonicalFacts[0].id }
}

function universe(entityId) {
  return {
    schemaVersion: 'TSF_EXPECTED_UNIVERSE_V1',
    entityType: 'TEST_ENTITY',
    expectedCount: 1,
    expectedEntities: [{ entityId, identityHints: {} }],
    source: 'test fixture'
  }
}

test('classifyResearchIntent recognizes every required conversational shape', () => {
  assert.equal(classifyResearchIntent('Research 2019 rookie WRs'), 'RESEARCH_CREATE_OR_CONTINUE')
  assert.equal(classifyResearchIntent('Build me a dataset of NBA draft picks'), 'RESEARCH_CREATE_OR_CONTINUE')
  assert.equal(classifyResearchIntent("Research this deeply but don't spend money"), 'RESEARCH_CREATE_OR_CONTINUE')
  assert.equal(classifyResearchIntent('Use Exa for this research up to $50'), 'RESEARCH_PAID_GRANT')
  assert.equal(classifyResearchIntent("What's the research doing?"), 'RESEARCH_STATUS')
  assert.equal(classifyResearchIntent('How complete is it?'), 'RESEARCH_COMPLETENESS')
  assert.equal(classifyResearchIntent('What conflicts remain?'), 'RESEARCH_CONFLICTS')
  assert.equal(classifyResearchIntent('Show me the artifacts/CSV'), 'RESEARCH_ARTIFACTS')
  assert.equal(classifyResearchIntent('Run WorldForge'), null, 'an ordinary fleet-dispatch message must not be swallowed by the research bridge')
  assert.equal(
    classifyResearchIntent("Run WorldForge, there's a merge conflict in the branch"),
    null,
    'an ordinary Git-merge-conflict mention must not be misrouted into the research bridge'
  )
})

test('bridge: create/continue routes to real durable ResearchMission state, not an ad-hoc reply', async () => {
  const r = await respondResearchCommand({ message: 'Research bridge widget forecasting', opState: freshOpState(), clock })
  assert.equal(r.live, true)
  assert.ok(r.researchMissionId)
  const status = readResearchMissionStatus(r.researchMissionId)
  assert.ok(status, 'a real mission must now exist on disk, not just a chat string')
  assert.equal(status.state, 'ACTIVE')
})

test('bridge: a follow-up question resolves the most-recently-touched mission without being told its name again', async () => {
  const created = await respondResearchCommand({ message: 'Research bridge follow-up topic', opState: freshOpState(), clock })
  assert.ok(created.researchMissionId)
  const status = await respondResearchCommand({ message: "What's the research doing?", opState: freshOpState(), clock })
  assert.equal(status.researchMissionId, created.researchMissionId)
  assert.match(status.text, /ACTIVE/)
})

test('bridge: paid dispatch is refused by default -- no grant, no dispatch', async () => {
  const missionId = 'mission:bridge-paid-default-off'
  await createResearchMissionDurable(missionId, { projectId: 'test', specification: fieldSpec(['x']), expectedUniverse: universe('e1'), nodes: [{ id: 'n1', nodeRole: 'PRIMARY_RESEARCH', targetEntity: { entityId: 'e1' }, requestedFields: [{ fieldName: 'x', valueType: 'number', required: true }], requestedOutputSchema: { type: 'object' } }] }, clock)
  const worker = createDeterministicFakeResearchWorker({ provider: EXA_PROVIDER_ID, clock })
  const result = await dispatchResearchNodeWithApprovalDurable(missionId, 'n1', EXA_PROVIDER_ID, worker, clock, { pricingPolicy: { [EXA_PROVIDER_ID]: { costPerRequestUsd: 1 } } })
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'NO_PAID_APPROVAL')
})

test('bridge: an explicit chat grant ("use Exa up to $X") authorizes a bounded paid dispatch, and the SAME ceiling refuses beyond it', async () => {
  const missionId = 'mission:bridge-paid-scoped-grant'
  await createResearchMissionDurable(
    missionId,
    {
      projectId: 'test',
      specification: fieldSpec(['x']),
      expectedUniverse: universe('e1'),
      nodes: [
        { id: 'n1', nodeRole: 'PRIMARY_RESEARCH', targetEntity: { entityId: 'e1' }, requestedFields: [{ fieldName: 'x', valueType: 'number', required: true }], requestedOutputSchema: { type: 'object' } },
        { id: 'n2', nodeRole: 'PRIMARY_RESEARCH', targetEntity: { entityId: 'e2' }, requestedFields: [{ fieldName: 'x', valueType: 'number', required: true }], requestedOutputSchema: { type: 'object' } }
      ]
    },
    clock
  )
  const opStateWithMission = { researchMissions: { [missionId]: readResearchMissionStatus(missionId) } }
  const grantReply = await respondResearchCommand({ message: `Use Exa for this research up to $5, for ${missionId}`, opState: opStateWithMission, clock })
  assert.equal(grantReply.intent, 'RESEARCH_PAID_GRANT')
  assert.equal(grantReply.researchMissionId, missionId)

  const approval = readActiveResearchPaidApproval(missionId, EXA_PROVIDER_ID, clock)
  assert.equal(approval.maxSpendUsd, 5)

  // The fake worker needs a scripted entry per real taskFingerprint (same
  // requirement test/research-mission-driver.test.mjs's own DISPATCH case
  // has) -- registered for both nodes up front so a cost-gate refusal
  // (which must happen BEFORE any worker call) is what's actually being
  // proven on node 2, not an unrelated "no script" failure.
  const script = new Map()
  const worker = createDeterministicFakeResearchWorker({ provider: EXA_PROVIDER_ID, clock, script })
  const missionNow = readResearchMission(missionId)
  for (const nodeId of ['n1', 'n2']) {
    const req = buildBoundedResearchRequest(missionNow, missionNow.nodes.find((n) => n.id === nodeId), EXA_PROVIDER_ID, clock)
    script.set(req.taskFingerprint, { proposedClaims: [{ fieldName: 'x', proposedValue: 1, temporalScope: 'test-period', providerConfidence: 0.9, providerReasoning: 'r' }], evidence: [], sourceReferences: [], sourceSnapshotsOrSnapshotRefs: [], usage: { requestCount: 1, tokensOrUnits: 1, providerReportedCostUsd: 5 } })
  }

  const pricingPolicy = { [EXA_PROVIDER_ID]: { costPerRequestUsd: 5 } }
  const first = await dispatchResearchNodeWithApprovalDurable(missionId, 'n1', EXA_PROVIDER_ID, worker, clock, { pricingPolicy })
  assert.equal(first.ok, true, 'first $5 request must fit under the $5 ceiling')

  const second = await dispatchResearchNodeWithApprovalDurable(missionId, 'n2', EXA_PROVIDER_ID, worker, clock, { pricingPolicy })
  assert.equal(second.ok, false, 'a second $5 request must be refused -- cumulative $10 exceeds the granted $5 ceiling')
  assert.equal(second.decision.reason, 'PROJECTED_SPEND_EXCEEDS_CEILING')
})

test('bridge: authorization isolation -- a grant never leaks to another mission or another provider', async () => {
  const missionA = 'mission:bridge-isolation-a'
  const missionB = 'mission:bridge-isolation-b'
  for (const id of [missionA, missionB]) {
    await createResearchMissionDurable(id, { projectId: 'test', specification: fieldSpec(['x']), expectedUniverse: universe('e1'), nodes: [{ id: 'n1', nodeRole: 'PRIMARY_RESEARCH', targetEntity: { entityId: 'e1' }, requestedFields: [{ fieldName: 'x', valueType: 'number', required: true }], requestedOutputSchema: { type: 'object' } }] }, clock)
  }
  await grantResearchPaidApprovalDurable(missionA, { providerId: EXA_PROVIDER_ID, maxSpendUsd: 100, grantedBy: 'test' }, clock)

  assert.equal(readActiveResearchPaidApproval(missionA, EXA_PROVIDER_ID, clock).maxSpendUsd, 100)
  assert.equal(readActiveResearchPaidApproval(missionB, EXA_PROVIDER_ID, clock), null, 'a grant on mission A must not authorize mission B')
  assert.equal(readActiveResearchPaidApproval(missionA, PARALLEL_PROVIDER_ID, clock), null, 'a grant for EXA must not authorize PARALLEL on the same mission')

  const worker = createDeterministicFakeResearchWorker({ provider: PARALLEL_PROVIDER_ID, clock })
  const wrongProvider = await dispatchResearchNodeWithApprovalDurable(missionA, 'n1', PARALLEL_PROVIDER_ID, worker, clock, { pricingPolicy: { [PARALLEL_PROVIDER_ID]: { costPerRequestUsd: 1 } } })
  assert.equal(wrongProvider.ok, false)
  assert.equal(wrongProvider.reason, 'NO_PAID_APPROVAL')
})

test('bridge: polling recovery never creates a new paid dispatch even when dispatch authority is absent', async () => {
  const missionId = 'mission:bridge-poll-never-dispatches'
  await createResearchMissionDurable(missionId, { projectId: 'test', specification: fieldSpec(['x']), expectedUniverse: universe('e1'), nodes: [{ id: 'n1', nodeRole: 'PRIMARY_RESEARCH', targetEntity: { entityId: 'e1' }, requestedFields: [{ fieldName: 'x', valueType: 'number', required: true }], requestedOutputSchema: { type: 'object' } }] }, clock)
  let dispatchCalls = 0
  const worker = { dispatch: async () => { dispatchCalls += 1; throw new Error('poll must never dispatch') }, fetchResult: async () => ({ ok: true, status: 'READY', result: null }) }
  const result = await pollAndAdmitResearchNodeDurable(missionId, 'n1', worker, clock)
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'NOT_YET_DISPATCHED')
  assert.equal(dispatchCalls, 0)
})

test('bridge: free-path continuation genuinely advances via Research Library reuse (not fabricated) and never raises a paid request when told not to spend money', async () => {
  const missionId = 'mission:bridge-free-path-library-reuse'
  await createResearchMissionDurable(missionId, { projectId: 'test', specification: fieldSpec(['x']), expectedUniverse: universe('reuse-entity'), nodes: [{ id: 'n1', nodeRole: 'PRIMARY_RESEARCH', targetEntity: { entityId: 'reuse-entity' }, requestedFields: [{ fieldName: 'x', valueType: 'number', required: true }], requestedOutputSchema: { type: 'object' } }] }, clock)
  const { mission: donorMission, canonicalFactId } = donorMissionWithCanonicalFact({ entityId: 'reuse-entity', fieldName: 'x', value: 42 })
  await withResearchLibrary((current) => {
    const lib = current ?? createResearchLibrary(clock)
    return indexCanonicalFact(lib, donorMission, 'donor-node', canonicalFactId, clock, lib.revision)
  })

  const opStateWithMission = { researchMissions: { [missionId]: readResearchMissionStatus(missionId) } }
  const reply = await respondResearchCommand({ message: `Research this deeply but don't spend money, for ${missionId}`, opState: opStateWithMission, clock })
  assert.match(reply.text, /advanced/i)
  const openItems = readResearchMissionReviewItems(missionId)
  assert.equal(openItems.filter((n) => n.category === 'PAID_PROVIDER_APPROVAL_REQUIRED').length, 0, 'free-only must never raise a paid-research request')
})

test('bridge: when a genuine gap remains and paid research is not excluded, Command surfaces a scoped REQUEST -- never a silent grant', async () => {
  const missionId = 'mission:bridge-surfaces-paid-request'
  await createResearchMissionDurable(missionId, { projectId: 'test', specification: fieldSpec(['unreachable-field']), expectedUniverse: universe('no-library-hit'), nodes: [{ id: 'n1', nodeRole: 'PRIMARY_RESEARCH', targetEntity: { entityId: 'no-library-hit' }, requestedFields: [{ fieldName: 'unreachable-field', valueType: 'number', required: true }], requestedOutputSchema: { type: 'object' } }] }, clock)
  const opStateWithMission = { researchMissions: { [missionId]: readResearchMissionStatus(missionId) } }
  const reply = await respondResearchCommand({ message: `Research this deeply, for ${missionId}`, opState: opStateWithMission, clock })
  assert.match(reply.text, /paid-research approval request/i)
  const openItems = readResearchMissionReviewItems(missionId)
  const paidRequest = openItems.find((n) => n.category === 'PAID_PROVIDER_APPROVAL_REQUIRED')
  assert.ok(paidRequest, 'a scoped Needs You request must exist')
  assert.equal(paidRequest.resolvedAt, null, 'a REQUEST must stay unresolved -- never auto-granted')
  assert.equal(readActiveResearchPaidApproval(missionId, EXA_PROVIDER_ID, clock), null, 'surfacing a request must never itself authorize spend')
})

test('bridge: status/completeness/conflicts/artifacts conversational reads are grounded in real mission state', async () => {
  const missionId = 'mission:bridge-reads'
  await createResearchMissionDurable(missionId, { projectId: 'test', specification: fieldSpec(['x']), expectedUniverse: universe('e1'), nodes: [{ id: 'n1', nodeRole: 'PRIMARY_RESEARCH', targetEntity: { entityId: 'e1' }, requestedFields: [{ fieldName: 'x', valueType: 'number', required: true }], requestedOutputSchema: { type: 'object' } }] }, clock)
  const opStateWithMission = { researchMissions: { [missionId]: readResearchMissionStatus(missionId) } }

  const status = await respondResearchCommand({ message: `What's the research doing on ${missionId}?`, opState: opStateWithMission, clock })
  assert.match(status.text, /ACTIVE/)

  const completeness = await respondResearchCommand({ message: `How complete is ${missionId}?`, opState: opStateWithMission, clock })
  assert.match(completeness.text, /Completeness/)

  const conflicts = await respondResearchCommand({ message: `What conflicts remain on ${missionId}?`, opState: opStateWithMission, clock })
  assert.match(conflicts.text, /conflict/i)

  const artifacts = await respondResearchCommand({ message: `Show me the artifacts/CSV for ${missionId}`, opState: opStateWithMission, clock })
  assert.match(artifacts.text, /Artifacts/)
})

test('integration: respondCommand (the real global-scope Command entry point) routes a research message to the bridge and never touches project-fleet dispatch', async () => {
  const result = await respondCommand({ message: 'Research the bridge integration path end to end', projects: [], opState: freshOpState(), clock })
  assert.equal(result.scope, 'RESEARCH')
  assert.equal(result.resolvedProjectIds.length, 0)
  assert.ok(result.researchMissionId)
})

test('integration: an ordinary fleet message is completely unaffected by the research bridge', async () => {
  const result = await respondCommand({ message: "what's running right now?", projects: [], opState: freshOpState(), clock })
  assert.equal(result.scope, 'FLEET')
  assert.equal(result.researchMissionId, undefined)
})

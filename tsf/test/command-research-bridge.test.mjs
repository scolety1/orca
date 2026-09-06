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
// This machine has a real, working planner CLI available -- every test in
// this file that reaches mission-creation must explicitly refuse it (an
// unset/nonexistent override), or an ordinary test run would make a real,
// billable live-planner call. Tests that specifically want the live-planner
// path override these locally with the stub CLI (see
// command-research-spec-synthesis.test.mjs's own withPlannerEnv pattern).
process.env.TSF_PLANNER_CLAUDE_COMMAND = path.join(HERE, 'fixtures', 'does-not-exist-binary')
process.env.TSF_PLANNER_CODEX_COMMAND = path.join(HERE, 'fixtures', 'does-not-exist-binary')

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

// Mirrors http-server.mjs's own real chat-save exactly (see that file's
// comment on the bounded semantic record) -- this test file calls
// respondResearchCommand directly, bypassing the HTTP layer that would
// normally persist this after every real turn.
async function persistCommandTurn(reply) {
  const { saveState } = await import('../server/data-store.mjs')
  const state = loadState()
  const threads = { ...state.chatThreads }
  threads.__command__ = [
    ...(threads.__command__ ?? []),
    { role: 'assistant', content: reply.text, at: clock().toISOString(), decisionClass: reply.decisionClass, intent: reply.intent, resolvedProjectIds: reply.resolvedProjectIds ?? [], researchMissionId: reply.researchMissionId ?? null, scope: reply.scope }
  ]
  saveState({ ...state, chatThreads: threads })
}

// Earlier tests in this file persist real __command__ chat context into the
// shared on-disk state (same pattern production uses); a test that means to
// prove the "no conversational context at all" case has to actually clear
// that, not just assume it -- otherwise it's testing leftover context from
// whatever ran before it, not the no-context case its name claims.
async function clearCommandThread() {
  const { saveState } = await import('../server/data-store.mjs')
  const state = loadState()
  saveState({ ...state, chatThreads: { ...state.chatThreads, __command__: [] } })
}

// Same reasoning as clearCommandThread: this file's tests share one
// on-disk state, so missions from earlier tests really do accumulate --
// a test that means to prove the genuinely-zero-missions case has to wipe
// this too, or it's testing "many missions, no context" instead.
async function clearAllResearchMissions() {
  const { saveState } = await import('../server/data-store.mjs')
  const state = loadState()
  saveState({ ...state, researchMissions: {} })
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

test('bridge: a follow-up question resolves THIS CONVERSATION\'s own mission without being told its name again -- even with other missions in the system', async () => {
  const created = await respondResearchCommand({ message: 'Research bridge follow-up topic', opState: freshOpState(), clock })
  assert.ok(created.researchMissionId)
  // Simulates http-server.mjs's own real chat-save (this unit test calls
  // respondResearchCommand directly, bypassing that layer) -- conversation
  // context is exactly this persisted record, never re-derived from raw
  // recency (see resolveMissionContext's own header).
  await persistCommandTurn(created)
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

  // Bug 4 fix: human-readable, grounded in real state -- never a raw JSON
  // dump, never a fixed string (real expected-count/phase appear).
  const completeness = await respondResearchCommand({ message: `How complete is ${missionId}?`, opState: opStateWithMission, clock })
  assert.match(completeness.text, /isn't done yet/)
  assert.match(completeness.text, /all 1 expected item/)
  assert.doesNotMatch(completeness.text, /```json/, 'must never be a raw JSON dump')

  const conflicts = await respondResearchCommand({ message: `What conflicts remain on ${missionId}?`, opState: opStateWithMission, clock })
  assert.match(conflicts.text, /conflict/i)

  // Bug 3 fix: grounded in real per-node canonicalFacts, never the
  // nonexistent top-level artifacts.canonicalFacts field (a real,
  // independently-found bug -- that always reported 0 regardless of
  // real state).
  const artifacts = await respondResearchCommand({ message: `Show me the artifacts/CSV for ${missionId}`, opState: opStateWithMission, clock })
  assert.match(artifacts.text, /hasn't produced that artifact yet/)
  assert.match(artifacts.text, /currently CREATED/)
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

// Hands-on pilot round 2, Finding 2/3: a reasonably-scoped request must
// produce a REAL specification (not an empty scaffold), and the reply must
// say "Created", never "Started", since nothing has been dispatched yet.
// Uses the stub CLI (real subprocess wiring, deterministic content) --
// this file's own top-of-file env vars block the real planner by default.
const PLANNER_STUB = path.join(HERE, 'fixtures', 'stub-planner-cli.mjs')

test('bridge: a reasonably-scoped research request synthesizes a real specification and says "Created", never "Started"', async () => {
  const saved = { claude: process.env.TSF_PLANNER_CLAUDE_COMMAND }
  process.env.TSF_PLANNER_CLAUDE_COMMAND = PLANNER_STUB
  try {
    const reply = await respondCommand({ message: 'research something reasonably scoped for the bridge synthesis test', projects: [], opState: freshOpState(), clock })
    assert.match(reply.text, /^Created the research mission/)
    assert.doesNotMatch(reply.text, /Started/)
    assert.doesNotMatch(reply.text, /provisional scaffold/)
    // Bug 1 fix: creation must never say "ask me to continue it" -- a real
    // free-path attempt already ran, and since no free match exists for
    // this brand-new topic and freeOnly wasn't requested, a real scoped
    // paid-research request is already raised (never a grant).
    assert.doesNotMatch(reply.text, /ask me to continue/)
    assert.match(reply.text, /paid-research approval request/)
    // Adversarial-review finding, fixed: a mission genuinely blocked on
    // Tim's paid-research decision must never ALSO claim "Queued for
    // autonomous progression" in the same breath -- that's self-
    // contradictory. Only a genuinely unblocked mission gets that claim.
    assert.doesNotMatch(reply.text, /Queued for autonomous progression/)
    // This request is NOT freeOnly and no free-path match exists for a
    // brand-new topic, so Command's own immediate free-path attempt
    // correctly finds a genuine gap and raises a real scoped paid
    // request -- the mission's real phase reflects that a decision is
    // genuinely needed (WAITING_NEEDS_INPUT), never silently CREATED as
    // if nothing happened. See the sibling free-path-only test below for
    // the case where no owner decision is needed and it stays autonomous.
    const status = readResearchMissionStatus(reply.researchMissionId)
    assert.equal(status.phase, 'WAITING_NEEDS_INPUT')
    assert.ok(status.nodeCount > 0, 'a real synthesized specification must produce real nodes, not an empty scaffold')
  } finally {
    if (saved.claude === undefined) delete process.env.TSF_PLANNER_CLAUDE_COMMAND
    else process.env.TSF_PLANNER_CLAUDE_COMMAND = saved.claude
  }
})

test('bridge: a genuinely under-specified research request asks ONE bounded clarification and creates nothing -- never claims anything started', async () => {
  const saved = { claude: process.env.TSF_PLANNER_CLAUDE_COMMAND, insufficient: process.env.STUB_RESEARCH_SPEC_INSUFFICIENT }
  process.env.TSF_PLANNER_CLAUDE_COMMAND = PLANNER_STUB
  process.env.STUB_RESEARCH_SPEC_INSUFFICIENT = '1'
  try {
    const reply = await respondCommand({ message: 'research something genuinely too vague to synthesize', projects: [], opState: freshOpState(), clock })
    assert.doesNotMatch(reply.text, /Created|Started/)
    assert.match(reply.text, /stub: which specific years and fields/)
    assert.equal(reply.researchMissionId, null, 'no mission may exist yet -- Tim must not be made to restate a request the system should have understood')
  } finally {
    if (saved.claude === undefined) delete process.env.TSF_PLANNER_CLAUDE_COMMAND
    else process.env.TSF_PLANNER_CLAUDE_COMMAND = saved.claude
    if (saved.insufficient === undefined) delete process.env.STUB_RESEARCH_SPEC_INSUFFICIENT
    else process.env.STUB_RESEARCH_SPEC_INSUFFICIENT = saved.insufficient
  }
})

// Command architecture round 3: research follow-up gaps.
test('classifyResearchIntent: the round-3 additions ("what\'s missing", "show me the evidence", "could Exa help?", "cancel it")', () => {
  assert.equal(classifyResearchIntent("what's missing?"), 'RESEARCH_COMPLETENESS')
  assert.equal(classifyResearchIntent('show me the evidence'), 'RESEARCH_ARTIFACTS')
  assert.equal(classifyResearchIntent('could Exa help?'), 'RESEARCH_PAID_ADVISORY')
  assert.equal(classifyResearchIntent('cancel it'), 'RESEARCH_CANCEL')
  assert.equal(classifyResearchIntent('cancel that'), 'RESEARCH_CANCEL')
})

test('RESEARCH_PAID_ADVISORY ("could Exa help?"): advisory only -- never grants or requests anything, mission state completely untouched', async () => {
  const missionId = 'mission:advisory-test'
  await createResearchMissionDurable(missionId, { projectId: 'test', specification: fieldSpec(['x']), expectedUniverse: universe('e1'), nodes: [{ id: 'n1', nodeRole: 'PRIMARY_RESEARCH', targetEntity: { entityId: 'e1' }, requestedFields: [{ fieldName: 'x', valueType: 'number', required: true }], requestedOutputSchema: { type: 'object' } }] }, clock)
  const before = readResearchMissionStatus(missionId)
  const opStateWithMission = { researchMissions: { [missionId]: before } }
  const reply = await respondResearchCommand({ message: `could Exa help with ${missionId}?`, opState: opStateWithMission, clock })
  assert.equal(reply.intent, 'RESEARCH_PAID_ADVISORY')
  assert.equal(reply.live, false)
  const after = readResearchMissionStatus(missionId)
  assert.deepEqual(after, before, 'an advisory question must never mutate mission state')
  assert.equal(readActiveResearchPaidApproval(missionId, EXA_PROVIDER_ID, clock), null)
})

test('RESEARCH_CANCEL ("cancel it"): really cancels the real durable mission (BLOCKED), and refuses honestly on an already-terminal mission', async () => {
  const missionId = 'mission:cancel-test'
  await createResearchMissionDurable(missionId, { projectId: 'test', specification: fieldSpec(['x']), expectedUniverse: universe('e1'), nodes: [] }, clock)
  const opStateWithMission = { researchMissions: { [missionId]: readResearchMissionStatus(missionId) } }
  const reply = await respondResearchCommand({ message: `for ${missionId}, cancel it`, opState: opStateWithMission, clock })
  assert.match(reply.text, /^Cancelled/)
  assert.equal(readResearchMissionStatus(missionId).state, 'BLOCKED')

  // Already terminal (BLOCKED has no further transitions this bridge
  // reaches for in this test -- COMPLETE is the real terminal case, proven
  // via the domain layer already; here we prove a SECOND cancel on the
  // same now-BLOCKED mission is refused honestly, not silently re-applied).
  const second = await respondResearchCommand({ message: `for ${missionId}, cancel it`, opState: { researchMissions: { [missionId]: readResearchMissionStatus(missionId) } }, clock })
  assert.match(second.text, /Couldn't cancel/)
})

test('RESEARCH_CANCEL: bare "cancel it" (no id in the message) resolves THIS CONVERSATION\'s own mission, even with other missions in the system', async () => {
  const missionId = 'mission:cancel-backref-test'
  await createResearchMissionDurable(missionId, { projectId: 'test', specification: fieldSpec(['x']), expectedUniverse: universe('e1'), nodes: [] }, clock)
  // Establishes real conversational context first -- exactly what a real
  // Tim conversation does (ask about it, THEN say "cancel it") -- never
  // relying on raw system-wide recency (resolveMissionContext's own
  // header).
  const status = await respondResearchCommand({ message: `research status for ${missionId}`, opState: freshOpState(), clock })
  assert.equal(status.researchMissionId, missionId)
  await persistCommandTurn(status)

  const reply = await respondResearchCommand({ message: 'cancel it', opState: freshOpState(), clock })
  assert.match(reply.text, /^Cancelled/)
  assert.match(reply.text, new RegExp(missionId))
  assert.equal(readResearchMissionStatus(missionId).state, 'BLOCKED')
})

test('RESEARCH_CANCEL/RESEARCH_PAID_ADVISORY: with NO conversational context and MULTIPLE missions in the system, a bare "cancel it"/"could Exa help?" asks which one rather than guessing by raw recency', async () => {
  const a = 'mission:ambiguous-a'
  const b = 'mission:ambiguous-b'
  for (const id of [a, b]) {
    await createResearchMissionDurable(id, { projectId: 'test', specification: fieldSpec(['x']), expectedUniverse: universe('e1'), nodes: [] }, clock)
  }
  await clearCommandThread()
  const cancelReply = await respondResearchCommand({ message: 'cancel it', opState: freshOpState(), clock })
  assert.match(cancelReply.text, /more than one research mission/i)
  assert.doesNotMatch(cancelReply.text, /^Cancelled/)

  const adviceReply = await respondResearchCommand({ message: 'could Exa help?', opState: freshOpState(), clock })
  assert.match(adviceReply.text, /more than one research mission/i)
})

test('Gap 2: RESEARCH_STATUS turn -> bare "could Exa help?" resolves the mission JUST discussed, purely from conversational context (no id in either message)', async () => {
  const missionId = 'mission:advisory-after-status'
  await createResearchMissionDurable(missionId, { projectId: 'test', specification: fieldSpec(['x']), expectedUniverse: universe('e1'), nodes: [] }, clock)
  await clearCommandThread()
  const status = await respondResearchCommand({ message: `research status for ${missionId}`, opState: freshOpState(), clock })
  assert.equal(status.researchMissionId, missionId)
  await persistCommandTurn(status)

  const advice = await respondResearchCommand({ message: 'could Exa help?', opState: freshOpState(), clock })
  assert.equal(advice.intent, 'RESEARCH_PAID_ADVISORY')
  assert.equal(advice.researchMissionId, missionId)
  assert.equal(advice.live, false)
  assert.equal(readActiveResearchPaidApproval(missionId, EXA_PROVIDER_ID, clock), null)
})

test('Gap 2: an EXPLICIT mission id in the message always outranks stale conversational context', async () => {
  const stale = 'mission:advisory-stale'
  const real = 'mission:advisory-real-target'
  await createResearchMissionDurable(stale, { projectId: 'test', specification: fieldSpec(['x']), expectedUniverse: universe('e1'), nodes: [] }, clock)
  await createResearchMissionDurable(real, { projectId: 'test', specification: fieldSpec(['x']), expectedUniverse: universe('e1'), nodes: [] }, clock)
  await clearCommandThread()
  const status = await respondResearchCommand({ message: `research status for ${stale}`, opState: freshOpState(), clock })
  assert.equal(status.researchMissionId, stale)
  await persistCommandTurn(status)

  const advice = await respondResearchCommand({ message: `could Exa help with ${real}?`, opState: freshOpState(), clock })
  assert.equal(advice.researchMissionId, real, 'the explicitly-named mission wins over the stale context from the prior turn')
})

test('Gap 2: no prior research context and no missions at all -> bounded clarification, never a guess at an unrelated project', async () => {
  await clearCommandThread()
  await clearAllResearchMissions()
  const advice = await respondResearchCommand({ message: 'could Exa help?', opState: freshOpState(), clock })
  assert.equal(advice.researchMissionId, null)
  assert.doesNotMatch(advice.text, /more than one research mission/i, 'zero missions is not the ambiguous-multiple case')
  assert.match(advice.text, /no research mission yet/i)
})

// Adversarial-review finding, fixed: RESEARCH_ARTIFACTS/RESEARCH_STATUS/
// RESEARCH_COMPLETENESS/RESEARCH_CONFLICTS/RESEARCH_PAID_ADVISORY are
// deliberately broad, everyday phrasings (Bug 2/3/4's own fix) -- in a
// fleet that has NEVER created any research mission, one of these phrases
// used to permanently hijack the entire respondCommand reply into "no
// research mission yet" ahead of normal project/fleet resolution, since
// command-responder.mjs's gate ran before any project matching at all.
test('adversarial-review fix: research-follow-up phrasing never hijacks an ordinary Command message when this fleet has no research missions at all', async () => {
  await clearCommandThread()
  await clearAllResearchMissions()
  const noResearchOpState = freshOpState()
  const projects = [{
    id: 'build-project',
    displayName: 'Build Project',
    sourceClass: 'REAL',
    mission: { state: 'ONBOARDED', id: null, blockedReason: null },
    candidate: null,
    receipts: { chain: [] }
  }]
  for (const message of ['paste it here', 'is the build still running?', 'what did it find', 'how far along is it', 'show me the results']) {
    const result = await respondCommand({ message, projects, opState: noResearchOpState, clock })
    assert.ok(!result.researchMissionId, `"${message}" must never resolve to a research mission when none exist`)
    assert.doesNotMatch(result.text, /no research mission yet/i, `"${message}" was wrongly hijacked into the research bridge's empty-fleet fallback`)
  }
})

// Same phrasings, but now a real mission genuinely exists -- proves the
// fix is precise: it suppresses the false positive without breaking the
// real Bug 2/3/4 follow-up routing this session's other tests already
// cover in depth.
test('adversarial-review fix, control: the same research-follow-up phrasing STILL routes to the research bridge once a real mission exists', async () => {
  await clearCommandThread()
  await clearAllResearchMissions()
  const missionId = 'mission:adversarial-review-control'
  await createResearchMissionDurable(missionId, { projectId: 'test', specification: fieldSpec(['x']), expectedUniverse: universe('e1'), nodes: [] }, clock)
  const result = await respondCommand({ message: 'paste it here', projects: [], opState: freshOpState(), clock })
  assert.equal(result.researchMissionId, missionId)
})

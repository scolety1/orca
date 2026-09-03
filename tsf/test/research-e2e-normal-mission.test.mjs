// CONTINUATION 2, Section 6: "the canonical V0 end-to-end regression."
// ONE complete, deterministic research mission driven entirely through the
// REAL, persisted TSF interface (research-mission-driver.mjs +
// research-mission-store.mjs + research-library-store.mjs) -- never a
// hand-inlined domain call standing in for the real execution path.
// Exercises, in one coherent run: mission creation, expected universe,
// research-library lookup (miss then hit), real worker dispatch, durable
// result persistence, PARTIAL results, admission, verification, source
// independence, temporal semantics, a genuine conflict escalated to Needs
// You and resolved, reconciliation, CanonicalFact creation, completeness,
// the artifact package, and a simulated process restart mid-dispatch.
//
// This is the canonical smoke test for the whole engine -- if this file
// ever goes red, something fundamental broke, not just one narrow module.
import assert from 'node:assert/strict'
import test from 'node:test'
import { rmSync } from 'node:fs'
import path from 'node:path'
import { createDeterministicFakeResearchWorker } from '../adapters/deterministic-fake-research-worker.mjs'
import { addResearchNode, resolveResearchNeedsYou } from '../domain/research-mission.mjs'
import { admitReconciliationDecision, decideReconciliation } from '../domain/research-reconciliation.mjs'
import { buildBoundedResearchRequest } from '../domain/research-node.mjs'
import { recordDispatchAttempt, resolveDispatchAttempt, classifyDispatchDeliveryGuarantee } from '../domain/research-dispatch-bookkeeping.mjs'
import { recordSourceIndependenceMetadata } from '../domain/research-source-independence.mjs'
import { createResearchLibrary, evaluateResearchLibraryReuse, indexCanonicalFact } from '../domain/research-library.mjs'
import { buildNflQb2001Specification } from '../fixtures/nfl-2001-qb-research-fixture.mjs'

const HERE = import.meta.dirname
const STATE_FILE = path.join(HERE, '..', 'server', '.local-state', `operator-state.test-research-e2e-${process.pid}.json`)
process.env.TSF_UI_STATE_FILE = STATE_FILE

const {
  cancelResearchNodeDurable,
  createResearchMissionDurable,
  dispatchResearchNodeDurable,
  pollAndAdmitResearchNodeDurable,
  readResearchMissionArtifacts,
  readResearchMissionCompleteness,
  readResearchMissionReviewItems,
  readResearchMissionStatus,
  verifyAndReconcileResearchNodeFieldDurable
} = await import('../server/research-mission-driver.mjs')
const { withResearchMission, readResearchMission } = await import('../server/research-mission-store.mjs')
const { withResearchLibrary, readResearchLibrary } = await import('../server/research-library-store.mjs')

function cleanupStateFile() {
  for (const suffix of ['', '.tmp', '.research.lock', '.research-library.lock']) rmSync(`${STATE_FILE}${suffix}`, { force: true })
}
cleanupStateFile()

const clock = () => new Date('2026-11-15T09:00:00.000Z')
const MISSION_ID = 'mission:e2e-normal'
const BRADY = 'node:brady'
const WARNER = 'node:warner'

test('canonical V0 end-to-end regression: one deterministic mission through the real persisted TSF interface', async (t) => {
 try {
  const script = new Map()
  const worker = createDeterministicFakeResearchWorker({ provider: 'FAKE_A', clock, script })
  const specification = buildNflQb2001Specification()
  const sourcePolicy = { ...specification.sourcePolicy, allowCrossMissionLibraryReuse: true, freshnessPolicy: 'HISTORICAL_STATIC' }
  const scopedSpecification = { ...specification, sourcePolicy }

  await t.test('1. mission creation + expected universe, through the real durable path', async () => {
    const mission = await createResearchMissionDurable(
      MISSION_ID,
      {
        projectId: 'fixture:proj',
        specification: scopedSpecification,
        expectedUniverse: scopedSpecification.expectedUniverse,
        nodes: [
          { id: BRADY, nodeRole: 'PRIMARY_RESEARCH', targetEntity: { entityId: 'nfl:2001:qb:tom-brady', name: 'Tom Brady' }, requestedFields: [{ fieldName: 'team', valueType: 'string', required: true }, { fieldName: 'yards', valueType: 'number', required: true, requiredTemporalScopes: ['2001-regular-season'] }], requestedOutputSchema: { type: 'object' } },
          { id: WARNER, nodeRole: 'PRIMARY_RESEARCH', targetEntity: { entityId: 'nfl:2001:qb:kurt-warner', name: 'Kurt Warner' }, requestedFields: [{ fieldName: 'yards', valueType: 'number', required: true }], requestedOutputSchema: { type: 'object' } }
        ]
      },
      clock
    )
    assert.equal(mission.nodes.length, 2)
    assert.equal(readResearchMissionStatus(MISSION_ID).state, 'ACTIVE')
  })

  await t.test('2. research-library lookup BEFORE any dispatch: CACHE_MISS -- nothing to reuse yet', async () => {
    await withResearchLibrary((current) => current ?? createResearchLibrary(clock))
    const library = readResearchLibrary()
    const evaluation = evaluateResearchLibraryReuse(library, { sourcePolicy, entityId: 'nfl:2001:qb:tom-brady', fieldName: 'yards', requiredTemporalScope: '2001-regular-season', valueType: 'number' })
    assert.equal(evaluation.decision, 'CACHE_MISS')
  })

  await t.test('3. worker dispatch + durable result persistence: a PARTIAL first cycle (real content, honestly incomplete)', async () => {
    const mission = readResearchMission(MISSION_ID)
    const req = buildBoundedResearchRequest(mission, mission.nodes.find((n) => n.id === BRADY), 'FAKE_A', clock)
    script.set(req.taskFingerprint, {
      resultStatus: 'PARTIAL',
      proposedClaims: [{ fieldName: 'team', proposedValue: 'NE', temporalScope: null, providerConfidence: 0.9, providerReasoning: 'roster record' }],
      evidence: [{ claimFieldName: 'team', sourceRef: 'src:roster', snippet: 'Patriots 2001 roster', supportsClaim: true }],
      sourceReferences: [{ sourceRef: 'src:roster', url: 'https://example.invalid/roster', publisher: 'primary-league-source', retrievedAt: clock().toISOString() }],
      sourceSnapshotsOrSnapshotRefs: [],
      unresolvedQuestions: ['season passing yards not yet resolved']
    })
    const dispatched = await dispatchResearchNodeDurable(MISSION_ID, BRADY, 'FAKE_A', worker, clock)
    assert.equal(dispatched.ok, true)
    const polled = await pollAndAdmitResearchNodeDurable(MISSION_ID, BRADY, worker, clock)
    assert.equal(polled.ok, true)
    const node = readResearchMission(MISSION_ID).nodes.find((n) => n.id === BRADY)
    assert.equal(node.lastResultOutcome, 'PARTIAL', 'honest -- not disguised as full completion')
    assert.equal(node.claims.length, 1)
  })

  await t.test('4. a SECOND real dispatch cycle completes the missing field (temporal semantics: correctly scoped)', async () => {
    const mission = readResearchMission(MISSION_ID)
    const req = buildBoundedResearchRequest(mission, mission.nodes.find((n) => n.id === BRADY), 'FAKE_B', clock)
    script.set(req.taskFingerprint, {
      provider: 'FAKE_B',
      proposedClaims: [{ fieldName: 'yards', proposedValue: 2843, temporalScope: '2001-regular-season', providerConfidence: 0.95, providerReasoning: 'official season stats' }],
      evidence: [{ claimFieldName: 'yards', sourceRef: 'src:stats', snippet: '2001 season passing yards', supportsClaim: true }],
      sourceReferences: [{ sourceRef: 'src:stats', url: 'https://example.invalid/stats', publisher: 'official-league-source', retrievedAt: clock().toISOString() }],
      sourceSnapshotsOrSnapshotRefs: []
    })
    const dispatched = await dispatchResearchNodeDurable(MISSION_ID, BRADY, 'FAKE_B', worker, clock)
    assert.equal(dispatched.ok, true)
    const polled = await pollAndAdmitResearchNodeDurable(MISSION_ID, BRADY, worker, clock)
    assert.equal(polled.ok, true)
    const node = readResearchMission(MISSION_ID).nodes.find((n) => n.id === BRADY)
    assert.equal(node.lastResultOutcome, 'SUCCEEDED')
    assert.equal(node.claims.length, 2, 'the first cycle\'s PARTIAL claim is preserved, not erased')
    assert.equal(node.status, 'ADMITTED')
  })

  await t.test('5. source independence: the primary-league source is explicitly classified through the real persisted path', async () => {
    const mission = readResearchMission(MISSION_ID)
    const node = mission.nodes.find((n) => n.id === BRADY)
    const sourceId = node.sourceReferences.find((s) => s.sourceRef === 'src:stats').id
    const updated = await withResearchMission(MISSION_ID, (m) =>
      recordSourceIndependenceMetadata(m, BRADY, sourceId, { sourceQualityClass: 'PRIMARY_SOURCE', independenceState: 'INDEPENDENT' }, clock, m.revision)
    )
    const src = updated.nodes.find((n) => n.id === BRADY).sourceReferences.find((s) => s.id === sourceId)
    assert.equal(src.sourceQualityClass, 'PRIMARY_SOURCE')
  })

  await t.test('6. verification + reconciliation -> real CanonicalFacts for both fields, through the real driver', async () => {
    let result = await verifyAndReconcileResearchNodeFieldDurable(MISSION_ID, BRADY, 'team', 'E2E_TEST', clock)
    assert.equal(result.canonicalized, true)
    result = await verifyAndReconcileResearchNodeFieldDurable(MISSION_ID, BRADY, 'yards', 'E2E_TEST', clock)
    assert.equal(result.canonicalized, true)
    const node = readResearchMission(MISSION_ID).nodes.find((n) => n.id === BRADY)
    assert.equal(node.canonicalFacts.length, 2)
    const yardsFact = node.canonicalFacts.find((f) => f.fieldName === 'yards')
    assert.equal(yardsFact.value, 2843)
    assert.equal(yardsFact.temporalScope, '2001-regular-season')
  })

  await t.test('7. indexing into the research library, then a fresh lookup: CACHE_HIT this time', async () => {
    const mission = readResearchMission(MISSION_ID)
    const yardsFact = mission.nodes.find((n) => n.id === BRADY).canonicalFacts.find((f) => f.fieldName === 'yards')
    await withResearchLibrary((current) => indexCanonicalFact(current, mission, BRADY, yardsFact.id, clock, current.revision))
    const library = readResearchLibrary()
    const evaluation = evaluateResearchLibraryReuse(library, { sourcePolicy, entityId: 'nfl:2001:qb:tom-brady', fieldName: 'yards', requiredTemporalScope: '2001-regular-season', valueType: 'number' })
    assert.equal(evaluation.decision, 'CACHE_HIT')
    assert.equal(evaluation.hit.value, 2843)
  })

  let workerRunRefForCrashedAttempt
  await t.test('8. SIMULATED PROCESS RESTART: a dispatch attempt persisted but never resolved, then genuinely resumed', async () => {
    const mission = readResearchMission(MISSION_ID)
    const req = buildBoundedResearchRequest(mission, mission.nodes.find((n) => n.id === WARNER), 'FAKE_A', clock)
    script.set(req.taskFingerprint, { proposedClaims: [{ fieldName: 'yards', proposedValue: 4830, temporalScope: '2001-regular-season', providerConfidence: 0.9, providerReasoning: 'r' }], evidence: [] })
    // "Crash": the attempt is durably recorded, but the process dies before
    // the real network call ever resolves.
    await withResearchMission(MISSION_ID, (m) => recordDispatchAttempt(m, WARNER, { taskFingerprint: req.taskFingerprint }, clock, m.revision))
    const crashedNode = readResearchMission(MISSION_ID).nodes.find((n) => n.id === WARNER)
    const classification = classifyDispatchDeliveryGuarantee(crashedNode, req.taskFingerprint)
    assert.equal(classification.guarantee, 'AMBIGUOUS_REQUIRES_RECONCILIATION')
    // "RESTART": dispatchResearchNodeDurable is called fresh, exactly as a
    // real resumed process would -- it must refuse to blindly redispatch.
    const resumeAttempt = await dispatchResearchNodeDurable(MISSION_ID, WARNER, 'FAKE_A', worker, clock)
    assert.equal(resumeAttempt.ok, false)
    assert.equal(resumeAttempt.ambiguous, true)
    // An operator checks the provider's own dashboard (out of band) and
    // confirms it never received the call -- resolves the ambiguity
    // explicitly, THEN a real redispatch is safe.
    await withResearchMission(MISSION_ID, (m) => resolveDispatchAttempt(m, WARNER, { taskFingerprint: req.taskFingerprint, outcome: 'FAILED_CLEAN' }, clock, m.revision))
    const dispatched = await dispatchResearchNodeDurable(MISSION_ID, WARNER, 'FAKE_A', worker, clock)
    assert.equal(dispatched.ok, true)
    workerRunRefForCrashedAttempt = dispatched.workerRunRef
    const polled = await pollAndAdmitResearchNodeDurable(MISSION_ID, WARNER, worker, clock)
    assert.equal(polled.ok, true)
  })

  await t.test('9. a genuine conflict on the second entity is escalated to Needs You, then resolved by a human decision', async () => {
    const mission = readResearchMission(MISSION_ID)
    const req = buildBoundedResearchRequest(mission, mission.nodes.find((n) => n.id === WARNER), 'FAKE_C', clock)
    script.set(req.taskFingerprint, { provider: 'FAKE_C', proposedClaims: [{ fieldName: 'yards', proposedValue: 4900, temporalScope: '2001-regular-season', providerConfidence: 0.6, providerReasoning: 'a disagreeing secondary source' }], evidence: [] })
    const dispatched = await dispatchResearchNodeDurable(MISSION_ID, WARNER, 'FAKE_C', worker, clock)
    assert.equal(dispatched.ok, true)
    const polled = await pollAndAdmitResearchNodeDurable(MISSION_ID, WARNER, worker, clock)
    assert.equal(polled.ok, true)

    const result = await verifyAndReconcileResearchNodeFieldDurable(MISSION_ID, WARNER, 'yards', 'E2E_TEST', clock)
    assert.equal(result.escalated, true, 'two genuinely disagreeing claims must never be auto-resolved')
    assert.equal(readResearchMissionStatus(MISSION_ID).state, 'NEEDS_YOU')
    const openItem = readResearchMissionReviewItems(MISSION_ID).find((i) => i.nodeId === WARNER)
    assert.ok(openItem)

    // A human resolves it (out of band -- e.g. checked the primary
    // official source directly) and the mission returns to ACTIVE.
    let resolved = await withResearchMission(MISSION_ID, (m) => resolveResearchNeedsYou(m, openItem.id, 'RESOLVED_BY_OPERATOR_VIA_PRIMARY_SOURCE', clock, m.revision))
    assert.equal(resolved.state, 'ACTIVE')

    // Resolving the Needs You is a human decision LOG, not itself a
    // reconciliation -- the real Conflict record is still OPEN until an
    // actual, explicit RESOLVE_CONFLICT decision is made. Completes the
    // real arc: a human picks the higher-confidence, primary-sourced claim.
    const warnerNode = resolved.nodes.find((n) => n.id === WARNER)
    const conflict = warnerNode.conflicts.find((c) => c.fieldName === 'yards' && c.status === 'OPEN')
    assert.ok(conflict, 'the conflict itself remains open until a real reconciliation decision, not silently closed by resolving the Needs You alone')
    const winningClaim = warnerNode.claims.find((c) => c.id === conflict.conflictingClaimIds[0] && c.proposedValue === 4830)
      ?? warnerNode.claims.find((c) => conflict.conflictingClaimIds.includes(c.id) && c.proposedValue === 4830)
    resolved = await withResearchMission(MISSION_ID, (m) =>
      decideReconciliation(
        m,
        WARNER,
        { fieldName: 'yards', decisionType: 'RESOLVE_CONFLICT', conflictId: conflict.id, selectedClaimId: winningClaim.id, consideredClaimIds: conflict.conflictingClaimIds, decidedValue: 4830, temporalScope: '2001-regular-season', rationale: 'operator confirmed 4830 against the primary official league source after human review', decidedBy: 'E2E_TEST_OPERATOR' },
        clock,
        m.revision
      )
    )
    const decisionId = resolved.nodes.find((n) => n.id === WARNER).reconciliationDecisions.at(-1).id
    resolved = await withResearchMission(MISSION_ID, (m) => admitReconciliationDecision(m, WARNER, decisionId, clock, m.revision))
    const finalWarnerNode = resolved.nodes.find((n) => n.id === WARNER)
    assert.equal(finalWarnerNode.conflicts.find((c) => c.id === conflict.id).status, 'RECONCILED')
    assert.equal(finalWarnerNode.canonicalFacts.find((f) => f.fieldName === 'yards').value, 4830)
  })

  await t.test('10. CANCEL: an unrelated pending node can still be safely cancelled through the real path', async () => {
    await withResearchMission(MISSION_ID, (m) => addResearchNode(m, { id: 'node:extra', nodeRole: 'PRIMARY_RESEARCH', requestedFields: [], requestedOutputSchema: {} }, clock))
    const cancelled = await cancelResearchNodeDurable(MISSION_ID, 'node:extra', clock)
    assert.equal(cancelled.nodes.find((n) => n.id === 'node:extra').status, 'CANCELLED')
  })

  await t.test('11. completeness reflects the real, durable state -- not a fabricated ratio', () => {
    const completeness = readResearchMissionCompleteness(MISSION_ID, clock)
    assert.equal(completeness.schemaVersion, 'TSF_COMPLETENESS_METRICS_V1')
    assert.ok(completeness.fieldCoverage > 0 && completeness.fieldCoverage <= 1)
    assert.equal(completeness.unresolvedConflictCount, 0, 'the conflict was resolved via reconciliation-adjacent Needs You, not left dangling')
  })

  await t.test('12. the artifact package assembles from the real, integrity-checked durable mission', () => {
    const artifacts = readResearchMissionArtifacts(MISSION_ID, clock)
    assert.ok(artifacts.packageBody)
    const bradyNode = artifacts.packageBody.nodes.find((n) => n.id === BRADY)
    assert.equal(bradyNode.canonicalFacts.length, 2)
    // Re-running assembly against the same durable state is byte-identical
    // (a pure, stateless projection -- safe to rerun after any crash).
    const artifactsAgain = readResearchMissionArtifacts(MISSION_ID, clock)
    assert.equal(artifacts.packageBody.contentHash, artifactsAgain.packageBody.contentHash)
  })

  void workerRunRefForCrashedAttempt
 } finally {
  cleanupStateFile()
 }
})

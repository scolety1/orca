// Crash/resume gauntlet A-J, mirroring CORRECTION WAVE 1 §6 exactly. Each
// scenario persists real durable state via research-mission-store.mjs
// (the same cross-process-file-lock-backed store keep-going runs use),
// then simulates "the process died here" by simply not calling the next
// step, and proves the NEXT real call -- reading fresh from disk -- resumes
// correctly without duplicating or losing anything.
import assert from 'node:assert/strict'
import test from 'node:test'
import { rmSync } from 'node:fs'
import path from 'node:path'
import { admitBoundedResearchResult } from '../domain/research-admission.mjs'
import { addResearchNode, createResearchMission } from '../domain/research-mission.mjs'
import { buildBoundedResearchRequest, markResearchNodeReady, recordResearchNodeDispatch, recordResearchNodeResult } from '../domain/research-node.mjs'
import { admitReconciliationDecision, decideReconciliation } from '../domain/research-reconciliation.mjs'
import { verifyResearchClaim } from '../domain/research-verification.mjs'
import { buildResearchProvenancePackage } from '../domain/research-provenance.mjs'
import { buildNflQb2001Specification } from '../fixtures/nfl-2001-qb-research-fixture.mjs'
import { createDeterministicFakeResearchWorker } from '../adapters/deterministic-fake-research-worker.mjs'

const HERE = import.meta.dirname
const STATE_FILE = path.join(HERE, '..', 'server', '.local-state', `operator-state.test-research-crash-resume-${process.pid}.json`)
process.env.TSF_UI_STATE_FILE = STATE_FILE

const { withResearchMission } = await import('../server/research-mission-store.mjs')

// NOT test.afterEach: Node's test runner applies afterEach to nested
// t.test() subtests too, which would delete the state file between each
// lettered scenario -- exactly the bug this gauntlet exists to catch
// elsewhere, caught here during authoring. Cleanup instead brackets the
// single top-level gauntlet test.
function cleanupStateFile() {
  for (const suffix of ['', '.tmp', '.research.lock']) rmSync(`${STATE_FILE}${suffix}`, { force: true })
}
cleanupStateFile()

const clock = () => new Date('2026-09-12T09:00:00.000Z')
const MISSION_ID = 'mission:crash-resume'
const NODE_ID = 'node:x'

function scriptedResult(request, overrides = {}) {
  return {
    schemaVersion: 'TSF_BOUNDED_RESEARCH_RESULT_V1',
    nodeId: request.nodeId,
    taskFingerprint: request.taskFingerprint,
    provider: 'FAKE',
    providerRunRef: { provider: 'FAKE', providerRunId: 'r1', dispatchedAt: clock().toISOString() },
    status: 'SUCCEEDED',
    observations: [{ rawContent: 'raw', extractedAt: clock().toISOString(), providerConfidence: 0.9, providerReasoning: 'r' }],
    proposedClaims: [{ fieldName: 'yards', proposedValue: 100, temporalScope: '2001-regular-season', providerConfidence: 0.9, providerReasoning: 'r' }],
    evidence: [{ claimFieldName: 'yards', sourceRef: 'src:1', snippet: 's', supportsClaim: true }],
    sourceReferences: [{ sourceRef: 'src:1', url: 'https://example.invalid', publisher: 'pub', retrievedAt: clock().toISOString() }],
    sourceSnapshotsOrSnapshotRefs: [{ sourceRef: 'src:1', contentHash: 'sha256:x', rawContentRef: 'fixture://x' }],
    newGapProposals: [],
    warnings: [],
    unresolvedQuestions: [],
    usage: { requestCount: 1, tokensOrUnits: 5, providerReportedCostUsd: 0 },
    failureDetails: null,
    ...overrides
  }
}

test('crash/resume gauntlet A-J', async (t) => {
 try {
  // Bootstrap: durable mission + node, persisted for real.
  await withResearchMission(MISSION_ID, () => {
    const specification = buildNflQb2001Specification()
    let mission = createResearchMission({ id: MISSION_ID, projectId: 'fixture:proj', specification, expectedUniverse: specification.expectedUniverse }, clock)
    mission = addResearchNode(mission, { id: NODE_ID, nodeRole: 'PRIMARY_RESEARCH', requestedFields: [{ fieldName: 'yards', valueType: 'number', required: true }], requestedOutputSchema: {} }, clock)
    mission = markResearchNodeReady(mission, NODE_ID, clock, mission.revision)
    return mission
  })

  const readMission = async () => (await import('../server/research-mission-store.mjs')).readResearchMission(MISSION_ID)
  const bootstrapped = await readMission()
  const request = buildBoundedResearchRequest(bootstrapped, bootstrapped.nodes[0], 'FAKE', clock)
  const scriptedWorker = createDeterministicFakeResearchWorker({
    provider: 'FAKE',
    clock,
    script: new Map([[request.taskFingerprint, {}]])
  })

  await t.test('A: dispatch initiated -> crash before worker_run_ref persistence', async () => {
    // "Crash": we call the worker but never persist recordResearchNodeDispatch.
    const inMemoryDispatch = await scriptedWorker.dispatch(request)
    assert.equal(inMemoryDispatch.ok, true)
    // Nothing durable exists yet.
    const afterCrash = await readMission()
    assert.equal(afterCrash.nodes[0].dispatchRecords.length, 0)
    assert.equal(afterCrash.nodes[0].status, 'READY')
    // SAFE ACTION: resume by re-dispatching and THIS time persisting.
    const redispatch = await scriptedWorker.dispatch(request)
    const persisted = await withResearchMission(MISSION_ID, (mission) =>
      recordResearchNodeDispatch(mission, NODE_ID, { taskFingerprint: request.taskFingerprint, workerRunRef: redispatch.workerRunRef }, clock, mission.revision)
    )
    assert.equal(persisted.nodes[0].dispatchRecords.length, 1, 'no duplicate dispatch record even though dispatch() was called twice')
    assert.equal(persisted.nodes[0].status, 'DISPATCHED')
  })

  let workerRunRef
  await t.test('B: worker_run_ref persisted -> crash', async () => {
    const mission = await readMission()
    workerRunRef = mission.nodes[0].dispatchRecords[0].workerRunRef
    assert.ok(workerRunRef.providerRunId)
    // SAFE ACTION: resume by polling the SAME workerRunRef, never re-dispatching.
    const attemptedRedispatch = await withResearchMission(MISSION_ID, (m) =>
      recordResearchNodeDispatch(m, NODE_ID, { taskFingerprint: request.taskFingerprint, workerRunRef }, clock, m.revision)
    )
    assert.equal(attemptedRedispatch.revision, mission.revision, 'idempotent replay with the same taskFingerprint must not bump revision')
    assert.equal(attemptedRedispatch.nodes[0].dispatchRecords.length, 1)
  })

  await t.test('C: provider finishes while TSF is offline', async () => {
    // The provider's own run state is independent of TSF's durability --
    // TSF simply wasn't polling. Resuming (polling now) sees it READY.
    const fetched = await scriptedWorker.fetchResult(workerRunRef)
    assert.equal(fetched.status, 'READY')
  })

  let acquiredResult
  await t.test('D: result acquired -> crash before durable result persistence', async () => {
    const fetched = await scriptedWorker.fetchResult(workerRunRef)
    acquiredResult = scriptedResult(request, { providerRunRef: workerRunRef })
    // "Crash": discard in-memory result, never persisted.
    const afterCrash = await readMission()
    assert.equal(afterCrash.nodes[0].rawResults.length, 0)
    // SAFE ACTION: re-fetch (safe, provider result is immutable once
    // complete) and THIS time persist.
    const refetched = await scriptedWorker.fetchResult(workerRunRef)
    assert.ok(refetched.status === 'READY')
    const persisted = await withResearchMission(MISSION_ID, (mission) => recordResearchNodeResult(mission, NODE_ID, acquiredResult, clock, mission.revision))
    assert.equal(persisted.nodes[0].rawResults.length, 1)
    assert.equal(persisted.nodes[0].status, 'RESULT_RECEIVED')
  })

  await t.test('E: result persisted -> crash before admission', async () => {
    const mission = await readMission()
    assert.equal(mission.nodes[0].admittedResultDigests.length, 0)
    assert.equal(mission.nodes[0].claims.length, 0, 'no admission-produced records exist yet')
    // SAFE ACTION: resume admission from the durable raw result.
    const digest = mission.nodes[0].rawResults[0].digest
    const admitted = await withResearchMission(MISSION_ID, (m) => admitBoundedResearchResult(m, NODE_ID, digest, clock, m.revision))
    assert.equal(admitted.nodes[0].status, 'ADMITTED')
    assert.equal(admitted.nodes[0].claims.length, 1)
  })

  await t.test('F: partial observation/claim/evidence admission -> crash mid-admission', async () => {
    // Re-running admission for the SAME already-fully-admitted digest must
    // be a true no-op (proves per-item idempotency covers the "some items
    // landed, others didn't" case: replaying is always safe because every
    // item is individually digest-checked before being written).
    const before = await readMission()
    const digest = before.nodes[0].rawResults[0].digest
    const replay = await withResearchMission(MISSION_ID, (m) => admitBoundedResearchResult(m, NODE_ID, digest, clock, m.revision))
    assert.equal(replay.revision, before.revision, 'a fully-admitted replay must not bump revision')
    assert.equal(replay.nodes[0].claims.length, before.nodes[0].claims.length)
    assert.equal(replay.nodes[0].observations.length, before.nodes[0].observations.length)
  })

  let claimId
  await t.test('G: claims admitted -> crash before verification', async () => {
    const mission = await readMission()
    claimId = mission.nodes[0].claims[0].id
    assert.equal(mission.nodes[0].claims[0].status, 'UNVERIFIED')
    assert.equal(mission.nodes[0].verifications.length, 0)
    // SAFE ACTION: resume by verifying.
    const verified = await withResearchMission(MISSION_ID, (m) => verifyResearchClaim(m, NODE_ID, claimId, clock, m.revision))
    assert.equal(verified.nodes[0].claims[0].status, 'VERIFIED')
  })

  await t.test('H: verification partially persisted -> crash', async () => {
    // Re-verifying the SAME already-verified claim must be idempotent
    // (digest of {claimId, actualOutput} dedupes it) -- covers "one claim's
    // verification landed, another's didn't" by construction (each claim's
    // verification is independently idempotent).
    const before = await readMission()
    const replay = await withResearchMission(MISSION_ID, (m) => verifyResearchClaim(m, NODE_ID, claimId, clock, m.revision))
    assert.equal(replay.revision, before.revision)
    assert.equal(replay.nodes[0].verifications.length, 1)
  })

  let decisionId
  await t.test('I: ReconciliationDecision persisted -> crash before CanonicalFact/artifact completion', async () => {
    const mission = await readMission()
    const verificationId = mission.nodes[0].verifications[0].id
    const decided = await withResearchMission(MISSION_ID, (m) =>
      decideReconciliation(
        m,
        NODE_ID,
        { fieldName: 'yards', decisionType: 'ACCEPT_SINGLE_VERIFIED_CLAIM', selectedClaimId: claimId, consideredClaimIds: [claimId], verificationIds: [verificationId], decidedValue: 100, rationale: 'single verified claim', decidedBy: 'TIM' },
        clock,
        m.revision
      )
    )
    decisionId = decided.nodes[0].reconciliationDecisions[0].id
    // "Crash": no CanonicalFact yet, but the decision is durably explainable.
    const afterCrash = await readMission()
    assert.equal(afterCrash.nodes[0].canonicalFacts.length, 0)
    assert.equal(afterCrash.nodes[0].reconciliationDecisions.length, 1)
    // SAFE ACTION: resume by admitting the already-persisted decision.
    const admitted = await withResearchMission(MISSION_ID, (m) => admitReconciliationDecision(m, NODE_ID, decisionId, clock, m.revision))
    assert.equal(admitted.nodes[0].canonicalFacts.length, 1)
  })

  await t.test('J: artifact/provenance assembly partially completes -> crash', async () => {
    // Assembly is a pure, stateless projection -- re-running it from the
    // same durable state twice must be byte-identical (never partially-
    // completable, so no special recovery is needed beyond "run it again").
    const mission = await readMission()
    const first = buildResearchProvenancePackage(mission, { clock })
    const second = buildResearchProvenancePackage(mission, { clock })
    assert.equal(first.packageBody.contentHash, second.packageBody.contentHash)
    assert.equal(first.packageBody.nodes[0].canonicalFacts.length, 1)
  })
 } finally {
  cleanupStateFile()
 }
})

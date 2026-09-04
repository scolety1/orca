// Durable persistence for the cross-mission research library, mirroring
// research-crash-resume.test.mjs's isolated-state-file pattern: real
// cross-process-file-lock-backed writes, own STATE_FILE so this never
// collides with a concurrent test run or a real running dev server.
import assert from 'node:assert/strict'
import test from 'node:test'
import { rmSync } from 'node:fs'
import path from 'node:path'
import { admitBoundedResearchResult } from '../domain/research-admission.mjs'
import { addResearchNode, createResearchMission } from '../domain/research-mission.mjs'
import { buildBoundedResearchRequest, markResearchNodeReady, recordResearchNodeDispatch, recordResearchNodeResult } from '../domain/research-node.mjs'
import { admitReconciliationDecision, decideReconciliation } from '../domain/research-reconciliation.mjs'
import { createResearchLibrary, indexCanonicalFact, queryResearchLibrary } from '../domain/research-library.mjs'
import { buildNflQb2001Specification } from '../fixtures/nfl-2001-qb-research-fixture.mjs'

const HERE = import.meta.dirname
const STATE_FILE = path.join(HERE, '..', 'server', '.local-state', `operator-state.test-research-library-store-${process.pid}.json`)
process.env.TSF_UI_STATE_FILE = STATE_FILE

const { readResearchLibrary, withResearchLibrary } = await import('../server/research-library-store.mjs')

function cleanupStateFile() {
  for (const suffix of ['', '.tmp', '.research-library.lock']) rmSync(`${STATE_FILE}${suffix}`, { force: true })
}
cleanupStateFile()

const clock = () => new Date('2026-10-12T09:00:00.000Z')

function missionWithCanonicalFact() {
  const specification = buildNflQb2001Specification()
  let mission = createResearchMission({ id: 'mission:store-test', projectId: 'fixture:proj', specification, expectedUniverse: specification.expectedUniverse }, clock)
  mission = addResearchNode(
    mission,
    { id: 'node:x', nodeRole: 'PRIMARY_RESEARCH', targetEntity: { entityId: 'nfl:2001:qb:tom-brady' }, requestedFields: [{ fieldName: 'yards', valueType: 'number', required: true }], requestedOutputSchema: { type: 'object' } },
    clock
  )
  const request = buildBoundedResearchRequest(mission, mission.nodes[0], 'FAKE', clock)
  mission = markResearchNodeReady(mission, 'node:x', clock, mission.revision)
  const workerRunRef = { provider: 'FAKE', providerRunId: 'r1', dispatchedAt: clock().toISOString() }
  mission = recordResearchNodeDispatch(mission, 'node:x', { taskFingerprint: request.taskFingerprint, workerRunRef }, clock, mission.revision)
  mission = recordResearchNodeResult(
    mission,
    'node:x',
    {
      schemaVersion: 'TSF_BOUNDED_RESEARCH_RESULT_V1',
      nodeId: 'node:x',
      taskFingerprint: request.taskFingerprint,
      provider: 'FAKE',
      providerRunRef: workerRunRef,
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
      failureDetails: null
    },
    clock,
    mission.revision
  )
  const digest = mission.nodes[0].rawResults.at(-1).digest
  mission = admitBoundedResearchResult(mission, 'node:x', digest, clock, mission.revision)
  mission = decideReconciliation(mission, 'node:x', { fieldName: 'yards', decisionType: 'ACCEPT_DERIVED_VALUE', decidedValue: 100, temporalScope: '2001-regular-season', rationale: 'test setup', decidedBy: 'TEST' }, clock, mission.revision)
  const decisionId = mission.nodes[0].reconciliationDecisions.at(-1).id
  mission = admitReconciliationDecision(mission, 'node:x', decisionId, clock, mission.revision)
  return { mission, canonicalFactId: mission.nodes[0].canonicalFacts[0].id }
}

test('research library persistence: real disk round-trip, first-use creation, idempotent re-index, revision-guarded concurrency', async (t) => {
 try {
  await t.test('readResearchLibrary returns null before first use', () => {
    assert.equal(readResearchLibrary(), null)
  })

  await t.test('withResearchLibrary constructs and persists the library on first use', async () => {
    const persisted = await withResearchLibrary((current) => current ?? createResearchLibrary(clock))
    assert.equal(persisted.revision, 0)
    assert.deepEqual(readResearchLibrary().entries, [])
  })

  const { mission, canonicalFactId } = missionWithCanonicalFact()

  await t.test('indexing a real canonical fact persists durably and survives a fresh read', async () => {
    await withResearchLibrary((current) => indexCanonicalFact(current, mission, 'node:x', canonicalFactId, clock, current.revision))
    const reloaded = readResearchLibrary()
    assert.equal(reloaded.entries.length, 1)
    assert.equal(reloaded.revision, 1)
    const hits = queryResearchLibrary(reloaded, { entityId: 'nfl:2001:qb:tom-brady', fieldName: 'yards' })
    assert.equal(hits.length, 1)
    assert.equal(hits[0].value, 100)
  })

  await t.test('re-indexing the SAME canonical fact after a simulated crash (fresh read, then replay) is a true no-op', async () => {
    const before = readResearchLibrary()
    const replayed = await withResearchLibrary((current) => indexCanonicalFact(current, mission, 'node:x', canonicalFactId, clock, current.revision))
    assert.equal(replayed.revision, before.revision, 'a genuine replay of an already-indexed fact must not bump revision')
    assert.equal(replayed.entries.length, 1)
  })

  await t.test('a stale expectedRevision against the real persisted library is refused, not silently applied', async () => {
    const current = readResearchLibrary()
    await assert.rejects(
      withResearchLibrary(() => indexCanonicalFact(current, mission, 'node:x', canonicalFactId, clock, current.revision - 1)),
      /stale revision/
    )
  })
 } finally {
  cleanupStateFile()
 }
})

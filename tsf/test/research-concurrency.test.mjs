// §7 concurrency/expectedRevision probe. No new synchronization mechanism
// is introduced -- this exercises TSF's existing optimistic-concurrency
// primitive (assertExpectedRevision + research-mission-store.mjs's
// cross-process file lock, the same primitive keep-going-run-store.mjs
// already relies on) against multiple research nodes of the SAME mission
// completing in different orders.
import assert from 'node:assert/strict'
import test from 'node:test'
import { rmSync } from 'node:fs'
import path from 'node:path'
import { admitBoundedResearchResult } from '../domain/research-admission.mjs'
import { addResearchNode, checkpointResearchMission, createResearchMission } from '../domain/research-mission.mjs'
import { buildBoundedResearchRequest, markResearchNodeReady, recordResearchNodeDispatch, recordResearchNodeResult } from '../domain/research-node.mjs'
import { buildNflQb2001Specification } from '../fixtures/nfl-2001-qb-research-fixture.mjs'

const HERE = import.meta.dirname
const STATE_FILE = path.join(HERE, '..', 'server', '.local-state', `operator-state.test-research-concurrency-${process.pid}.json`)
process.env.TSF_UI_STATE_FILE = STATE_FILE

const { withResearchMission, readResearchMission } = await import('../server/research-mission-store.mjs')

function cleanupStateFile() {
  for (const suffix of ['', '.tmp', '.research.lock']) rmSync(`${STATE_FILE}${suffix}`, { force: true })
}

const clock = () => new Date('2026-09-13T10:00:00.000Z')

async function bootstrapMission(missionId, nodeCount) {
  cleanupStateFile()
  return withResearchMission(missionId, () => {
    const specification = buildNflQb2001Specification()
    let mission = createResearchMission({ id: missionId, projectId: 'fixture:proj', specification, expectedUniverse: specification.expectedUniverse }, clock)
    for (let i = 0; i < nodeCount; i += 1) {
      const id = `node:${i}`
      mission = addResearchNode(mission, { id, nodeRole: 'PRIMARY_RESEARCH', requestedFields: [{ fieldName: 'yards', valueType: 'number', required: true }], requestedOutputSchema: {} }, clock)
      mission = markResearchNodeReady(mission, id, clock, mission.revision)
    }
    return mission
  })
}

// Gets each node to RESULT_RECEIVED (dispatched + result durably stored,
// not yet admitted) so the concurrency probe below tests exactly the
// contended step: many nodes' results admitting against the same mission
// revision at once.
async function prepareResultsAwaitingAdmission(missionId, nodeIds) {
  const mission = readResearchMission(missionId)
  const digestByNode = {}
  for (const nodeId of nodeIds) {
    const node = mission.nodes.find((n) => n.id === nodeId)
    const request = buildBoundedResearchRequest(mission, node, 'FAKE', clock)
    const result = {
      schemaVersion: 'TSF_BOUNDED_RESEARCH_RESULT_V1',
      nodeId,
      taskFingerprint: request.taskFingerprint,
      provider: 'FAKE',
      providerRunRef: { provider: 'FAKE', providerRunId: `run-${nodeId}`, dispatchedAt: clock().toISOString() },
      status: 'SUCCEEDED',
      observations: [],
      proposedClaims: [{ fieldName: 'yards', proposedValue: nodeId.length, providerConfidence: 0.9, providerReasoning: 'r' }],
      evidence: [],
      sourceReferences: [],
      sourceSnapshotsOrSnapshotRefs: [],
      newGapProposals: [],
      warnings: [],
      unresolvedQuestions: [],
      usage: { requestCount: 1, tokensOrUnits: 1, providerReportedCostUsd: 0 },
      failureDetails: null
    }
    await withResearchMission(missionId, (m) => recordResearchNodeDispatch(m, nodeId, { taskFingerprint: request.taskFingerprint, workerRunRef: result.providerRunRef }, clock, m.revision))
    const withResult = await withResearchMission(missionId, (m) => recordResearchNodeResult(m, nodeId, result, clock, m.revision))
    digestByNode[nodeId] = withResult.nodes.find((n) => n.id === nodeId).rawResults.at(-1).digest
  }
  return digestByNode
}

test('2 concurrent completions against the same mission: no lost updates', async () => {
  const missionId = 'mission:concurrency-2'
  await bootstrapMission(missionId, 2)
  const nodeIds = ['node:0', 'node:1']
  const digests = await prepareResultsAwaitingAdmission(missionId, nodeIds)
  // Each admission reads m.revision freshly INSIDE the lock -- this is the
  // correct pattern (never a revision captured before the race started).
  await Promise.all(
    nodeIds.map((nodeId) => withResearchMission(missionId, (m) => admitBoundedResearchResult(m, nodeId, digests[nodeId], clock, m.revision)))
  )
  const final = readResearchMission(missionId)
  for (const nodeId of nodeIds) {
    const node = final.nodes.find((n) => n.id === nodeId)
    assert.equal(node.status, 'ADMITTED', `${nodeId} must be admitted, not lost to a concurrent overwrite`)
    assert.equal(node.claims.length, 1)
  }
  cleanupStateFile()
})

test('5 concurrent completions against the same mission: no lost updates', async () => {
  const missionId = 'mission:concurrency-5'
  await bootstrapMission(missionId, 5)
  const nodeIds = ['node:0', 'node:1', 'node:2', 'node:3', 'node:4']
  const digests = await prepareResultsAwaitingAdmission(missionId, nodeIds)
  await Promise.all(
    nodeIds.map((nodeId) => withResearchMission(missionId, (m) => admitBoundedResearchResult(m, nodeId, digests[nodeId], clock, m.revision)))
  )
  const final = readResearchMission(missionId)
  assert.equal(final.nodes.filter((n) => n.status === 'ADMITTED').length, 5, 'all 5 concurrent completions must land')
  cleanupStateFile()
})

test('completion-order permutation does not affect the final canonical set of admitted claims', async () => {
  const orders = [
    ['node:0', 'node:1', 'node:2'],
    ['node:2', 'node:0', 'node:1'],
    ['node:1', 'node:2', 'node:0']
  ]
  const finalClaimSets = []
  for (const [i, order] of orders.entries()) {
    const missionId = `mission:permutation-${i}`
    await bootstrapMission(missionId, 3)
    const digests = await prepareResultsAwaitingAdmission(missionId, order)
    for (const nodeId of order) {
      await withResearchMission(missionId, (m) => admitBoundedResearchResult(m, nodeId, digests[nodeId], clock, m.revision))
    }
    const final = readResearchMission(missionId)
    finalClaimSets.push(
      final.nodes
        .flatMap((n) => n.claims.map((c) => `${n.id}:${c.fieldName}=${c.proposedValue}`))
        .sort()
    )
    cleanupStateFile()
  }
  assert.deepEqual(finalClaimSets[0], finalClaimSets[1])
  assert.deepEqual(finalClaimSets[0], finalClaimSets[2])
})

test('a genuinely stale captured revision is rejected -- TSF_STALE_REVISION, not a silent overwrite', async () => {
  const missionId = 'mission:stale-revision'
  await bootstrapMission(missionId, 1)
  const staleRevisionCapturedBeforeTheRace = readResearchMission(missionId).revision
  // A real mutation lands first, bumping the revision (checkpointResearchMission
  // always appends, never a no-op, unlike an idempotent node transition).
  await withResearchMission(missionId, (m) => checkpointResearchMission(m, { phase: 'FIRST_WRITER' }, clock, m.revision))
  // A second caller wrongly reuses the STALE revision it captured before
  // the race (an anti-pattern -- the correct pattern always reads m.revision
  // fresh inside the lock, as every other test in this file does) instead
  // of the fresh one -- must be rejected, never silently applied.
  await assert.rejects(
    withResearchMission(missionId, (m) => checkpointResearchMission(m, { phase: 'STALE_WRITER' }, clock, staleRevisionCapturedBeforeTheRace)),
    /stale revision/
  )
  assert.equal(readResearchMission(missionId).checkpoints.length, 1, 'the stale write must never have landed')
  cleanupStateFile()
})

test('retry after a revision conflict succeeds by re-reading fresh state', async () => {
  const missionId = 'mission:retry-after-conflict'
  await bootstrapMission(missionId, 1)
  const staleRevision = readResearchMission(missionId).revision
  await withResearchMission(missionId, (m) => checkpointResearchMission(m, { phase: 'FIRST_WRITER' }, clock, m.revision))
  let result
  try {
    result = await withResearchMission(missionId, (m) => checkpointResearchMission(m, { phase: 'RETRY_WRITER' }, clock, staleRevision))
    assert.fail('expected a stale-revision rejection before the retry')
  } catch (error) {
    assert.equal(error.code, 'TSF_STALE_REVISION')
    // SAFE ACTION: re-read fresh (m.revision, inside the lock) and retry --
    // succeeds, and both checkpoints are present (nothing was lost).
    result = await withResearchMission(missionId, (m) => checkpointResearchMission(m, { phase: 'RETRY_WRITER' }, clock, m.revision))
  }
  assert.equal(result.checkpoints.length, 2)
  assert.deepEqual(result.checkpoints.map((c) => c.phase), ['FIRST_WRITER', 'RETRY_WRITER'])
  cleanupStateFile()
})

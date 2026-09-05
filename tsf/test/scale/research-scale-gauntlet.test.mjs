// Trust + Scale Hardening Phase 13: scale gauntlet. Proves the domain
// layer stays CORRECT (not just fast) at 100 and 1000 synthetic nodes in a
// single mission -- no duplicate/lost records, no revision corruption, the
// same epistemic-ladder invariants that hold at N=1 still hold at N=1000.
// ZERO external spend: every dispatch goes through
// deterministic-fake-research-worker.mjs (adapters/), never a real
// provider -- this is a pure in-process domain/perf proof, not a live
// bake-off. Runs entirely in memory (no disk/file-lock I/O) -- durable
// persistence at scale is a separate, already-covered concern
// (research-crash-resume.test.mjs / research-library-store.test.mjs prove
// the store's correctness; this proves the domain layer's).
//
// Lives in test/scale/ (matched by `npm run test:scale`, NOT the default
// `npm test` glob `test/*.test.mjs`) because the 1000-node case genuinely
// takes ~2 minutes -- see the real O(n^2) finding documented below. This
// mirrors the existing codebase convention of keeping expensive/one-off
// runs out of the fast default suite (the tsf/ root's live-provider demo
// scripts are excluded from `npm test` the same way, structurally).
import assert from 'node:assert/strict'
import test from 'node:test'
import { admitBoundedResearchResult } from '../../domain/research-admission.mjs'
import { addResearchNode, createResearchMission } from '../../domain/research-mission.mjs'
import { buildBoundedResearchRequest, markResearchNodeReady, recordResearchNodeDispatch, recordResearchNodeResult } from '../../domain/research-node.mjs'
import { admitReconciliationDecision, decideReconciliation } from '../../domain/research-reconciliation.mjs'
import { detectResearchConflicts, verifyResearchClaim } from '../../domain/research-verification.mjs'
import { buildNflQb2001Specification } from '../../fixtures/nfl-2001-qb-research-fixture.mjs'
import { createDeterministicFakeResearchWorker } from '../../adapters/deterministic-fake-research-worker.mjs'

const clock = () => new Date('2026-10-20T09:00:00.000Z')

function buildScaleMission(nodeCount) {
  const specification = buildNflQb2001Specification()
  let mission = createResearchMission({ id: 'mission:scale', projectId: 'fixture:proj', specification, expectedUniverse: specification.expectedUniverse }, clock)
  for (let i = 0; i < nodeCount; i += 1) {
    mission = addResearchNode(
      mission,
      {
        id: `node:${i}`,
        nodeRole: 'PRIMARY_RESEARCH',
        targetEntity: { entityId: `synthetic:entity:${i}`, name: `Entity ${i}` },
        requestedFields: [{ fieldName: 'value', valueType: 'number', required: true }],
        requestedOutputSchema: { type: 'object' }
      },
      clock
    )
  }
  return mission
}

function scriptEntryFor(taskFingerprint, proposedValue) {
  const tag = taskFingerprint.slice(0, 12)
  return {
    proposedClaims: [{ fieldName: 'value', proposedValue, temporalScope: null, providerConfidence: 0.9, providerReasoning: 'synthetic' }],
    evidence: [{ claimFieldName: 'value', sourceRef: `src:${tag}`, snippet: 's', supportsClaim: true }],
    sourceReferences: [{ sourceRef: `src:${tag}`, url: `https://example.invalid/${tag}`, publisher: 'synthetic', retrievedAt: clock().toISOString() }],
    sourceSnapshotsOrSnapshotRefs: [{ sourceRef: `src:${tag}`, contentHash: `sha256:${tag}`, rawContentRef: null }]
  }
}

// One dispatch/result/admit cycle for one node with a given provider label
// and proposed value -- the same shape the crash/resume gauntlet already
// uses, just parameterized over (nodeId, provider, value) for scale.
async function dispatchOneCycle(mission, nodeId, provider, proposedValue, script, worker) {
  let next = markResearchNodeReady(mission, nodeId, clock, mission.revision)
  const request = buildBoundedResearchRequest(next, next.nodes.find((n) => n.id === nodeId), provider, clock)
  script.set(request.taskFingerprint, { ...scriptEntryFor(request.taskFingerprint, proposedValue), provider })
  const dispatched = await worker.dispatch(request)
  assert.equal(dispatched.ok, true, `dispatch failed for ${nodeId}/${provider}: ${JSON.stringify(dispatched)}`)
  next = recordResearchNodeDispatch(next, nodeId, { taskFingerprint: request.taskFingerprint, workerRunRef: dispatched.workerRunRef }, clock, next.revision)
  const fetched = await worker.fetchResult(dispatched.workerRunRef)
  next = recordResearchNodeResult(next, nodeId, fetched.result, clock, next.revision)
  const digest = next.nodes.find((n) => n.id === nodeId).rawResults.at(-1).digest
  return admitBoundedResearchResult(next, nodeId, digest, clock, next.revision)
}

// Runs one node fully through the ladder: dispatch -> result -> admit ->
// verify -> reconcile -> canonicalize. Every 7th node (i % 7 === 0) is
// scripted with a genuine SECOND, disagreeing claim from a different
// provider, so the scale run also exercises detectResearchConflicts/manual
// RESOLVE_CONFLICT at scale, not just the uncontested happy path.
async function runNodeThroughLadder(mission, i, script, worker) {
  const nodeId = `node:${i}`
  const isConflicted = i % 7 === 0
  let next = await dispatchOneCycle(mission, nodeId, 'FAKE_A', i, script, worker)

  if (isConflicted) {
    next = await dispatchOneCycle(next, nodeId, 'FAKE_B', i + 1000000, script, worker)
    next = detectResearchConflicts(next, nodeId, clock, next.revision)
    const conflict = next.nodes.find((n) => n.id === nodeId).conflicts[0]
    assert.ok(conflict, `node ${nodeId} was scripted to conflict but raised none`)
    const winningClaimId = conflict.conflictingClaimIds[0]
    next = decideReconciliation(
      next,
      nodeId,
      { fieldName: 'value', decisionType: 'RESOLVE_CONFLICT', conflictId: conflict.id, selectedClaimId: winningClaimId, consideredClaimIds: conflict.conflictingClaimIds, decidedValue: i, rationale: 'scale gauntlet: deterministic first-claim resolution', decidedBy: 'SCALE_TEST' },
      clock,
      next.revision
    )
    const decisionId = next.nodes.find((n) => n.id === nodeId).reconciliationDecisions.at(-1).id
    return admitReconciliationDecision(next, nodeId, decisionId, clock, next.revision)
  }

  const claimId = next.nodes.find((n) => n.id === nodeId).claims[0].id
  next = verifyResearchClaim(next, nodeId, claimId, clock, next.revision)
  const verification = next.nodes.find((n) => n.id === nodeId).verifications[0]
  assert.equal(verification.verdict, 'PASS', `node ${nodeId} unexpectedly failed verification`)
  next = decideReconciliation(
    next,
    nodeId,
    { fieldName: 'value', decisionType: 'ACCEPT_SINGLE_VERIFIED_CLAIM', selectedClaimId: claimId, consideredClaimIds: [claimId], verificationIds: [verification.id], decidedValue: i, rationale: 'scale gauntlet: single verified claim', decidedBy: 'SCALE_TEST' },
    clock,
    next.revision
  )
  const decisionId = next.nodes.find((n) => n.id === nodeId).reconciliationDecisions.at(-1).id
  return admitReconciliationDecision(next, nodeId, decisionId, clock, next.revision)
}

async function runScaleGauntlet(nodeCount) {
  let mission = buildScaleMission(nodeCount)
  const script = new Map()
  const worker = createDeterministicFakeResearchWorker({ provider: 'FAKE_A', clock, script })

  const startedAt = Date.now()
  for (let i = 0; i < nodeCount; i += 1) {
    mission = await runNodeThroughLadder(mission, i, script, worker) // eslint-disable-line no-await-in-loop
  }
  const elapsedMs = Date.now() - startedAt

  // Correctness at scale: every node reached exactly one real CanonicalFact
  // with the expected value; no cross-node contamination, no duplicates.
  assert.equal(mission.nodes.length, nodeCount)
  for (let i = 0; i < nodeCount; i += 1) {
    const node = mission.nodes.find((n) => n.id === `node:${i}`)
    assert.equal(node.canonicalFacts.length, 1, `node:${i} must have exactly one CanonicalFact, not ${node.canonicalFacts.length}`)
    assert.equal(node.canonicalFacts[0].value, i, `node:${i}'s canonical value must be its own index, never another node's`)
  }
  assert.equal(new Set(mission.nodes.map((n) => n.id)).size, nodeCount, 'no duplicate/lost node ids')

  return { mission, elapsedMs }
}

test('scale gauntlet: 100 synthetic nodes, zero external spend, full ladder per node', async () => {
  const { elapsedMs } = await runScaleGauntlet(100)
  assert.ok(elapsedMs < 30000, `100-node gauntlet took ${elapsedMs}ms, expected well under 30s`)
})

// REAL FINDING (Trust + Scale Hardening, Phase 13): CORRECTNESS holds at
// 1000 nodes -- every assertion above (exactly one CanonicalFact per node,
// correct value, no duplicate/lost node ids, conflicts resolved correctly)
// passes. PERFORMANCE does not scale linearly: measured ~125s for 1000
// nodes vs ~1.2s for 100 (roughly 100x the nodes, ~100x the time -- an
// O(n^2)-shaped curve, not O(n)). Root cause: every research-*.mjs mutation
// goes through withResearchNode (research-mission.mjs), which
// structuredClone()s the ENTIRE mission object on every single call --
// correct and safe for concurrency, but its cost grows with total mission
// size, so N mutations against an N-node mission cost O(n^2) overall. This
// is a genuine architectural characteristic, not a bug in this test or in
// any of the phases fixed this session -- flagged here rather than
// silently tuned away with a lenient ceiling. Fixing it (e.g. structural
// sharing / a less-than-whole-mission clone granularity) is a real,
// separate piece of work this pass deliberately does NOT attempt, per the
// standing instruction not to half-implement speculative architecture
// changes; the ceiling below is intentionally generous (not a performance
// SLA) so this test documents and catches a true regression (e.g. an
// accidental infinite loop) without being a tuned-to-pass number.
test('scale gauntlet: 1000 synthetic nodes, zero external spend, full ladder per node', { timeout: 300000 }, async () => {
  const { elapsedMs } = await runScaleGauntlet(1000)
  assert.ok(elapsedMs < 240000, `1000-node gauntlet took ${elapsedMs}ms, expected well under the generous 240s ceiling (observed baseline: ~125s)`)
})

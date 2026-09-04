// §4 Wave 5: proves the frozen bake-off harness actually functions end to
// end -- against the deterministic fake worker only. NO real provider is
// ever called; this demonstrates the harness is ready to point at a real
// adapter once HQ authorizes it, without spending anything now.
import assert from 'node:assert/strict'
import test from 'node:test'
import { createDeterministicFakeResearchWorker } from '../adapters/deterministic-fake-research-worker.mjs'
import { buildBakeoffPackage, buildBakeoffRequests } from '../fixtures/nfl-2001-qb-bakeoff-package.mjs'
import { buildBakeoffReport, dispatchAndAwaitResult, evaluateRepeatability, runBakeoffRequest } from '../domain/research-bakeoff-harness.mjs'

const clock = () => new Date('2026-09-25T09:00:00.000Z')

function scriptFor(requests, periodScope) {
  const script = new Map()
  for (const request of Object.values(requests)) {
    const fields = Object.keys(request.requestedOutputSchema.properties ?? {})
    script.set(request.taskFingerprint, {
      behavior: 'SUCCESS',
      observations: [{ rawContent: 'deterministic bake-off harness fixture content', extractedAt: clock().toISOString(), providerConfidence: 0.8, providerReasoning: 'harness fixture' }],
      proposedClaims: fields.map((fieldName) => ({ fieldName, proposedValue: `value-for-${fieldName}`, temporalScope: periodScope, providerConfidence: 0.8, providerReasoning: 'harness fixture' })),
      evidence: fields.map((fieldName) => ({ claimFieldName: fieldName, sourceRef: `src:${request.nodeId}:${fieldName}`, snippet: 'harness fixture snippet', supportsClaim: true })),
      sourceReferences: fields.map((fieldName) => ({ sourceRef: `src:${request.nodeId}:${fieldName}`, url: `https://pro-football-reference.com/${request.nodeId}/${fieldName}`, publisher: 'pro-football-reference.com', retrievedAt: clock().toISOString() })),
      sourceSnapshotsOrSnapshotRefs: fields.map((fieldName) => ({ sourceRef: `src:${request.nodeId}:${fieldName}`, contentHash: `sha256:${fieldName}`, rawContentRef: `fixture://${fieldName}` })),
      newGapProposals: [],
      warnings: [],
      unresolvedQuestions: [],
      usage: { requestCount: 1, tokensOrUnits: 100, providerReportedCostUsd: 0 }
    })
  }
  return script
}

test('dispatchAndAwaitResult measures real latency and is bounded (never an infinite poll loop)', async () => {
  const { mission } = buildBakeoffPackage(clock)
  const requests = buildBakeoffRequests(mission, 'FAKE', clock)
  const oneRequest = Object.values(requests)[0]
  const script = scriptFor(requests, 'x')
  const worker = createDeterministicFakeResearchWorker({ provider: 'FAKE', script, clock })
  const run = await dispatchAndAwaitResult({ worker, request: oneRequest, clock, maxPolls: 10 })
  assert.equal(run.ok, true)
  assert.ok(run.latencyMs >= 0)
  assert.ok(run.pollCount >= 1)
})

test('dispatchAndAwaitResult against a permanently-suspended run terminates at maxPolls, never hangs', async () => {
  const { mission } = buildBakeoffPackage(clock)
  const requests = buildBakeoffRequests(mission, 'FAKE', clock)
  const oneRequest = Object.values(requests)[0]
  const script = new Map([[oneRequest.taskFingerprint, { behavior: 'TIMEOUT_SUSPENSION' }]])
  const worker = createDeterministicFakeResearchWorker({ provider: 'FAKE', script, clock })
  const run = await dispatchAndAwaitResult({ worker, request: oneRequest, clock, maxPolls: 3 })
  assert.equal(run.ok, false)
  assert.equal(run.reason, 'MAX_POLLS_EXHAUSTED')
  assert.equal(run.pollCount, 3)
})

test('the full harness runs the frozen bake-off package end to end against the fake worker and produces a non-collapsed report', async () => {
  const { mission: baseMission, periodScope, preferredSourceHosts, disallowedSourceHosts, expectedEntityIdByNodeId } = buildBakeoffPackage(clock)
  const requests = buildBakeoffRequests(baseMission, 'FAKE', clock)
  const script = scriptFor(requests, periodScope)
  const worker = createDeterministicFakeResearchWorker({ provider: 'FAKE', script, clock })

  let mission = baseMission
  const instrumentation = []
  for (const [nodeId, request] of Object.entries(requests)) {
    const run = await runBakeoffRequest({ mission, nodeId, worker, request, clock })
    mission = run.mission
    instrumentation.push(run)
  }

  assert.equal(instrumentation.every((r) => !r.providerFailed), true)
  assert.equal(mission.nodes.every((n) => n.status === 'ADMITTED'), true)

  const report = buildBakeoffReport(mission, { instrumentation, preferredSourceHosts, disallowedSourceHosts, expectedEntityIdByNodeId, clock })
  // No single opaque score anywhere in the report. sourceQuality is
  // deliberately excluded from this check -- it's a categorical breakdown
  // object ({PRIMARY, DISALLOWED, UNCLASSIFIED}), not a collapsed numeric
  // judgment, asserted as such below.
  assert.ok(!Object.keys(report).some((k) => k !== 'sourceQuality' && /score|overall|rating|grade/i.test(k)))
  assert.equal(typeof report.sourceQuality, 'object')
  assert.equal(typeof report.sourceQuality.PRIMARY, 'number', 'sourceQuality stays a named categorical breakdown, never collapsed into one number')
  assert.equal(report.providerFailureCount, 0)
  assert.equal(report.requestCount, 3, 'one request per node in this harness demo')
  assert.equal(report.totalCostUsd, 0, 'the fake worker\'s real $0 cost is preserved, never null-coerced away or fabricated')
  assert.ok(report.fieldCompletion > 0)
  assert.ok(report.evidenceCoverage > 0)
  assert.ok(report.citationSupportCorrectness > 0)
  assert.ok(report.primarySourceCoverage > 0, 'pro-football-reference.com is in the frozen preferredSourceHosts list')
  assert.ok(report.sourceQuality.PRIMARY > 0, 'source quality is a distinct categorical breakdown, not just the primarySourceCoverage ratio')
  assert.equal(report.sourceQuality.DISALLOWED, 0)
  const expectedDistinctSources = Object.values(requests).reduce((sum, r) => sum + Object.keys(r.requestedOutputSchema.properties ?? {}).length, 0)
  assert.equal(report.sourceQuality.PRIMARY + report.sourceQuality.DISALLOWED + report.sourceQuality.UNCLASSIFIED, expectedDistinctSources, 'one distinct source per requested field, deduplicated')
  // This demo run only exercises dispatch->admission (proving the harness
  // itself functions), never recordIdentityResolutionState -- so
  // identityCorrectness is honestly null (not applicable), never a
  // fabricated 0 or a forced 1. The real identity-review path is already
  // exhaustively proven in nfl-2001-qb-research-fixture.test.mjs.
  assert.equal(report.identityCorrectness, null)
  assert.ok(report.avgLatencyMs >= 0)
})

test('repeatability protocol: dispatching the identical frozen request twice and comparing results', async () => {
  const { mission } = buildBakeoffPackage(clock)
  const requests = buildBakeoffRequests(mission, 'FAKE', clock)
  const oneRequest = Object.values(requests)[0]
  const script = scriptFor(requests, 'x')
  const worker = createDeterministicFakeResearchWorker({ provider: 'FAKE', script, clock })

  const runA = await dispatchAndAwaitResult({ worker, request: oneRequest, clock })
  const runB = await dispatchAndAwaitResult({ worker, request: oneRequest, clock })
  const repeatability = evaluateRepeatability(runA.result, runB.result)
  assert.equal(repeatability.matchRatio, 1, 'the deterministic fake worker is perfectly repeatable by construction')
  assert.equal(repeatability.mismatches.length, 0)
})

// Independent-verification finding: a worker that THROWS instead of
// returning {ok:false,...} (violating the documented protocol) must not
// crash the harness -- both shipped adapters honor the convention, but
// the harness itself must not assume every future worker will.
test('a worker whose dispatch() throws degrades to an honest ok:false, never an uncaught exception', async () => {
  const { mission } = buildBakeoffPackage(clock)
  const requests = buildBakeoffRequests(mission, 'FAKE', clock)
  const oneRequest = Object.values(requests)[0]
  const throwingWorker = { dispatch: async () => { throw new Error('misbehaving worker') }, fetchResult: async () => ({ ok: true, status: 'PENDING' }) }
  const run = await dispatchAndAwaitResult({ worker: throwingWorker, request: oneRequest, clock })
  assert.equal(run.ok, false)
  assert.equal(run.reason, 'WORKER_DISPATCH_THREW')
})

test('a worker whose fetchResult() throws mid-poll degrades to an honest ok:false, never an uncaught exception', async () => {
  const { mission } = buildBakeoffPackage(clock)
  const requests = buildBakeoffRequests(mission, 'FAKE', clock)
  const oneRequest = Object.values(requests)[0]
  const throwingWorker = { dispatch: async () => ({ ok: true, workerRunRef: { provider: 'X', providerRunId: 'r1', dispatchedAt: clock().toISOString() } }), fetchResult: async () => { throw new Error('misbehaving worker') } }
  const run = await dispatchAndAwaitResult({ worker: throwingWorker, request: oneRequest, clock })
  assert.equal(run.ok, false)
  assert.equal(run.reason, 'WORKER_FETCH_RESULT_THREW')
})

test('a worker reporting READY with no result field is a malformed response, never a crash downstream', async () => {
  const { mission } = buildBakeoffPackage(clock)
  const requests = buildBakeoffRequests(mission, 'FAKE', clock)
  const oneRequest = Object.values(requests)[0]
  const brokenWorker = { dispatch: async () => ({ ok: true, workerRunRef: { provider: 'X', providerRunId: 'r1', dispatchedAt: clock().toISOString() } }), fetchResult: async () => ({ ok: true, status: 'READY' }) }
  const run = await dispatchAndAwaitResult({ worker: brokenWorker, request: oneRequest, clock })
  assert.equal(run.ok, false)
  assert.equal(run.reason, 'MALFORMED_FETCH_RESPONSE')
})

test('evaluateRepeatability refuses to compare results from different requests', () => {
  assert.throws(() => evaluateRepeatability({ taskFingerprint: 'a', proposedClaims: [] }, { taskFingerprint: 'b', proposedClaims: [] }), /identical taskFingerprint/)
})

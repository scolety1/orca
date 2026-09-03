// Wave 4: the SAME conformance suite run against both the Parallel and
// Exa adapters -- proving downstream TSF code never needs to know which
// provider produced a BoundedResearchResult. Deliberately domain-neutral
// (no NFL/QB names) since this exercises the generic provider seam, not
// the fixture. No transport here is ever backed by a real HTTP client --
// every scenario injects a synthetic, deterministic transport.
import assert from 'node:assert/strict'
import test from 'node:test'
import { createParallelResearchWorker, PARALLEL_PROVIDER_ID } from '../adapters/parallel-research-worker.mjs'
import { createExaResearchWorker, EXA_PROVIDER_ID } from '../adapters/exa-research-worker.mjs'
import { admitBoundedResearchResult } from '../domain/research-admission.mjs'
import { addResearchNode, createResearchMission } from '../domain/research-mission.mjs'
import { buildBoundedResearchRequest, markResearchNodeReady, recordResearchNodeDispatch, recordResearchNodeResult } from '../domain/research-node.mjs'
import { verifyResearchClaim } from '../domain/research-verification.mjs'
import { validateBoundedResearchResult } from '../contracts/validate-research-contracts.mjs'

const clock = () => new Date('2026-09-22T10:00:00.000Z')

function buildRequest(provider) {
  const specification = {
    schemaVersion: 'TSF_RESEARCH_SPECIFICATION_V1',
    id: 'spec:conformance',
    researchQuestion: 'What is the value of fieldA and fieldB for the test entity?',
    entityType: 'TEST_ENTITY',
    requestedFields: [
      { fieldName: 'fieldA', valueType: 'string', required: true, derivationRule: null },
      { fieldName: 'fieldB', valueType: 'number', required: true, derivationRule: null }
    ],
    sourcePolicy: { preferredSources: ['primary-source.example'], disallowedSources: ['banned-source.example'], licensingConstraints: [], freshnessPolicy: 'STATIC', requireIndependentSources: true, minSourceCount: 1 },
    temporalRequirements: { asOfDate: '2026-01-01', periodScope: 'TEST_PERIOD' },
    budget: { maxCostUsd: null, maxLatencyMs: 60000, maxToolCallsPerNode: 5 },
    toolPermissions: ['test-tool'],
    expectedUniverse: { schemaVersion: 'TSF_EXPECTED_UNIVERSE_V1', entityType: 'TEST_ENTITY', expectedCount: 1, expectedEntities: [] }
  }
  let mission = createResearchMission({ id: 'mission:conformance', projectId: 'fixture:conformance', specification, expectedUniverse: specification.expectedUniverse }, clock)
  mission = addResearchNode(mission, { id: 'node:conformance', nodeRole: 'PRIMARY_RESEARCH', targetEntity: { entityId: 'test:entity:1' }, requestedFields: specification.requestedFields, requestedOutputSchema: { type: 'object', properties: { fieldA: {}, fieldB: {} } } }, clock)
  return { mission, request: buildBoundedResearchRequest(mission, mission.nodes[0], provider, clock) }
}

const PARALLEL = {
  name: 'PARALLEL',
  providerId: PARALLEL_PROVIDER_ID,
  hasNativeConfidence: true,
  createWorker: (transport) => createParallelResearchWorker({ transport, clock }),
  makeTransport: (script) => ({
    createTaskRun: async (spec) => script.onCreate(spec),
    getTaskRun: async (runId) => script.onGet(runId)
  }),
  completedRun: (runId, { fieldA, fieldB, citations = {} }) => ({
    run_id: runId,
    status: 'completed',
    completed_at: '2026-09-22T10:05:00.000Z',
    output: {
      content: { fieldA, fieldB },
      // Test-shared citation shape ({url, excerpt, publisher}) reshaped
      // here into the real Parallel Citation contract ({url, title,
      // excerpts: [...]}) confirmed by live-doc revalidation.
      basis: [
        { field: 'fieldA', citations: (citations.fieldA ?? []).map((c) => ({ url: c.url, title: c.publisher ?? null, excerpts: c.excerpt ? [c.excerpt] : [] })), confidence: 'high', reasoning: 'primary source review' },
        { field: 'fieldB', citations: (citations.fieldB ?? []).map((c) => ({ url: c.url, title: c.publisher ?? null, excerpts: c.excerpt ? [c.excerpt] : [] })), confidence: 'medium', reasoning: 'cross-checked total' }
      ]
    },
    usage: { num_requests: 3, tokens: 500, cost_usd: 0.12 }
  }),
  failedRun: (runId) => ({ run_id: runId, status: 'failed', error: { message: 'provider-side task failure' } }),
  pendingRun: (runId) => ({ run_id: runId, status: 'running' }),
  malformedRun: (runId) => ({ run_id: runId, status: 'completed' }), // no output at all
  missingFieldRun: (runId) => ({ run_id: runId, status: 'completed', completed_at: '2026-09-22T10:05:00.000Z', output: { content: { fieldA: 'present' }, basis: [] }, usage: {} })
}

const EXA = {
  name: 'EXA',
  providerId: EXA_PROVIDER_ID,
  // Live-bake-off finding (2026-09-03): Exa's real grounding entries DO
  // carry a per-field confidence (low/medium/high, same scale as
  // Parallel's basis) -- not documented anywhere fetchable during the
  // adoption-audit research phase, but confirmed against a real response.
  hasNativeConfidence: true,
  createWorker: (transport) => createExaResearchWorker({ transport, clock }),
  makeTransport: (script) => ({
    createAgentRun: async (spec) => script.onCreate(spec),
    getAgentRun: async (runId) => script.onGet(runId)
  }),
  completedRun: (runId, { fieldA, fieldB, citations = {} }) => ({
    id: runId,
    status: 'completed',
    completed_at: '2026-09-22T10:05:00.000Z',
    // Real shape confirmed by live-bake-off (2026-09-03): grounding[].field
    // is prefixed 'structured.<name>', citations (not 'sources') carry
    // only {url, title} (no excerpt text), and a per-field confidence
    // string IS present despite not being documented.
    output: {
      structured: { fieldA, fieldB },
      grounding: [
        { field: 'structured.fieldA', citations: (citations.fieldA ?? []).map((c) => ({ url: c.url, title: c.publisher ?? null })), confidence: 'high' },
        { field: 'structured.fieldB', citations: (citations.fieldB ?? []).map((c) => ({ url: c.url, title: c.publisher ?? null })), confidence: 'medium' }
      ]
    },
    usage: { agentComputeUnits: 2.5 },
    costDollars: { total: 0.4, agentCompute: 0.25, search: 0.15, emails: 0, phoneNumbers: 0 }
  }),
  failedRun: (runId) => ({ id: runId, status: 'failed', error: { message: 'provider-side agent failure' } }),
  pendingRun: (runId) => ({ id: runId, status: 'queued' }),
  malformedRun: (runId) => ({ id: runId, status: 'completed' }),
  missingFieldRun: (runId) => ({ id: runId, status: 'completed', completed_at: '2026-09-22T10:05:00.000Z', output: { structured: { fieldA: 'present' }, grounding: [] }, usage: {} })
}

for (const provider of [PARALLEL, EXA]) {
  test(`[${provider.name}] request normalization: researchQuestion/source-policy reach the transport unmodified, using each provider's REAL documented fields only`, async () => {
    const { request } = buildRequest(provider.providerId)
    let capturedSpec
    const transport = provider.makeTransport({ onCreate: async (spec) => { capturedSpec = spec; return provider.name === 'PARALLEL' ? { run_id: 'r1' } : { id: 'r1' } }, onGet: async () => provider.pendingRun('r1') })
    const worker = provider.createWorker(transport)
    await worker.dispatch(request)
    assert.ok(capturedSpec, 'the transport must actually be called with a spec')
    const captured = JSON.stringify(capturedSpec)
    assert.ok(captured.includes(request.researchQuestion))
    assert.ok(captured.includes(request.preferredSources[0]))
    assert.ok(captured.includes(request.disallowedSources[0]))
    if (provider.name === 'PARALLEL') {
      // Live-bake-off finding: Parallel's metadata field only accepts
      // scalar values (max 16 chars/key) -- node_id/task_fingerprint/
      // temporal_scope/as_of_date fit there; source filtering moved to
      // the real source_policy.{include_domains,exclude_domains} field.
      assert.ok(captured.includes(request.nodeId))
      assert.ok(captured.includes(request.taskFingerprint))
      assert.ok(captured.includes(request.temporalRequirements.periodScope))
      assert.deepEqual(capturedSpec.source_policy.include_domains, request.preferredSources)
      assert.deepEqual(capturedSpec.source_policy.exclude_domains, request.disallowedSources)
      for (const key of Object.keys(capturedSpec.metadata)) {
        assert.ok(key.length <= 16, `Parallel metadata key "${key}" exceeds the documented 16-char limit`)
        assert.ok(typeof capturedSpec.metadata[key] !== 'object', `Parallel metadata value for "${key}" must be a scalar, not an object/array`)
      }
    }
    if (provider.name === 'EXA') {
      // Regression guard: an earlier build of this adapter never set
      // effort at all -- caught during live-doc revalidation. HQ's
      // governed bake-off policy forbids auto-escalating past 'medium'.
      assert.equal(capturedSpec.effort, 'medium')
      // Live-bake-off finding: Exa's Agent run schema has no documented
      // metadata field -- an earlier build sent one and Exa rejected the
      // whole request with a 400. Source guidance moved to the real,
      // documented systemPrompt field.
      assert.equal(capturedSpec.metadata, undefined)
      assert.ok(capturedSpec.systemPrompt.includes(request.preferredSources[0]))
    }
  })

  test(`[${provider.name}] never auto-escalates processor/effort beyond the governed tier`, async () => {
    const { request } = buildRequest(provider.providerId)
    let capturedSpec
    const transport = provider.makeTransport({ onCreate: async (spec) => { capturedSpec = spec; return provider.name === 'PARALLEL' ? { run_id: 'r1' } : { id: 'r1' } }, onGet: async () => provider.pendingRun('r1') })
    const worker = provider.createWorker(transport)
    await worker.dispatch(request)
    if (provider.name === 'PARALLEL') {
      // Regression guard: an earlier build of this adapter hardcoded the
      // unrelated 'base' processor, never HQ's governed 'core' tier --
      // caught during live-doc revalidation.
      assert.equal(capturedSpec.processor, 'core')
      assert.notEqual(capturedSpec.processor, 'ultra')
      assert.notEqual(capturedSpec.processor, 'pro')
    } else {
      assert.equal(capturedSpec.effort, 'medium')
      assert.notEqual(capturedSpec.effort, 'high')
      assert.notEqual(capturedSpec.effort, 'auto')
    }
  })

  test(`[${provider.name}] requested output-schema translation reaches the transport`, async () => {
    const { request } = buildRequest(provider.providerId)
    let capturedSpec
    const transport = provider.makeTransport({ onCreate: async (spec) => { capturedSpec = spec; return provider.name === 'PARALLEL' ? { run_id: 'r1' } : { id: 'r1' } }, onGet: async () => provider.pendingRun('r1') })
    const worker = provider.createWorker(transport)
    await worker.dispatch(request)
    const schemaField = provider.name === 'PARALLEL' ? capturedSpec.task_spec.output_schema.json_schema : capturedSpec.outputSchema
    assert.deepEqual(schemaField, request.requestedOutputSchema)
  })

  test(`[${provider.name}] a completed run normalizes into a valid BoundedResearchResult with citations/evidence and source references`, async () => {
    const { request } = buildRequest(provider.providerId)
    const transport = provider.makeTransport({
      onCreate: async () => (provider.name === 'PARALLEL' ? { run_id: 'r1' } : { id: 'r1' }),
      onGet: async () => provider.completedRun('r1', { fieldA: 'value-a', fieldB: 42, citations: { fieldA: [{ url: 'https://example.invalid/a', excerpt: 'supports A', publisher: 'pub-a' }] } })
    })
    const worker = provider.createWorker(transport)
    const dispatched = await worker.dispatch(request)
    assert.equal(dispatched.ok, true)
    const fetched = await worker.fetchResult(dispatched.workerRunRef)
    assert.equal(fetched.status, 'READY')
    assert.doesNotThrow(() => validateBoundedResearchResult(fetched.result))
    assert.equal(fetched.result.status, 'SUCCEEDED')
    assert.equal(fetched.result.provider, provider.providerId)
    assert.equal(fetched.result.proposedClaims.find((c) => c.fieldName === 'fieldA').proposedValue, 'value-a')
    assert.equal(fetched.result.proposedClaims.find((c) => c.fieldName === 'fieldB').proposedValue, 42)
    assert.equal(fetched.result.evidence.length, 1)
    assert.equal(fetched.result.sourceReferences.length, 1)
    assert.equal(fetched.result.sourceReferences[0].sourceRef, 'https://example.invalid/a')
  })

  test(`[${provider.name}] provider confidence normalization`, async () => {
    const { request } = buildRequest(provider.providerId)
    const transport = provider.makeTransport({
      onCreate: async () => (provider.name === 'PARALLEL' ? { run_id: 'r1' } : { id: 'r1' }),
      onGet: async () => provider.completedRun('r1', { fieldA: 'x', fieldB: 1 })
    })
    const worker = provider.createWorker(transport)
    const dispatched = await worker.dispatch(request)
    const fetched = await worker.fetchResult(dispatched.workerRunRef)
    const claim = fetched.result.proposedClaims.find((c) => c.fieldName === 'fieldA')
    if (provider.hasNativeConfidence) {
      assert.notEqual(claim.providerConfidence, null)
      assert.equal(typeof claim.providerConfidence, 'number')
    } else {
      assert.equal(claim.providerConfidence, null, 'Exa has no native confidence field -- must stay honestly null, never fabricated')
    }
  })

  test(`[${provider.name}] worker_run_ref is the only place provider run identity appears -- never leaks into node/claim identity fields`, async () => {
    const { request } = buildRequest(provider.providerId)
    const transport = provider.makeTransport({
      onCreate: async () => (provider.name === 'PARALLEL' ? { run_id: 'provider-internal-run-id-xyz' } : { id: 'provider-internal-run-id-xyz' }),
      onGet: async () => provider.completedRun('provider-internal-run-id-xyz', { fieldA: 'x', fieldB: 1 })
    })
    const worker = provider.createWorker(transport)
    const dispatched = await worker.dispatch(request)
    assert.equal(dispatched.workerRunRef.providerRunId, 'provider-internal-run-id-xyz')
    const fetched = await worker.fetchResult(dispatched.workerRunRef)
    assert.equal(fetched.result.nodeId, request.nodeId, 'nodeId is TSF-assigned, never overwritten by the provider run id')
    assert.equal(fetched.result.providerRunRef.providerRunId, 'provider-internal-run-id-xyz', 'the provider run id lives ONLY in providerRunRef')
  })

  test(`[${provider.name}] failure mapping: a provider-reported failure becomes a FAILED result with failureDetails, never thrown uncaught`, async () => {
    const { request } = buildRequest(provider.providerId)
    const transport = provider.makeTransport({
      onCreate: async () => (provider.name === 'PARALLEL' ? { run_id: 'r1' } : { id: 'r1' }),
      onGet: async () => provider.failedRun('r1')
    })
    const worker = provider.createWorker(transport)
    const dispatched = await worker.dispatch(request)
    const fetched = await worker.fetchResult(dispatched.workerRunRef)
    assert.equal(fetched.result.status, 'FAILED')
    assert.equal(fetched.result.failureDetails.reason, 'PROVIDER_REPORTED_FAILURE')
    assert.doesNotThrow(() => validateBoundedResearchResult(fetched.result))
  })

  test(`[${provider.name}] missing-field mapping: a field absent from the provider's own response becomes an honest null proposedValue`, async () => {
    const { request } = buildRequest(provider.providerId)
    const transport = provider.makeTransport({
      onCreate: async () => (provider.name === 'PARALLEL' ? { run_id: 'r1' } : { id: 'r1' }),
      onGet: async () => provider.missingFieldRun('r1')
    })
    const worker = provider.createWorker(transport)
    const dispatched = await worker.dispatch(request)
    const fetched = await worker.fetchResult(dispatched.workerRunRef)
    const missingClaim = fetched.result.proposedClaims.find((c) => c.fieldName === 'fieldB')
    assert.equal(missingClaim.proposedValue, null)
  })

  test(`[${provider.name}] malformed-response rejection: a "completed" run with no real output never becomes a fabricated success`, async () => {
    const { request } = buildRequest(provider.providerId)
    const transport = provider.makeTransport({
      onCreate: async () => (provider.name === 'PARALLEL' ? { run_id: 'r1' } : { id: 'r1' }),
      onGet: async () => provider.malformedRun('r1')
    })
    const worker = provider.createWorker(transport)
    const dispatched = await worker.dispatch(request)
    const fetched = await worker.fetchResult(dispatched.workerRunRef)
    assert.equal(fetched.result.status, 'FAILED')
    assert.equal(fetched.result.failureDetails.reason, 'MALFORMED_PROVIDER_RESPONSE')
    assert.doesNotThrow(() => validateBoundedResearchResult(fetched.result))
  })

  test(`[${provider.name}] usage/cost fields: an unknown cost stays null, never coerced to $0 (unlike the deterministic fake worker's real $0)`, async () => {
    const { request } = buildRequest(provider.providerId)
    const transport = provider.makeTransport({
      onCreate: async () => (provider.name === 'PARALLEL' ? { run_id: 'r1' } : { id: 'r1' }),
      onGet: async () => {
        const run = provider.completedRun('r1', { fieldA: 'x', fieldB: 1 })
        run.usage = {} // provider omitted usage entirely
        delete run.costDollars // Exa reports cost as a top-level field, not under usage -- must be cleared separately
        return run
      }
    })
    const worker = provider.createWorker(transport)
    const dispatched = await worker.dispatch(request)
    const fetched = await worker.fetchResult(dispatched.workerRunRef)
    assert.equal(fetched.result.usage.providerReportedCostUsd, null)
    assert.notEqual(fetched.result.usage.providerReportedCostUsd, 0)
  })

  test(`[${provider.name}] pending status maps to PENDING, not a fabricated result`, async () => {
    const { request } = buildRequest(provider.providerId)
    const transport = provider.makeTransport({
      onCreate: async () => (provider.name === 'PARALLEL' ? { run_id: 'r1' } : { id: 'r1' }),
      onGet: async () => provider.pendingRun('r1')
    })
    const worker = provider.createWorker(transport)
    const dispatched = await worker.dispatch(request)
    const fetched = await worker.fetchResult(dispatched.workerRunRef)
    assert.equal(fetched.status, 'PENDING')
  })

  test(`[${provider.name}] a create-time transport error is an honest ok:false, never an uncaught throw`, async () => {
    const { request } = buildRequest(provider.providerId)
    const transport = provider.makeTransport({ onCreate: async () => { throw new Error('network unreachable') }, onGet: async () => null })
    const worker = provider.createWorker(transport)
    const dispatched = await worker.dispatch(request)
    assert.equal(dispatched.ok, false)
  })

  test(`[${provider.name}] downstream admission/verification never brands its logic on which provider produced the result`, async () => {
    const { mission, request } = buildRequest(provider.providerId)
    const transport = provider.makeTransport({
      onCreate: async () => (provider.name === 'PARALLEL' ? { run_id: 'r1' } : { id: 'r1' }),
      onGet: async () => provider.completedRun('r1', { fieldA: 'value-a', fieldB: 42, citations: { fieldA: [{ url: 'https://example.invalid/a', excerpt: 'supports A' }], fieldB: [{ url: 'https://example.invalid/b', excerpt: 'supports B' }] } })
    })
    const worker = provider.createWorker(transport)
    const dispatched = await worker.dispatch(request)
    const fetched = await worker.fetchResult(dispatched.workerRunRef)

    let next = markResearchNodeReady(mission, 'node:conformance', clock, mission.revision)
    next = recordResearchNodeDispatch(next, 'node:conformance', { taskFingerprint: request.taskFingerprint, workerRunRef: dispatched.workerRunRef }, clock, next.revision)
    next = recordResearchNodeResult(next, 'node:conformance', fetched.result, clock, next.revision)
    const digest = next.nodes[0].rawResults.at(-1).digest
    next = admitBoundedResearchResult(next, 'node:conformance', digest, clock, next.revision)
    assert.equal(next.nodes[0].status, 'ADMITTED')
    assert.equal(next.nodes[0].claims.length, 2)

    // External confidence never becomes TSF verification authority: fieldA
    // verifies to PASS purely because real supporting evidence exists --
    // regardless of whether the provider's own confidence was present
    // (Parallel: ~0.87) or structurally absent (Exa: null).
    const claimA = next.nodes[0].claims.find((c) => c.fieldName === 'fieldA')
    next = verifyResearchClaim(next, 'node:conformance', claimA.id, clock, next.revision)
    assert.equal(next.nodes[0].verifications.at(-1).verdict, 'PASS')
    assert.equal(next.nodes[0].claims.find((c) => c.id === claimA.id).status, 'VERIFIED')
  })
}

test('the SAME shared conformance assertions were exercised against both providers -- neither adapter got a weaker suite', () => {
  assert.deepEqual(PARALLEL.hasNativeConfidence, true)
  assert.deepEqual(EXA.hasNativeConfidence, true)
  assert.notEqual(PARALLEL.providerId, EXA.providerId)
})

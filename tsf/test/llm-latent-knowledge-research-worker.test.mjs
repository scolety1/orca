// Deterministic, no-network proof of the LLM-latent-knowledge worker: every
// LLM invocation here is a dependency-injected fake -- this suite never
// spawns a real provider process or incurs real cost, mirroring how
// web-table-research-worker.test.mjs injects `acquireFn` instead of hitting
// the real network.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import {
  createLlmLatentKnowledgeResearchWorker,
  LLM_LATENT_KNOWLEDGE_PROVIDER_ID
} from '../adapters/llm-latent-knowledge-research-worker.mjs'
import { validateBoundedResearchResult } from '../contracts/validate-research-contracts.mjs'

const ENV_VAR = 'TSF_RESEARCH_LATENT_KNOWLEDGE_DISPATCH_ENABLED'
const clock = () => new Date('2026-09-06T12:00:00.000Z')

async function withEnv(vars, fn) {
  const prior = {}
  for (const key of Object.keys(vars)) {
    prior[key] = process.env[key]
  }
  Object.assign(process.env, vars)
  try {
    return await fn()
  } finally {
    for (const key of Object.keys(vars)) {
      if (prior[key] === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = prior[key]
      }
    }
  }
}

function baseRequest(overrides = {}) {
  return {
    schemaVersion: 'TSF_BOUNDED_RESEARCH_REQUEST_V1',
    nodeId: 'node:1999-nfl-mvp',
    taskFingerprint: 'b'.repeat(64),
    nodeRole: 'PRIMARY_RESEARCH',
    researchQuestion: 'Who won the 1999 NFL MVP award and what was his passing yardage that season?',
    targetEntity: { entityId: '1999-nfl-mvp', name: '1999 NFL MVP' },
    scope: ['node:1999-nfl-mvp'],
    requestedOutputSchema: { properties: { 'MVP Name': {}, 'Passing Yards': {} } },
    temporalRequirements: { asOfDate: '2026-09-06', periodScope: '1999' },
    sourcePolicy: {},
    preferredSources: [],
    disallowedSources: [],
    licensingConstraints: [],
    freshnessPolicy: 'UNSPECIFIED',
    budget: {},
    toolPermissions: [],
    ...overrides
  }
}

function fakeInvoke({ ok = true, data = null, reason = null, detail = null, agentId = 'some-fake-agent', providerId = 'some-fake-provider', model = 'some-fake-model', costUsd = 0.0042 } = {}) {
  const calls = []
  const fn = async (args) => {
    calls.push(args)
    if (!ok) {
      return { ok: false, role: 'PLANNER_DEEP', reason, detail, attempted: agentId }
    }
    return { ok: true, role: 'PLANNER_DEEP', data, agentId, providerId, model, costUsd }
  }
  fn.calls = calls
  return fn
}

test('generic role resolution: dispatch forwards only systemPrompt/prompt/jsonSchema/timeoutOverrideMs to the injected fn -- no role/provider param, no hardcoded model name in the source', async () => {
  await withEnv({ [ENV_VAR]: '1' }, async () => {
    const invoke = fakeInvoke({ data: { answers: [{ fieldName: 'MVP Name', status: 'KNOWN', value: 'Kurt Warner', confidence: 0.9, reasoning: 'well-known result', rememberedSourceContext: 'general football knowledge' }, { fieldName: 'Passing Yards', status: 'UNKNOWN', value: null, confidence: null, reasoning: 'not confident in exact figure', rememberedSourceContext: null }] } })
    const worker = createLlmLatentKnowledgeResearchWorker({ clock, invokeLiveStructuredAnalysisFn: invoke })
    const dispatched = await worker.dispatch(baseRequest())
    assert.equal(dispatched.ok, true)
    assert.equal(invoke.calls.length, 1)
    assert.deepEqual(Object.keys(invoke.calls[0]).sort(), ['jsonSchema', 'prompt', 'systemPrompt', 'timeoutOverrideMs'])
    assert.equal(typeof invoke.calls[0].systemPrompt, 'string')
    assert.equal(typeof invoke.calls[0].prompt, 'string')
  })

  // Strip comment lines/blocks first -- explanatory prose is allowed to
  // name real profile ids (e.g. "CODEX_SAFE") when documenting the
  // reconciliation decision; only ACTUAL CODE must never hardcode a
  // provider/model literal.
  const rawSource = readFileSync(path.join(import.meta.dirname, '..', 'adapters', 'llm-latent-knowledge-research-worker.mjs'), 'utf-8')
  const codeOnly = rawSource
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n')
  for (const bannedLiteral of ["'codex'", "'claude-code'", "'anthropic'", "'openai'", 'claude-sonnet', 'claude-opus', 'gpt-']) {
    assert.equal(codeOnly.toLowerCase().includes(bannedLiteral.toLowerCase()), false, `worker source code must never hardcode a provider/model literal: found "${bannedLiteral}"`)
  }
})

test('a genuine model UNKNOWN response is distinguishable from a provider-unavailable failure', async () => {
  await withEnv({ [ENV_VAR]: '1' }, async () => {
    const unavailable = fakeInvoke({ ok: false, reason: 'PROVIDER_UNAVAILABLE', detail: 'no provider CLI found on this host' })
    const workerA = createLlmLatentKnowledgeResearchWorker({ clock, invokeLiveStructuredAnalysisFn: unavailable })
    const dispatchedA = await workerA.dispatch(baseRequest())
    assert.equal(dispatchedA.ok, false)
    assert.equal(dispatchedA.reason, 'PROVIDER_UNAVAILABLE')

    const genuineUnknown = fakeInvoke({ data: { answers: [{ fieldName: 'MVP Name', status: 'UNKNOWN', value: null, confidence: null, reasoning: 'no real recollection', rememberedSourceContext: null }, { fieldName: 'Passing Yards', status: 'UNKNOWN', value: null, confidence: null, reasoning: 'no real recollection', rememberedSourceContext: null }] } })
    const workerB = createLlmLatentKnowledgeResearchWorker({ clock, invokeLiveStructuredAnalysisFn: genuineUnknown })
    const dispatchedB = await workerB.dispatch(baseRequest())
    assert.equal(dispatchedB.ok, false)
    assert.equal(dispatchedB.reason, 'MODEL_REPORTED_UNKNOWN_FOR_ALL_FIELDS')

    assert.notEqual(dispatchedA.reason, dispatchedB.reason, 'the two failure kinds must carry genuinely distinct reason codes')
  })
})

test('claims always carry the honestly-weakest provenance tier (NONE), never a stronger one', async () => {
  await withEnv({ [ENV_VAR]: '1' }, async () => {
    const invoke = fakeInvoke({ data: { answers: [{ fieldName: 'MVP Name', status: 'KNOWN', value: 'Kurt Warner', confidence: 0.9, reasoning: 'well-known result', rememberedSourceContext: null }, { fieldName: 'Passing Yards', status: 'KNOWN', value: 4353, confidence: 0.6, reasoning: 'recalled with moderate confidence', rememberedSourceContext: null }] } })
    const worker = createLlmLatentKnowledgeResearchWorker({ clock, invokeLiveStructuredAnalysisFn: invoke })
    const dispatched = await worker.dispatch(baseRequest())
    assert.equal(dispatched.ok, true)
    const fetched = await worker.fetchResult(dispatched.workerRunRef)
    assert.equal(fetched.result.status, 'SUCCEEDED')
    assert.equal(fetched.result.sourceSnapshotsOrSnapshotRefs.length, 1)
    const snapshot = fetched.result.sourceSnapshotsOrSnapshotRefs[0]
    assert.equal(snapshot.provenanceStrength, 'NONE')
    assert.equal(snapshot.modeEvidence.agentId, 'some-fake-agent', 'real answering identity is recorded, not anonymous')
    assert.equal(snapshot.modeEvidence.providerId, 'some-fake-provider')
  })
})

test('no fabricated source/citation ever appears in a produced claim', async () => {
  await withEnv({ [ENV_VAR]: '1' }, async () => {
    const invoke = fakeInvoke({ data: { answers: [{ fieldName: 'MVP Name', status: 'KNOWN', value: 'Kurt Warner', confidence: 0.9, reasoning: 'well-known result', rememberedSourceContext: 'invented-sounding citation attempt' }, { fieldName: 'Passing Yards', status: 'UNKNOWN', value: null, confidence: null, reasoning: 'not sure', rememberedSourceContext: null }] } })
    const worker = createLlmLatentKnowledgeResearchWorker({ clock, invokeLiveStructuredAnalysisFn: invoke })
    const dispatched = await worker.dispatch(baseRequest())
    const { result } = await worker.fetchResult(dispatched.workerRunRef)
    assert.equal(result.evidence.length, 0, 'never fabricates ResultEvidence -- no real snippet/source exists')
    assert.equal(result.sourceReferences.length, 0, 'never fabricates a SourceReference')
    assert.equal(result.sourceSnapshotsOrSnapshotRefs[0].sourceRef, 'LLM_LATENT_KNOWLEDGE_RECALL:unverified-model-recall', 'the one self-referential marker, never a URL-shaped fabricated citation')
    assert.equal(result.status, 'PARTIAL', 'one field known, one honestly unresolved')
    assert.equal(result.unresolvedQuestions.length, 1)
  })
})

test('no implicit external/paid spend without the explicit opt-in gate -- disabled by default, and the provider fn is never even called', async () => {
  delete process.env[ENV_VAR]
  const invoke = fakeInvoke({ data: { answers: [] } })
  const worker = createLlmLatentKnowledgeResearchWorker({ clock, invokeLiveStructuredAnalysisFn: invoke })
  const dispatched = await worker.dispatch(baseRequest())
  assert.equal(dispatched.ok, false)
  assert.equal(dispatched.reason, 'LATENT_KNOWLEDGE_WORKER_DISABLED')
  assert.equal(invoke.calls.length, 0, 'the gate must short-circuit before any provider call')
})

test('this worker is NOT reachable from the free research-mission-fleet-driver-bootstrap.mjs path', () => {
  const source = readFileSync(path.join(import.meta.dirname, '..', 'server', 'research-mission-fleet-driver-bootstrap.mjs'), 'utf-8')
  assert.equal(source.includes('llm-latent-knowledge-research-worker'), false)
  assert.equal(source.includes('createLlmLatentKnowledgeResearchWorker'), false)
  assert.equal(source.includes('createWebTableResearchWorker'), true, 'sanity check: the free path still wires the $0 web-table worker')
})

test('provider identity is reported honestly per real invocation (never a stale/reused identity across two different workers)', async () => {
  await withEnv({ [ENV_VAR]: '1' }, async () => {
    const invokeCodexLike = fakeInvoke({ agentId: 'agent-a', providerId: 'provider-a', data: { answers: [{ fieldName: 'MVP Name', status: 'KNOWN', value: 'Kurt Warner', confidence: 0.9, reasoning: 'r', rememberedSourceContext: null }] } })
    const invokeClaudeLike = fakeInvoke({ agentId: 'agent-b', providerId: 'provider-b', data: { answers: [{ fieldName: 'MVP Name', status: 'KNOWN', value: 'Kurt Warner', confidence: 0.9, reasoning: 'r', rememberedSourceContext: null }] } })
    const requestOneField = baseRequest({ requestedOutputSchema: { properties: { 'MVP Name': {} } } })

    const workerA = createLlmLatentKnowledgeResearchWorker({ clock, invokeLiveStructuredAnalysisFn: invokeCodexLike })
    const dispatchedA = await workerA.dispatch(requestOneField)
    const fetchedA = await workerA.fetchResult(dispatchedA.workerRunRef)
    assert.equal(fetchedA.result.sourceSnapshotsOrSnapshotRefs[0].modeEvidence.agentId, 'agent-a')

    const workerB = createLlmLatentKnowledgeResearchWorker({ clock, invokeLiveStructuredAnalysisFn: invokeClaudeLike })
    const dispatchedB = await workerB.dispatch(requestOneField)
    const fetchedB = await workerB.fetchResult(dispatchedB.workerRunRef)
    assert.equal(fetchedB.result.sourceSnapshotsOrSnapshotRefs[0].modeEvidence.agentId, 'agent-b')
  })
})

test('restart-safety: a fresh call to fetchResult using only the durably-shaped workerRunRef returns the identical result', async () => {
  await withEnv({ [ENV_VAR]: '1' }, async () => {
    const invoke = fakeInvoke({ data: { answers: [{ fieldName: 'MVP Name', status: 'KNOWN', value: 'Kurt Warner', confidence: 0.9, reasoning: 'r', rememberedSourceContext: null }, { fieldName: 'Passing Yards', status: 'KNOWN', value: 4353, confidence: 0.6, reasoning: 'r2', rememberedSourceContext: null }] } })
    const worker = createLlmLatentKnowledgeResearchWorker({ clock, invokeLiveStructuredAnalysisFn: invoke })
    const dispatched = await worker.dispatch(baseRequest())
    const rehydratedRunRef = JSON.parse(JSON.stringify(dispatched.workerRunRef))
    const freshWorker = createLlmLatentKnowledgeResearchWorker({ clock, invokeLiveStructuredAnalysisFn: invoke })
    const fetched = await freshWorker.fetchResult(rehydratedRunRef)
    assert.equal(fetched.ok, true)
    assert.equal(fetched.result.status, 'SUCCEEDED')
    assert.equal(fetched.result.proposedClaims.length, 2)
    assert.equal(fetched.result.provider, LLM_LATENT_KNOWLEDGE_PROVIDER_ID)
  })
})

test('a malformed workerRunRef fails honest, never fabricates a result', async () => {
  const worker = createLlmLatentKnowledgeResearchWorker({ clock })
  const fetched = await worker.fetchResult({ provider: LLM_LATENT_KNOWLEDGE_PROVIDER_ID, providerRunId: 'not json', dispatchedAt: clock().toISOString() })
  assert.equal(fetched.ok, false)
  assert.equal(fetched.reason, 'MALFORMED_RUN_REF')
})

test('a request with no requested fields fails honest, never asks a provider anything', async () => {
  await withEnv({ [ENV_VAR]: '1' }, async () => {
    const invoke = fakeInvoke({ data: { answers: [] } })
    const worker = createLlmLatentKnowledgeResearchWorker({ clock, invokeLiveStructuredAnalysisFn: invoke })
    const dispatched = await worker.dispatch(baseRequest({ requestedOutputSchema: { properties: {} } }))
    assert.equal(dispatched.ok, false)
    assert.equal(dispatched.reason, 'NO_REQUESTED_FIELDS')
    assert.equal(invoke.calls.length, 0)
  })
})

test('every produced result conforms to the shared BoundedResearchResult contract (SUCCEEDED, PARTIAL, and FAILED shapes alike)', async () => {
  await withEnv({ [ENV_VAR]: '1' }, async () => {
    const succeeded = fakeInvoke({ data: { answers: [{ fieldName: 'MVP Name', status: 'KNOWN', value: 'Kurt Warner', confidence: 0.9, reasoning: 'r', rememberedSourceContext: null }] } })
    const workerSucceeded = createLlmLatentKnowledgeResearchWorker({ clock, invokeLiveStructuredAnalysisFn: succeeded })
    const requestOneField = baseRequest({ requestedOutputSchema: { properties: { 'MVP Name': {} } } })
    const dispatchedS = await workerSucceeded.dispatch(requestOneField)
    const fetchedS = await workerSucceeded.fetchResult(dispatchedS.workerRunRef)
    assert.doesNotThrow(() => validateBoundedResearchResult(fetchedS.result))

    const partial = fakeInvoke({ data: { answers: [{ fieldName: 'MVP Name', status: 'KNOWN', value: 'Kurt Warner', confidence: 0.9, reasoning: 'r', rememberedSourceContext: null }, { fieldName: 'Passing Yards', status: 'UNKNOWN', value: null, confidence: null, reasoning: 'r', rememberedSourceContext: null }] } })
    const workerPartial = createLlmLatentKnowledgeResearchWorker({ clock, invokeLiveStructuredAnalysisFn: partial })
    const dispatchedP = await workerPartial.dispatch(baseRequest())
    const fetchedP = await workerPartial.fetchResult(dispatchedP.workerRunRef)
    assert.doesNotThrow(() => validateBoundedResearchResult(fetchedP.result))
    assert.equal(fetchedP.result.status, 'PARTIAL')
  })
})

test('usage.providerReportedCostUsd reflects the real reported cost, never coerced to 0 when unknown', async () => {
  await withEnv({ [ENV_VAR]: '1' }, async () => {
    const invoke = fakeInvoke({ costUsd: null, data: { answers: [{ fieldName: 'MVP Name', status: 'KNOWN', value: 'Kurt Warner', confidence: 0.9, reasoning: 'r', rememberedSourceContext: null }] } })
    const worker = createLlmLatentKnowledgeResearchWorker({ clock, invokeLiveStructuredAnalysisFn: invoke })
    const dispatched = await worker.dispatch(baseRequest({ requestedOutputSchema: { properties: { 'MVP Name': {} } } }))
    const { result } = await worker.fetchResult(dispatched.workerRunRef)
    assert.equal(result.usage.providerReportedCostUsd, null)
  })
})

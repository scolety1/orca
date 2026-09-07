import assert from 'node:assert/strict'
import test from 'node:test'
import path from 'node:path'
import { reconcileFieldsToHeaders } from '../server/field-source-reconciliation.mjs'

const HERE = import.meta.dirname
const STUB = path.join(HERE, 'fixtures', 'stub-planner-cli.mjs')
const NONEXISTENT = path.join(HERE, 'fixtures', 'does-not-exist-binary')
const headers = ['Year', 'Maximum team salary', 'Team Record']

// Finding F1: forces HEALTHY host memory for every test in this file except
// the ones below that deliberately override deps.collectHostMemoryEvidence
// (which takes precedence) -- mirrors chat-dispatch-bridge.test.mjs's own
// convention, keeping this file's other assertions immune to a genuinely
// shared, loaded host.
process.env.TSF_RESOURCE_PRESSURE_TEST_TOTAL_BYTES = String(16 * 1024 ** 3)
process.env.TSF_RESOURCE_PRESSURE_TEST_FREE_BYTES = String(8 * 1024 ** 3)

async function withStubEnv(vars, fn) {
  const prior = {}
  for (const key of Object.keys(vars)) prior[key] = process.env[key]
  Object.assign(process.env, vars)
  try {
    return await fn()
  } finally {
    for (const key of Object.keys(vars)) {
      if (prior[key] === undefined) delete process.env[key]
      else process.env[key] = prior[key]
    }
  }
}

test('no unresolved fields means no live call at all', async () => {
  const bindings = await reconcileFieldsToHeaders({ headers, unresolvedFieldNames: [], sourceIdentity: 'https://example.com' })
  assert.deepEqual(bindings, [])
})

test('Salary Cap resolves to the real header Maximum team salary via bounded semantic reconciliation', async () => {
  await withStubEnv({ TSF_PLANNER_CLAUDE_COMMAND: STUB, TSF_PLANNER_CODEX_COMMAND: NONEXISTENT, STUB_MODE: 'success', STUB_RECONCILE_MODE: 'match' }, async () => {
    const bindings = await reconcileFieldsToHeaders({ headers, unresolvedFieldNames: ['Salary Cap'], sourceIdentity: 'https://example.com/cap' })
    assert.equal(bindings.length, 1)
    assert.equal(bindings[0].canonicalField, 'Salary Cap')
    assert.equal(bindings[0].rawHeader, 'Maximum team salary')
    assert.equal(bindings[0].reconciliationMethod, 'BOUNDED_SEMANTIC')
    assert.equal(bindings[0].sourceIdentity, 'https://example.com/cap')
  })
})

test('anti-hallucination gate: a matchedHeader not verbatim in the given headers is discarded, never trusted', async () => {
  await withStubEnv({ TSF_PLANNER_CLAUDE_COMMAND: STUB, TSF_PLANNER_CODEX_COMMAND: NONEXISTENT, STUB_MODE: 'success', STUB_RECONCILE_MODE: 'hallucinate' }, async () => {
    const bindings = await reconcileFieldsToHeaders({ headers, unresolvedFieldNames: ['Salary Cap'], sourceIdentity: 'https://example.com/cap' })
    assert.deepEqual(bindings, [])
  })
})

test('an ambiguous field (matchedHeader: null) stays unresolved, never defaulted to a guess', async () => {
  await withStubEnv({ TSF_PLANNER_CLAUDE_COMMAND: STUB, TSF_PLANNER_CODEX_COMMAND: NONEXISTENT, STUB_MODE: 'success', STUB_RECONCILE_MODE: 'null' }, async () => {
    const bindings = await reconcileFieldsToHeaders({ headers, unresolvedFieldNames: ['Salary Cap'], sourceIdentity: 'https://example.com/cap' })
    assert.equal(bindings.length, 1)
    assert.equal(bindings[0].rawHeader, null)
    assert.equal(bindings[0].reconciliationMethod, 'UNRESOLVED')
  })
})

test('the live planner being unavailable fails closed to no bindings, never a fabricated match', async () => {
  await withStubEnv({ TSF_PLANNER_CLAUDE_COMMAND: NONEXISTENT, TSF_PLANNER_CODEX_COMMAND: NONEXISTENT }, async () => {
    const bindings = await reconcileFieldsToHeaders({ headers, unresolvedFieldNames: ['Salary Cap'], sourceIdentity: 'https://example.com/cap' })
    assert.deepEqual(bindings, [])
  })
})

// Finding F1: reconcileFieldsToHeaders was one of 5 real invokeLiveStructuredAnalysis
// call sites never consulting the Resource Pressure Governor before spawning
// a heavyweight LLM-CLI child process.
test('CRITICAL host memory refuses the spawn and fails closed to no bindings, same shape as an unavailable planner', async () => {
  await withStubEnv({ TSF_PLANNER_CLAUDE_COMMAND: STUB, TSF_PLANNER_CODEX_COMMAND: NONEXISTENT, STUB_MODE: 'success', STUB_RECONCILE_MODE: 'match' }, async () => {
    const bindings = await reconcileFieldsToHeaders({
      headers,
      unresolvedFieldNames: ['Salary Cap'],
      sourceIdentity: 'https://example.com/cap',
      deps: { collectHostMemoryEvidence: () => ({ availableBytes: 1.6 * 1024 ** 3 }) } // 1.6 GB free -> CRITICAL
    })
    assert.deepEqual(bindings, [])
  })
})

test('HEALTHY host memory still dispatches the real reconciliation call', async () => {
  await withStubEnv({ TSF_PLANNER_CLAUDE_COMMAND: STUB, TSF_PLANNER_CODEX_COMMAND: NONEXISTENT, STUB_MODE: 'success', STUB_RECONCILE_MODE: 'match' }, async () => {
    const bindings = await reconcileFieldsToHeaders({
      headers,
      unresolvedFieldNames: ['Salary Cap'],
      sourceIdentity: 'https://example.com/cap',
      deps: { collectHostMemoryEvidence: () => ({ availableBytes: 8 * 1024 ** 3 }) } // 8 GB free -> HEALTHY
    })
    assert.equal(bindings.length, 1)
    assert.equal(bindings[0].rawHeader, 'Maximum team salary')
  })
})

// Global Command Dock V1: route context is a bounded fallback, never a
// forced scope -- only consulted when the message named zero projects,
// and only acted on when the SAME authoritative classifier respondCommand
// itself uses says the message genuinely needs a project.
import assert from 'node:assert/strict'
import test from 'node:test'
import path from 'node:path'

const HERE = import.meta.dirname
const PLANNER_STUB = path.join(HERE, 'fixtures', 'stub-planner-cli.mjs')
const NONEXISTENT = path.join(HERE, 'fixtures', 'does-not-exist-binary')

// Finding F1: classifyGlobalScope now consults the Resource Pressure
// Governor -- forces HEALTHY so this file's own assertions never flake on a
// genuinely shared, loaded host, mirroring chat-dispatch-bridge.test.mjs.
process.env.TSF_RESOURCE_PRESSURE_TEST_TOTAL_BYTES = String(16 * 1024 ** 3)
process.env.TSF_RESOURCE_PRESSURE_TEST_FREE_BYTES = String(8 * 1024 ** 3)

const { resolveRouteContextFallback } = await import('../server/chat-route-context-fallback.mjs')

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

const map = new Map([['proj-1', { id: 'proj-1', displayName: 'Niners War Room', sourceClass: 'REAL' }]])

test('no contextProjectId -> null, no live call made', async () => {
  const result = await resolveRouteContextFallback({ message: 'fix this project\'s health', contextProjectId: undefined, map })
  assert.equal(result, null)
})

test('a contextProjectId that does not resolve to a real known project -> null', async () => {
  const result = await resolveRouteContextFallback({ message: 'fix this project\'s health', contextProjectId: 'unknown-id', map })
  assert.equal(result, null)
})

test('PROJECT_REQUIRED classification -> the route context project is used', async () => {
  await withStubEnv({ TSF_PLANNER_CLAUDE_COMMAND: PLANNER_STUB, TSF_PLANNER_CODEX_COMMAND: NONEXISTENT, STUB_MODE: 'success', STUB_SCOPE_OVERRIDE: 'PROJECT_REQUIRED' }, async () => {
    const result = await resolveRouteContextFallback({ message: 'fix this project\'s health', contextProjectId: 'proj-1', map })
    assert.equal(result?.id, 'proj-1')
  })
})

test('GLOBAL_STATUS classification -> route context is ignored, stays global ("what\'s running right now" example)', async () => {
  await withStubEnv({ TSF_PLANNER_CLAUDE_COMMAND: PLANNER_STUB, TSF_PLANNER_CODEX_COMMAND: NONEXISTENT, STUB_MODE: 'success', STUB_SCOPE_OVERRIDE: 'GLOBAL_STATUS' }, async () => {
    const result = await resolveRouteContextFallback({ message: "what's running right now", contextProjectId: 'proj-1', map })
    assert.equal(result, null)
  })
})

for (const scope of ['GLOBAL_ADVISORY', 'NEEDS_YOU_QUERY', 'RESEARCH_REQUEST', 'UNCLEAR']) {
  test(`${scope} classification -> route context is never used`, async () => {
    await withStubEnv({ TSF_PLANNER_CLAUDE_COMMAND: PLANNER_STUB, TSF_PLANNER_CODEX_COMMAND: NONEXISTENT, STUB_MODE: 'success', STUB_SCOPE_OVERRIDE: scope }, async () => {
      const result = await resolveRouteContextFallback({ message: 'something ambiguous', contextProjectId: 'proj-1', map })
      assert.equal(result, null)
    })
  })
}

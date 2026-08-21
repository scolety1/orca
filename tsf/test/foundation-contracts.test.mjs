import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const readJson = async (path) => JSON.parse(await readFile(new URL(path, import.meta.url), 'utf8'))

test('Orca plugin registers bounded TSF commands and events', async () => {
  const manifest = await readJson('../orca-plugin.json')
  assert.equal(manifest.pluginApi, 1)
  assert.equal(manifest.engines.orca, '>=1.4.184')
  assert.deepEqual(manifest.capabilities.map((item) => item.kind).sort(), [
    'events:subscribe',
    'storage',
    'workspace:read'
  ])
  const handlers = new Map()
  const events = new Map()
  const plugin = await import('../main.mjs')
  // M6: activate() now also spawns tsf/server as a real child process (see
  // server-process-lifecycle.mjs) -- this test's own concern is command/
  // event registration, not the server lifecycle (covered by its own
  // tsf/test/main-plugin.test.mjs), so a fake spawnFn keeps this test
  // hermetic and avoids leaking a real, ref'd child process that would
  // otherwise keep this test file's process alive indefinitely.
  plugin.default(
    {
      commands: { register: (id, handler) => handlers.set(id, handler) },
      events: { on: (id, handler) => events.set(id, handler) },
      host: { call: async () => ({ value: null }) },
      log: () => {}
    },
    { spawnFn: () => ({ stdout: null, stderr: null, on: () => {}, kill: () => {} }) }
  )
  try {
    assert.deepEqual(await handlers.get('tsf-foundation-health')(), plugin.FOUNDATION)
    assert.equal(handlers.size, 3)
    assert.equal(events.size, 3)
  } finally {
    plugin.deactivate()
  }
})

test('provider roles are complete and mappings remain configuration', async () => {
  const mappings = await readJson('../routing/provider-role-mappings.v1.json')
  assert.deepEqual(Object.keys(mappings.roles).sort(), [
    'PLANNER_BALANCED',
    'PLANNER_DEEP',
    'VERIFIER_INDEPENDENT',
    'WORKER_BALANCED',
    'WORKER_CHEAP',
    'WORKER_DEEP'
  ])
  assert.equal(mappings.experimentalHypothesis.contractual, false)
})

test('safe profiles contain no permanent bypass', async () => {
  const profiles = await readJson('../providers/launch-profiles.v1.json')
  const serialized = JSON.stringify(profiles).toLowerCase()
  assert.equal(serialized.includes('dangerously-bypass'), false)
  assert.equal(serialized.includes('danger-full-access'), false)
  assert.equal(profiles.profiles.CODEX_SAFE.blanketBypass, false)
  assert.equal(profiles.profiles.CLAUDE_SAFE.blanketBypass, false)
  assert.equal(profiles.profiles.CODEX_SAFE.codexHomePolicy, 'TSF_CODEX_HOME_OR_USER_DEFAULT')
  assert.equal(profiles.profiles.CODEX_SAFE.status, 'VALIDATED_WINDOWS_FIXTURE')
})

test('session affinity and compact handoff contracts parse', async () => {
  const affinity = await readJson('../contracts/session-affinity.v1.json')
  const plan = await readJson('../contracts/plan-capsule.schema.v1.json')
  const result = await readJson('../contracts/result-capsule.schema.v1.json')
  assert.equal(affinity.routingPrinciple, 'CHANGE_AT_BOUNDARIES_NOT_PER_TURN')
  assert.ok(plan.required.includes('prohibitedActions'))
  assert.ok(plan.required.includes('stopConditions'))
  assert.ok(result.required.includes('evidence'))
  assert.ok(result.required.includes('recommendedNextStep'))
  assert.equal(plan.properties.expectedResultFormat.const, 'TSF_RESULT_CAPSULE_V1')
})

test('migration manifest preserves 111 unique capability IDs with coverage', async () => {
  const migration = await readJson('../migration/capability-migration.v1.json')
  const ids = migration.capabilities.map((entry) => entry.id)
  assert.equal(ids.length, 111)
  assert.equal(new Set(ids).size, 111)
  for (const entry of migration.capabilities) {
    assert.ok(entry.legacyDisposition)
    assert.ok(entry.legacySources)
    assert.ok(entry.orcaFit)
    assert.ok(entry.proposedWave !== null || ['REFERENCE_ONLY', 'REJECTED'].includes(entry.state))
  }
  assert.equal(migration.summary.TOTAL, 111)
  assert.equal(
    Object.values(migration.summary)
      .filter((value) => typeof value === 'number')
      .reduce((a, b) => a + b, 0),
    222
  )
  assert.deepEqual(migration.allowedStates, [
    'UPSTREAM_NATIVE',
    'REUSED_LEGACY_CODE',
    'ADAPTED_LEGACY_CODE',
    'NEW_TSF_OVERLAY',
    'PENDING',
    'REFERENCE_ONLY',
    'REJECTED'
  ])
})

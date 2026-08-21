import assert from 'node:assert/strict'
import test from 'node:test'
import path from 'node:path'
import { fetchCapacitySnapshot } from '../adapters/orca-capacity-bridge.mjs'

const HERE = import.meta.dirname
const ORCA_STUB = path.join(HERE, 'fixtures', 'stub-orca-cli.mjs')
const NONEXISTENT = path.join(HERE, 'fixtures', 'does-not-exist-binary')

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

const STUBBED = { TSF_ORCA_CLI_COMMAND: ORCA_STUB, STUB_ORCA_MODE: 'success' }

test('fetchCapacitySnapshot reshapes a real rateLimits response into the compact policy-facing shape', async () => {
  const rateLimits = {
    claude: { session: { usedPercent: 12 }, weekly: { usedPercent: 34 }, status: 'ok' },
    codex: { weekly: { usedPercent: 91 }, status: 'AT_EXPIRING_CAPACITY_SAFETY_RESERVE' }
  }
  await withEnv({ ...STUBBED, STUB_ORCA_RATE_LIMITS: JSON.stringify(rateLimits) }, async () => {
    const result = await fetchCapacitySnapshot()
    assert.equal(result.ok, true)
    assert.deepEqual(result.result, {
      claude: { sessionUsedPercent: 12, weeklyUsedPercent: 34, status: 'ok' },
      codex: { weeklyUsedPercent: 91, status: 'AT_EXPIRING_CAPACITY_SAFETY_RESERVE' }
    })
  })
})

test('fetchCapacitySnapshot reports null (not a guessed 0%) for a provider missing from the response', async () => {
  await withEnv(
    { ...STUBBED, STUB_ORCA_RATE_LIMITS: JSON.stringify({ claude: null, codex: null }) },
    async () => {
      const result = await fetchCapacitySnapshot()
      assert.equal(result.ok, true)
      assert.deepEqual(result.result, { claude: null, codex: null })
    }
  )
})

test('fetchCapacitySnapshot fails honestly when the CLI is unreachable, never fabricating a snapshot', async () => {
  await withEnv({ TSF_ORCA_CLI_COMMAND: NONEXISTENT }, async () => {
    const result = await fetchCapacitySnapshot()
    assert.equal(result.ok, false)
    assert.equal(result.reason, 'SPAWN_ERROR')
  })
})

test('fetchCapacitySnapshot surfaces a deliberate CLI error without fabricating success', async () => {
  await withEnv({ ...STUBBED, STUB_ORCA_MODE: 'error' }, async () => {
    const result = await fetchCapacitySnapshot()
    assert.equal(result.ok, false)
    assert.equal(result.reason, 'CLI_ERROR')
  })
})

test('fetchCapacitySnapshot surfaces a malformed CLI response without fabricating success', async () => {
  await withEnv({ ...STUBBED, STUB_ORCA_MODE: 'malformed' }, async () => {
    const result = await fetchCapacitySnapshot()
    assert.equal(result.ok, false)
    assert.equal(result.reason, 'MALFORMED_RESPONSE')
  })
})

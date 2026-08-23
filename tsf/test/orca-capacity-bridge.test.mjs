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
      claude: {
        sessionUsedPercent: 12,
        sessionResetsAt: null,
        sessionResetDescription: null,
        weeklyUsedPercent: 34,
        weeklyResetsAt: null,
        weeklyResetDescription: null,
        status: 'ok'
      },
      codex: {
        weeklyUsedPercent: 91,
        weeklyResetsAt: null,
        weeklyResetDescription: null,
        status: 'AT_EXPIRING_CAPACITY_SAFETY_RESERVE'
      }
    })
  })
})

// Real V1 stabilization finding (Operator UX pass): the CLI response
// already carries real reset timing that fetchCapacitySnapshot used to
// drop -- the Capacity view needs it to show a real "resets in Xh Ym"
// rather than an honest-but-useless UNKNOWN.
test('fetchCapacitySnapshot surfaces real reset timing for both session and weekly windows', async () => {
  const rateLimits = {
    claude: {
      session: { usedPercent: 33, resetsAt: 1787526600000, resetDescription: '5:10 PM' },
      weekly: { usedPercent: 10, resetsAt: 1787994000000, resetDescription: 'Sat 3:00 AM' },
      status: 'ok'
    },
    codex: {
      weekly: { usedPercent: 2, resetsAt: 1787809139000, resetDescription: 'Wed 11:38 PM' },
      status: 'ok'
    }
  }
  await withEnv({ ...STUBBED, STUB_ORCA_RATE_LIMITS: JSON.stringify(rateLimits) }, async () => {
    const result = await fetchCapacitySnapshot()
    assert.equal(result.ok, true)
    assert.equal(result.result.claude.sessionResetsAt, 1787526600000)
    assert.equal(result.result.claude.sessionResetDescription, '5:10 PM')
    assert.equal(result.result.claude.weeklyResetsAt, 1787994000000)
    assert.equal(result.result.claude.weeklyResetDescription, 'Sat 3:00 AM')
    assert.equal(result.result.codex.weeklyResetsAt, 1787809139000)
    assert.equal(result.result.codex.weeklyResetDescription, 'Wed 11:38 PM')
    // Existing policy-facing fields untouched by the addition.
    assert.equal(result.result.claude.sessionUsedPercent, 33)
    assert.equal(result.result.codex.weeklyUsedPercent, 2)
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

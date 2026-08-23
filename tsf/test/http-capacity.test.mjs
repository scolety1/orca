// GET /api/capacity -- real end-to-end HTTP coverage over the compact
// Operator UX Capacity view. Pure route glue: no second capacity
// subsystem, only reshapes fetchCapacitySnapshot/decideCapacityAction.
import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'node:http'
import path from 'node:path'
import { rmSync } from 'node:fs'

const HERE = import.meta.dirname
const STATE_FILE = path.join(
  HERE,
  '..',
  'server',
  '.local-state',
  `operator-state.test-http-capacity-${process.pid}.json`
)

process.env.TSF_UI_STATE_FILE = STATE_FILE
process.env.TSF_PLANNER_CLAUDE_COMMAND = path.join(HERE, 'fixtures', 'does-not-exist-binary')
process.env.TSF_PLANNER_CODEX_COMMAND = path.join(HERE, 'fixtures', 'does-not-exist-binary')
process.env.TSF_ORCA_CLI_COMMAND = path.join(HERE, 'fixtures', 'stub-orca-cli.mjs')
process.env.STUB_ORCA_REPOS = '[]'

const { createRequestHandler } = await import('../server/http-server.mjs')

async function withServer(fn) {
  const handler = createRequestHandler()
  const server = createServer((req, res) =>
    handler(req, res, () => {
      res.writeHead(404)
      res.end()
    })
  )
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  try {
    await fn(`http://127.0.0.1:${port}`)
  } finally {
    await new Promise((resolve) => server.close(resolve))
    rmSync(STATE_FILE, { force: true })
    rmSync(`${STATE_FILE}.tmp`, { force: true })
  }
}

async function get(base, urlPath) {
  const res = await fetch(`${base}${urlPath}`)
  return { status: res.status, body: await res.json() }
}

test('REQUIRED PROOF: GET /api/capacity reshapes a real rateLimits response end to end, including reset timing', async () => {
  process.env.STUB_ORCA_MODE = 'success'
  process.env.STUB_ORCA_RATE_LIMITS = JSON.stringify({
    claude: {
      session: { usedPercent: 33, resetsAt: 1787526600000, resetDescription: '5:10 PM' },
      weekly: { usedPercent: 10, resetsAt: 1787994000000, resetDescription: 'Sat 3:00 AM' },
      status: 'ok'
    },
    codex: {
      weekly: { usedPercent: 87, resetsAt: 1787809139000, resetDescription: 'Wed 11:38 PM' },
      status: 'ok'
    }
  })
  try {
    await withServer(async (base) => {
      const res = await get(base, '/api/capacity')
      assert.equal(res.status, 200)
      assert.equal(res.body.ok, true)
      assert.equal(res.body.available, true)
      assert.equal(res.body.claude.available, true)
      assert.equal(res.body.claude.primaryRole, 'Planner')
      // Top-level remainingPercent uses the worse (higher-used) of session
      // vs weekly, mirroring decideCapacityAction's own "worse of the two
      // governs" logic -- session at 33% used is worse than weekly at 10%.
      assert.equal(res.body.claude.remainingPercent, 67)
      assert.equal(res.body.claude.session.remainingPercent, 67)
      assert.equal(res.body.claude.session.resetDescription, '5:10 PM')
      assert.equal(res.body.claude.weekly.remainingPercent, 90)
      assert.ok(res.body.claude.capacityAction)
      assert.equal(res.body.codex.available, true)
      assert.equal(res.body.codex.primaryRole, 'Implementation worker')
      assert.equal(res.body.codex.remainingPercent, 13)
      assert.ok(res.body.observedAt)
    })
  } finally {
    delete process.env.STUB_ORCA_RATE_LIMITS
  }
})

test('a provider missing from the real response is honestly unavailable, never a fabricated 0%/100%', async () => {
  process.env.STUB_ORCA_MODE = 'success'
  process.env.STUB_ORCA_RATE_LIMITS = JSON.stringify({ claude: null, codex: null })
  try {
    await withServer(async (base) => {
      const res = await get(base, '/api/capacity')
      assert.equal(res.status, 200)
      assert.equal(res.body.claude.available, false)
      assert.equal(res.body.claude.primaryRole, 'Planner')
      assert.equal(res.body.codex.available, false)
    })
  } finally {
    delete process.env.STUB_ORCA_RATE_LIMITS
  }
})

test('an unreachable Orca CLI reports honest UNKNOWN capacity, not a server error', async () => {
  const original = process.env.TSF_ORCA_CLI_COMMAND
  process.env.TSF_ORCA_CLI_COMMAND = path.join(HERE, 'fixtures', 'does-not-exist-binary')
  try {
    await withServer(async (base) => {
      const res = await get(base, '/api/capacity')
      assert.equal(res.status, 200)
      assert.equal(res.body.ok, true)
      assert.equal(res.body.available, false)
      assert.ok(res.body.reason)
    })
  } finally {
    process.env.TSF_ORCA_CLI_COMMAND = original
  }
})

test('a real AT_EXPIRING_CAPACITY_SAFETY_RESERVE status is honestly reflected in the capacityAction', async () => {
  process.env.STUB_ORCA_MODE = 'success'
  process.env.STUB_ORCA_RATE_LIMITS = JSON.stringify({
    claude: null,
    codex: { weekly: { usedPercent: 91 }, status: 'AT_EXPIRING_CAPACITY_SAFETY_RESERVE' }
  })
  try {
    await withServer(async (base) => {
      const res = await get(base, '/api/capacity')
      assert.equal(res.status, 200)
      assert.equal(res.body.codex.capacityAction.action, 'PAUSE_AND_CHECKPOINT')
    })
  } finally {
    delete process.env.STUB_ORCA_RATE_LIMITS
  }
})

test('POST /api/capacity is not a route -- honest 404, not a silent no-op', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/api/capacity`, { method: 'POST' })
    assert.equal(res.status, 404)
  })
})

import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'node:http'
import path from 'node:path'
import { rmSync } from 'node:fs'

const HERE = import.meta.dirname
const PLANNER_STUB = path.join(HERE, 'fixtures', 'stub-planner-cli.mjs')
const ORCA_STUB = path.join(HERE, 'fixtures', 'stub-orca-cli.mjs')
const NONEXISTENT = path.join(HERE, 'fixtures', 'does-not-exist-binary')
const STATE_FILE = path.join(
  HERE,
  '..',
  'server',
  '.local-state',
  `operator-state.test-http-estimate-client-${process.pid}.json`
)

process.env.TSF_UI_STATE_FILE = STATE_FILE
process.env.TSF_PLANNER_CLAUDE_COMMAND = PLANNER_STUB
process.env.TSF_PLANNER_CODEX_COMMAND = NONEXISTENT
process.env.STUB_MODE = 'success'
process.env.TSF_ORCA_CLI_COMMAND = ORCA_STUB
process.env.STUB_ORCA_MODE = 'success'
process.env.STUB_ORCA_REPOS = '[]'
// Finding F1: generateWbs now consults the Resource Pressure Governor --
// forces HEALTHY so this file's own assertions never flake on a genuinely
// shared, loaded host, mirroring chat-dispatch-bridge.test.mjs's convention.
process.env.TSF_RESOURCE_PRESSURE_TEST_TOTAL_BYTES = String(16 * 1024 ** 3)
process.env.TSF_RESOURCE_PRESSURE_TEST_FREE_BYTES = String(8 * 1024 ** 3)

const { createRequestHandler } = await import('../server/http-server.mjs')
const { FIXTURE_PROJECT_ID } = await import('../server/fixture-project.mjs')
const { loadState, saveState } = await import('../server/data-store.mjs')
const { createOvernightRun } = await import('../domain/keep-going.mjs')

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

async function post(base, urlPath, body = {}) {
  const res = await fetch(`${base}${urlPath}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  })
  return { status: res.status, body: await res.json() }
}

async function get(base, urlPath) {
  const res = await fetch(`${base}${urlPath}`)
  return { status: res.status, body: await res.json() }
}

test('GET .../estimate/client on a project with no estimate on file is an honest 422', async () => {
  await withServer(async (base) => {
    const res = await get(base, `/api/projects/${FIXTURE_PROJECT_ID}/estimate/client`)
    assert.equal(res.status, 422)
    assert.equal(res.body.error, 'NO_ESTIMATE_ON_FILE_FOR_PROJECT')
  })
})

test('REQUIRED PROOF: a real generated estimate produces a client-facing view over real HTTP that never carries any internal-only field', async () => {
  await withServer(async (base) => {
    const generated = await post(base, `/api/projects/${FIXTURE_PROJECT_ID}/estimate`, {
      startDate: '2026-01-05T00:00:00.000Z'
    })
    assert.equal(generated.status, 200)
    // Wave 12 fields present on the internal estimate.
    assert.ok('competingCommitments' in generated.body.estimate)
    assert.ok('providerForecast' in generated.body.estimate)

    const client = await get(base, `/api/projects/${FIXTURE_PROJECT_ID}/estimate/client`)
    assert.equal(client.status, 200)
    assert.equal(client.body.clientEstimate.schemaVersion, 'TSF_CLIENT_ESTIMATE_V1')
    assert.ok(client.body.clientEstimate.scope.length > 0)
    assert.deepEqual(client.body.clientEstimate.pricing, {
      configured: false,
      reason: 'NO_PRICING_POLICY_CONFIGURED'
    })
    for (const internalField of [
      'providerForecast',
      'costForecast',
      'calibration',
      'competingCommitments'
    ]) {
      assert.equal(internalField in client.body.clientEstimate, false)
    }
  })
})

test('REQUIRED PROOF (existing competing Work Set commitments): a real second Work Set project with an active run is honestly disclosed on the estimate, without pretending to schedule around it', async () => {
  await withServer(async (base) => {
    const state = loadState()
    const otherRun = createOvernightRun(
      {
        id: 'other-run',
        projectId: 'weird-talent-marketplace',
        originalGoal: 'ship the marketplace feature',
        acceptanceCriteria: ['done'],
        usageMode: 'BALANCED'
      },
      () => new Date('2026-01-01T00:00:00.000Z')
    )
    saveState({
      ...state,
      keepGoingRuns: { ...state.keepGoingRuns, 'weird-talent-marketplace': otherRun }
    })

    const res = await post(base, `/api/projects/${FIXTURE_PROJECT_ID}/estimate`, {
      startDate: '2026-01-05T00:00:00.000Z'
    })
    assert.equal(res.status, 200)
    const { competingCommitments } = res.body.estimate
    assert.equal(competingCommitments.otherActiveRuns.length, 1)
    assert.equal(competingCommitments.otherActiveRuns[0].projectId, 'weird-talent-marketplace')
    // Note explicitly discloses this is not a scheduling attempt.
    assert.match(competingCommitments.note, /does not attempt to schedule/)
  })
})

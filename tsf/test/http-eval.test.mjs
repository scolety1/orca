import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'node:http'
import path from 'node:path'
import { rmSync } from 'node:fs'

const HERE = import.meta.dirname
const PLANNER_STUB = path.join(HERE, 'fixtures', 'stub-planner-cli.mjs')
const NONEXISTENT = path.join(HERE, 'fixtures', 'does-not-exist-binary')
const STATE_FILE = path.join(
  HERE,
  '..',
  'server',
  '.local-state',
  `operator-state.test-http-eval-${process.pid}.json`
)

process.env.TSF_UI_STATE_FILE = STATE_FILE
process.env.TSF_PLANNER_CLAUDE_COMMAND = PLANNER_STUB
process.env.TSF_PLANNER_CODEX_COMMAND = NONEXISTENT
process.env.STUB_MODE = 'success'
process.env.STUB_WBS_MULTI = '1'
process.env.TSF_ORCA_CLI_COMMAND = path.join(HERE, 'fixtures', 'stub-orca-cli.mjs')
process.env.STUB_ORCA_MODE = 'success'
process.env.STUB_ORCA_REPOS = '[]'
// Finding F1: generateWbs now consults the Resource Pressure Governor --
// forces HEALTHY so this file's own assertions never flake on a genuinely
// shared, loaded host, mirroring chat-dispatch-bridge.test.mjs's convention.
process.env.TSF_RESOURCE_PRESSURE_TEST_TOTAL_BYTES = String(16 * 1024 ** 3)
process.env.TSF_RESOURCE_PRESSURE_TEST_FREE_BYTES = String(8 * 1024 ** 3)

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

async function post(base, urlPath) {
  const res = await fetch(`${base}${urlPath}`, { method: 'POST' })
  return { status: res.status, body: await res.json() }
}

async function get(base, urlPath) {
  const res = await fetch(`${base}${urlPath}`)
  return { status: res.status, body: await res.json() }
}

test('GET /api/eval lists all 10 real, registered eval packs (Phase 13 added 2 GOLDEN_PATH packs)', async () => {
  await withServer(async (base) => {
    const res = await get(base, '/api/eval')
    assert.equal(res.status, 200)
    assert.equal(res.body.packs.length, 10)
  })
})

test('an unknown pack id 404s honestly on a sub-route', async () => {
  await withServer(async (base) => {
    const res = await get(base, '/api/eval/not-a-real-pack/history')
    assert.equal(res.status, 404)
  })
})

test('GET /api/eval/:packId/history is honestly empty before any run has ever happened', async () => {
  await withServer(async (base) => {
    const res = await get(base, '/api/eval/worker-basics/history')
    assert.equal(res.status, 200)
    assert.deepEqual(res.body.runs, [])
  })
})

test('REQUIRED PROOF: POST /api/eval/:packId/run actually runs the real pack, persists it, and a later GET sees it', async () => {
  await withServer(async (base) => {
    const ran = await post(base, '/api/eval/worker-basics/run')
    assert.equal(ran.status, 200)
    assert.equal(ran.body.run.passRate, 1)

    const history = await get(base, '/api/eval/worker-basics/history')
    assert.equal(history.body.runs.length, 1)
    assert.equal(history.body.runs[0].packId, 'worker-basics')
  })
})

test('POST /api/eval/:packId/regression-check is an honest 422 (NO_BASELINE_YET) before any prior run exists', async () => {
  await withServer(async (base) => {
    const res = await post(base, '/api/eval/autonomy-basics/regression-check')
    assert.equal(res.status, 422)
    assert.equal(res.body.error, 'NO_BASELINE_YET')
  })
})

test('REQUIRED PROOF: regression-check compares a real fresh run against the real prior run and persists the new run alongside the old one', async () => {
  await withServer(async (base) => {
    const first = await post(base, '/api/eval/routing-basics/run')
    assert.equal(first.status, 200)

    const checked = await post(base, '/api/eval/routing-basics/regression-check')
    assert.equal(checked.status, 200)
    assert.equal(checked.body.comparison.packId, 'routing-basics')
    assert.equal(checked.body.comparison.recommendation, 'PROMOTE')

    // Both the original run and the regression-check's own fresh run
    // are now in history -- never overwritten.
    const history = await get(base, '/api/eval/routing-basics/history')
    assert.equal(history.body.runs.length, 2)
  })
})

test('the real, live planner pack (which invokes the real generateWbs stub call) runs end to end over HTTP', async () => {
  await withServer(async (base) => {
    const res = await post(base, '/api/eval/planner-basics/run')
    assert.equal(res.status, 200)
    assert.equal(res.body.run.passRate, 1)
  })
})

test("REQUIRED PROOF: a concurrent run landing while regression-check's own real (slow) pack run is still in flight is reflected as the comparison baseline, not the stale pre-request one", async () => {
  await withServer(async (base) => {
    const first = await post(base, '/api/eval/planner-basics/run')
    assert.equal(first.status, 200)

    // Forces entry.run's own real generateWbs call to take several real
    // seconds (a genuine subprocess sleep, not a microtask tick) --
    // giving a wide, reliable window for a concurrent write to land
    // during regression-check's own await, exactly like a second
    // request's real run completing in between.
    const priorMode = process.env.STUB_MODE
    process.env.STUB_MODE = 'timeout'
    try {
      const checkPromise = post(base, '/api/eval/planner-basics/regression-check')

      await new Promise((resolve) => setTimeout(resolve, 500))
      const { loadState, saveState } = await import('../server/data-store.mjs')
      const injectedRun = {
        schemaVersion: 'TSF_EVAL_RUN_RESULT_V1',
        packId: 'planner-basics',
        packVersion: 1,
        category: 'PLANNER',
        runAt: 'RACE_INJECTED_BASELINE',
        totalCases: 1,
        passedCases: 1,
        failedCases: 0,
        passRate: 1,
        results: [{ caseId: 'race-case', passed: true, errored: false, assertionResults: [] }]
      }
      const state = loadState()
      saveState({
        ...state,
        evalRuns: {
          ...state.evalRuns,
          'planner-basics': [...(state.evalRuns['planner-basics'] ?? []), injectedRun]
        }
      })

      const checked = await checkPromise
      assert.equal(checked.status, 200)
      assert.equal(checked.body.comparison.baselineRunAt, 'RACE_INJECTED_BASELINE')
    } finally {
      process.env.STUB_MODE = priorMode
    }
  })
})

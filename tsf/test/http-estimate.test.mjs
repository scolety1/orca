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
  `operator-state.test-http-estimate-${process.pid}.json`
)

process.env.TSF_UI_STATE_FILE = STATE_FILE
process.env.TSF_PLANNER_CLAUDE_COMMAND = PLANNER_STUB
process.env.TSF_PLANNER_CODEX_COMMAND = NONEXISTENT
process.env.STUB_MODE = 'success'
process.env.TSF_ORCA_CLI_COMMAND = ORCA_STUB
process.env.STUB_ORCA_MODE = 'success'
process.env.STUB_ORCA_REPOS = '[]'

const { createRequestHandler } = await import('../server/http-server.mjs')
const { FIXTURE_PROJECT_ID } = await import('../server/fixture-project.mjs')

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

async function post(base, urlPath, body) {
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

test('GET /api/projects/:id/estimate returns null before anything has ever been generated', async () => {
  await withServer(async (base) => {
    const res = await get(base, `/api/projects/${FIXTURE_PROJECT_ID}/estimate`)
    assert.equal(res.status, 200)
    assert.equal(res.body.estimate, null)
  })
})

test('an unknown project id 404s honestly', async () => {
  await withServer(async (base) => {
    const res = await get(base, '/api/projects/does-not-exist-at-all/estimate')
    assert.equal(res.status, 404)
  })
})

test('POST /api/projects/:id/estimate requires startDate', async () => {
  await withServer(async (base) => {
    const res = await post(base, `/api/projects/${FIXTURE_PROJECT_ID}/estimate`, {})
    assert.equal(res.status, 400)
  })
})

test('REQUIRED PROOF: a real repo-grounded estimate is generated end to end and persisted for later GET', async () => {
  await withServer(async (base) => {
    const generated = await post(base, `/api/projects/${FIXTURE_PROJECT_ID}/estimate`, {
      startDate: '2026-01-05T00:00:00.000Z'
    })
    assert.equal(generated.status, 200)
    assert.equal(generated.body.estimate.preliminary, false)
    assert.ok(generated.body.estimate.wbs.length > 0)
    assert.ok(generated.body.estimate.plan.schedule.length > 0)
    assert.equal(generated.body.estimate.plan.status, 'NO_DEADLINE_SET')

    // A second, independent GET (a new request) sees the persisted
    // estimate -- proves real persistence, not a request-scoped cache.
    const recalled = await get(base, `/api/projects/${FIXTURE_PROJECT_ID}/estimate`)
    assert.equal(recalled.status, 200)
    assert.equal(recalled.body.estimate.projectId, FIXTURE_PROJECT_ID)
    assert.deepEqual(recalled.body.estimate.wbs, generated.body.estimate.wbs)
  })
})

test('an idea-brief estimate (no repo evidence) is labeled preliminary', async () => {
  await withServer(async (base) => {
    const res = await post(base, `/api/projects/${FIXTURE_PROJECT_ID}/estimate`, {
      startDate: '2026-01-05T00:00:00.000Z',
      ideaBrief: 'A brand new concept, no repo yet.'
    })
    assert.equal(res.status, 200)
    assert.equal(res.body.estimate.preliminary, true)
  })
})

test('a deadline that is honestly impossible is reflected as UNREALISTIC in the persisted plan', async () => {
  await withServer(async (base) => {
    const res = await post(base, `/api/projects/${FIXTURE_PROJECT_ID}/estimate`, {
      startDate: '2026-01-05T00:00:00.000Z',
      deadlineDate: '2026-01-05T01:00:00.000Z'
    })
    assert.equal(res.status, 200)
    assert.equal(res.body.estimate.plan.status, 'UNREALISTIC')
  })
})

test('an unavailable planner produces an honest 422, not a fabricated estimate', async () => {
  const priorClaude = process.env.TSF_PLANNER_CLAUDE_COMMAND
  process.env.TSF_PLANNER_CLAUDE_COMMAND = NONEXISTENT
  try {
    await withServer(async (base) => {
      const res = await post(base, `/api/projects/${FIXTURE_PROJECT_ID}/estimate`, {
        startDate: '2026-01-05T00:00:00.000Z'
      })
      assert.equal(res.status, 422)
      assert.ok(res.body.error)
    })
  } finally {
    process.env.TSF_PLANNER_CLAUDE_COMMAND = priorClaude
  }
})

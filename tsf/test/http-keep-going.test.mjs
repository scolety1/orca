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
  `operator-state.test-http-keep-going-${process.pid}.json`
)

process.env.TSF_UI_STATE_FILE = STATE_FILE

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

// tsf-ui-capability-check is the always-present fixture project id
// (tsf/server/fixture-project.mjs) -- safe to exercise a real Keep Going
// run against without touching any real project.
const PROJECT_ID = 'tsf-ui-capability-check'

test('GET /api/keep-going/:projectId reports not-started before any run exists', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/api/keep-going/${PROJECT_ID}`)
    assert.equal(res.status, 200)
    const body = await res.json()
    assert.equal(body.started, false)
  })
})

test('GET /api/keep-going/:projectId 404s for an unknown project', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/api/keep-going/does-not-exist`)
    assert.equal(res.status, 404)
  })
})

test('POST start / GET / POST pause / POST resume drive a real Keep Going run end to end', async () => {
  await withServer(async (base) => {
    const startRes = await fetch(`${base}/api/keep-going/${PROJECT_ID}/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        originalGoal: 'Ship the operator UI check.',
        acceptanceCriteria: ['UI_RENDERS'],
        usageMode: 'BALANCED'
      })
    })
    assert.equal(startRes.status, 200)
    const started = await startRes.json()
    assert.equal(started.started, true)
    assert.equal(started.state, 'ACTIVE')
    assert.equal(started.goal, 'Ship the operator UI check.')

    const getRes = await fetch(`${base}/api/keep-going/${PROJECT_ID}`)
    const got = await getRes.json()
    assert.equal(got.state, 'ACTIVE')
    assert.equal(got.runId, started.runId)

    const pauseRes = await fetch(`${base}/api/keep-going/${PROJECT_ID}/pause`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reason: 'CAPACITY_REVIEW' })
    })
    assert.equal(pauseRes.status, 200)
    assert.equal((await pauseRes.json()).state, 'PAUSED')

    const resumeRes = await fetch(`${base}/api/keep-going/${PROJECT_ID}/resume`, { method: 'POST' })
    assert.equal(resumeRes.status, 200)
    assert.equal((await resumeRes.json()).state, 'ACTIVE')

    // starting again while active is rejected, not silently double-started
    const restartRes = await fetch(`${base}/api/keep-going/${PROJECT_ID}/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ originalGoal: 'Second goal.', acceptanceCriteria: ['X'] })
    })
    assert.equal(restartRes.status, 422)
  })
})

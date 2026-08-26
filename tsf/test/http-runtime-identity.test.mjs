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
  `operator-state.test-http-runtime-identity-${process.pid}.json`
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
    rmSync(`${STATE_FILE}.runtime.json`, { force: true })
  }
}

test('GET /api/update-safety reports SAFE_NOW against a fresh, empty state -- no run exists anywhere', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/api/update-safety`)
    assert.equal(res.status, 200)
    const body = await res.json()
    assert.equal(body.state, 'SAFE_NOW')
  })
})

test('GET /api/runtime-identity reports a real commit hash and an honest classification, never fabricated', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/api/runtime-identity`)
    assert.equal(res.status, 200)
    const body = await res.json()
    assert.match(body.runningCommit, /^[0-9a-f]{40}$/)
    assert.equal(body.runningCommit, body.diskCommit)
    assert.ok(
      ['UP_TO_DATE', 'UI_BUNDLE_STALE', 'LIVE_RUNTIME_STALE', 'UNKNOWN'].includes(body.state)
    )
    assert.equal(typeof body.pid, 'number')
    assert.ok(body.startedAt)
  })
})

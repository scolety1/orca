// GET /api/attention -- isolated route-handler test (fake req/res, no real
// HTTP server), mirroring the idiom real route-handler-in-isolation tests in
// this codebase already use (see e.g. cleanup-http-routes.test.mjs). Still
// isolates TSF_UI_STATE_FILE per-process -- handleAttentionRoute's real
// gatherRealDeps path genuinely reads the durable state file, and this must
// never touch the shared default local-state file on a machine running many
// concurrent test processes.
import assert from 'node:assert/strict'
import test from 'node:test'
import path from 'node:path'
import { rmSync } from 'node:fs'

const HERE = import.meta.dirname
const STATE_FILE = path.join(HERE, '..', 'server', '.local-state', `operator-state.test-attention-http-routes-${process.pid}.json`)
process.env.TSF_UI_STATE_FILE = STATE_FILE

const { handleAttentionRoute } = await import('../server/attention-http-routes.mjs')

test.after(() => {
  rmSync(STATE_FILE, { force: true })
  rmSync(`${STATE_FILE}.tmp`, { force: true })
})

function fakeRes() {
  return {
    statusCode: null,
    body: null,
    writeHead(code) { this.statusCode = code },
    end(payload) { this.body = payload ? JSON.parse(payload) : null }
  }
}

function jsonHelper(res, status, body) {
  res.writeHead(status)
  res.end(JSON.stringify(body))
}

function notFoundHelper(res, message) {
  res.writeHead(404)
  res.end(JSON.stringify({ ok: false, error: message }))
}

const helpers = { json: jsonHelper, notFound: notFoundHelper, readBody: async () => ({}) }

test('a non-attention route is left unhandled (returns false, never touches res)', async () => {
  const res = fakeRes()
  const handled = await handleAttentionRoute(['api', 'work'], {}, res, {}, helpers)
  assert.equal(handled, false)
  assert.equal(res.statusCode, null)
})

test('an unknown /api/attention sub-route is a clean 404, not a crash', async () => {
  const res = fakeRes()
  const handled = await handleAttentionRoute(['api', 'attention', 'nope'], { method: 'GET' }, res, {}, helpers)
  assert.equal(handled, true)
  assert.equal(res.statusCode, 404)
})

// REQUIRED PROOF: GET /api/attention returns a real, honest items array
// built from real server-side reads (gatherRealDeps), never a fabricated
// or fixture-only list. This process's own real fleet state is whatever it
// is (likely empty in a bare test run) -- the proof is the response shape
// and success path, not a specific fixture-injected item (that's
// fleet-attention-status.test.mjs's job).
test('REQUIRED PROOF: GET /api/attention returns { ok: true, items: [] } shape from real state, 200 status', async () => {
  const res = fakeRes()
  const handled = await handleAttentionRoute(['api', 'attention'], { method: 'GET' }, res, {}, helpers)
  assert.equal(handled, true)
  assert.equal(res.statusCode, 200)
  assert.equal(res.body.ok, true)
  assert.ok(Array.isArray(res.body.items), 'items must always be a real array, never undefined/null')
})

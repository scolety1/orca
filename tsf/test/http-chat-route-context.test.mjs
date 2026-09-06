// Global Command Dock V1, real HTTP integration: POST /api/chat with
// projectId: null + contextProjectId threads the route hint through
// resolveRouteContextFallback -- proven end to end here, not just at the
// pure-function level (chat-route-context-fallback.test.mjs).
import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'node:http'
import path from 'node:path'
import { rmSync } from 'node:fs'

const HERE = import.meta.dirname
const STATE_FILE = path.join(HERE, '..', 'server', '.local-state', `operator-state.test-http-chat-route-context-${process.pid}.json`)
const PLANNER_STUB = path.join(HERE, 'fixtures', 'stub-planner-cli.mjs')
const NONEXISTENT = path.join(HERE, 'fixtures', 'does-not-exist-binary')

process.env.TSF_UI_STATE_FILE = STATE_FILE
process.env.TSF_PLANNER_CLAUDE_COMMAND = PLANNER_STUB
process.env.TSF_PLANNER_CODEX_COMMAND = NONEXISTENT
process.env.STUB_MODE = 'success'

const { createRequestHandler } = await import('../server/http-server.mjs')

async function withServer(fn) {
  const handler = createRequestHandler()
  const server = createServer((req, res) => handler(req, res, () => { res.writeHead(404); res.end() }))
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  try {
    await fn(`http://127.0.0.1:${port}`)
  } finally {
    await new Promise((resolve) => server.close(resolve))
    for (const suffix of ['', '.tmp', '.lock', '.research.lock']) rmSync(`${STATE_FILE}${suffix}`, { force: true })
  }
}

const PROJECT_ID = 'tsf-ui-capability-check'

async function chat(base, body) {
  const res = await fetch(`${base}/api/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  return { status: res.status, body: await res.json() }
}

test('a project-shaped message with no named project resolves via contextProjectId (PROJECT_REQUIRED)', async () => {
  await withServer(async (base) => {
    process.env.STUB_SCOPE_OVERRIDE = 'PROJECT_REQUIRED'
    try {
      const { status, body } = await chat(base, { projectId: null, message: "fix this project's health", contextProjectId: PROJECT_ID })
      assert.equal(status, 200)
      assert.ok(body.resolvedProjectIds?.includes(PROJECT_ID), `expected ${PROJECT_ID} in resolvedProjectIds, got ${JSON.stringify(body.resolvedProjectIds)}`)
    } finally {
      delete process.env.STUB_SCOPE_OVERRIDE
    }
  })
})

test('a genuinely fleet-wide message ignores contextProjectId (GLOBAL_STATUS) -- "what\'s running right now" stays global', async () => {
  await withServer(async (base) => {
    process.env.STUB_SCOPE_OVERRIDE = 'GLOBAL_STATUS'
    try {
      const { status, body } = await chat(base, { projectId: null, message: "what's running right now", contextProjectId: PROJECT_ID })
      assert.equal(status, 200)
      assert.equal(body.scope, 'FLEET')
      assert.ok(!body.resolvedProjectIds || body.resolvedProjectIds.length === 0)
    } finally {
      delete process.env.STUB_SCOPE_OVERRIDE
    }
  })
})

test('an explicitly named project in the message always overrides contextProjectId', async () => {
  await withServer(async (base) => {
    const { status, body } = await chat(base, { projectId: null, message: 'what is the status of TSF UI Capability Check?', contextProjectId: 'some-other-project-id' })
    assert.equal(status, 200)
    assert.ok(body.resolvedProjectIds?.includes(PROJECT_ID))
  })
})

test('omitting contextProjectId entirely is completely unaffected (existing behavior)', async () => {
  await withServer(async (base) => {
    process.env.STUB_SCOPE_OVERRIDE = 'UNCLEAR'
    try {
      const { status, body } = await chat(base, { projectId: null, message: 'some ambiguous message naming nobody' })
      assert.equal(status, 200)
      assert.ok(!body.resolvedProjectIds || body.resolvedProjectIds.length === 0)
    } finally {
      delete process.env.STUB_SCOPE_OVERRIDE
    }
  })
})

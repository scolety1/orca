import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'node:http'
import path from 'node:path'
import { rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const STUB = path.join(HERE, 'fixtures', 'stub-planner-cli.mjs')
const STATE_FILE = path.join(HERE, '..', 'server', '.local-state', `operator-state.test-http-chat-${process.pid}.json`)

process.env.TSF_UI_STATE_FILE = STATE_FILE
process.env.TSF_PLANNER_CLAUDE_COMMAND = STUB
process.env.STUB_MODE = 'success'
process.env.STUB_SESSION_ID = 'http-test-session'

// Imported after env is set: resolveAgentEntry/data-store read process.env at
// call time, but importing after keeps this test file's intent explicit.
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
    rmSync(STATE_FILE, { force: true })
    rmSync(STATE_FILE + '.tmp', { force: true })
  }
}

async function chat(base, projectId, message) {
  const res = await fetch(`${base}/api/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ projectId, message }) })
  return { status: res.status, body: await res.json() }
}

test('POST /api/chat returns a genuine live response for a real project, labeled with the resolved role/provider/model', async () => {
  await withServer(async (base) => {
    const { status, body } = await chat(base, 'weird-talent-marketplace', 'what is going on with this project?')
    assert.equal(status, 200)
    assert.equal(body.live, true)
    assert.equal(body.plannerRole, 'PLANNER_DEEP')
    assert.match(body.providerLabel, /^PLANNER_DEEP · Claude Code/)
    assert.match(body.text, /^stub-answer-for::/)
  })
})

test('a consequential (TIM_REQUIRED) message never reaches the live provider and never claims a completed action', async () => {
  await withServer(async (base) => {
    const { body } = await chat(base, 'weird-talent-marketplace', 'please push this to production and merge it')
    assert.equal(body.decisionClass, 'TIM_REQUIRED')
    assert.equal(body.live, false)
    assert.match(body.text, /won't act on this automatically|consequential/i)
    assert.doesNotMatch(body.text, /stub-answer-for::/)
  })
})

test('project switch does not leak the previous project chat thread or planner session', async () => {
  await withServer(async (base) => {
    await chat(base, 'weird-talent-marketplace', 'remember this is about weird talent')
    await chat(base, 'colety-labs-sales-engine', 'what is going on with this project?')
    const wtHistory = await fetch(`${base}/api/chat/weird-talent-marketplace`).then((r) => r.json())
    const salesHistory = await fetch(`${base}/api/chat/colety-labs-sales-engine`).then((r) => r.json())
    assert.equal(wtHistory.length, 2)
    assert.equal(salesHistory.length, 2)
    assert.doesNotMatch(JSON.stringify(salesHistory), /weird talent/i)
  })
})

test('an unknown provider makes the endpoint fall back honestly instead of a fabricated live answer', async () => {
  const prior = process.env.TSF_PLANNER_CLAUDE_COMMAND
  const priorCodex = process.env.TSF_PLANNER_CODEX_COMMAND
  process.env.TSF_PLANNER_CLAUDE_COMMAND = path.join(HERE, 'fixtures', 'does-not-exist-binary')
  process.env.TSF_PLANNER_CODEX_COMMAND = path.join(HERE, 'fixtures', 'does-not-exist-binary')
  try {
    await withServer(async (base) => {
      const { body } = await chat(base, 'weird-talent-marketplace', 'what is going on with this project?')
      assert.equal(body.live, false)
      assert.match(body.providerLabel, /^Planner unavailable — using recorded project-state fallback/)
      assert.doesNotMatch(body.text, /stub-answer-for::/)
    })
  } finally {
    process.env.TSF_PLANNER_CLAUDE_COMMAND = prior
    process.env.TSF_PLANNER_CODEX_COMMAND = priorCodex
  }
})

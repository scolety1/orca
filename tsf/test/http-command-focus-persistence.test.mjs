// Hands-Free Command + Project Manager V1: real, over-HTTP proof that
// durable Command focus (domain/command-conversation-focus.mjs) persists
// across a simulated restart, is never touched by a genuine Planner Chat
// request, and correctly distinguishes an explicit switch from a mere
// mention -- mirroring http-chat-surface-parity.test.mjs's own real-server,
// real-store convention.
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
  `operator-state.test-http-command-focus-persistence-${process.pid}.json`
)
const PLANNER_STUB = path.join(HERE, 'fixtures', 'stub-planner-cli.mjs')
const NONEXISTENT = path.join(HERE, 'fixtures', 'does-not-exist-binary')

process.env.TSF_UI_STATE_FILE = STATE_FILE
process.env.TSF_PLANNER_CLAUDE_COMMAND = PLANNER_STUB
process.env.TSF_PLANNER_CODEX_COMMAND = NONEXISTENT
process.env.STUB_MODE = 'success'

const { createRequestHandler } = await import('../server/http-server.mjs')
const { loadState } = await import('../server/data-store.mjs')

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
    for (const suffix of ['', '.tmp', '.lock', '.research.lock']) {
      rmSync(`${STATE_FILE}${suffix}`, { force: true })
    }
  }
}

// Two real, always-present-by-default project ids (server/data-store.mjs's
// own DEFAULTS.workSet) -- no seeding required.
const PROJECT_A = 'tsf-ui-capability-check'
const PROJECT_B = 'colety-labs-sales-engine'

async function chat(base, body) {
  const res = await fetch(`${base}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  })
  return { status: res.status, body: await res.json() }
}

test('real HTTP: "Let\'s work on <project>" sets focus, and the response carries it', async () => {
  await withServer(async (base) => {
    const result = await chat(base, {
      projectId: null,
      message: "Let's work on tsf-ui-capability-check."
    })
    assert.equal(result.status, 200)
    assert.equal(result.body.focusProjectId, PROJECT_A)
  })
})

test('real HTTP: an AUTO_DECIDE status question naming a DIFFERENT project does not move focus off the current one', async () => {
  await withServer(async (base) => {
    await chat(base, { projectId: null, message: `Let's work on ${PROJECT_A}.` })
    const status = await chat(base, {
      projectId: null,
      message: `What is the current state of ${PROJECT_B}?`
    })
    assert.equal(status.status, 200)
    assert.equal(status.body.focusProjectId, PROJECT_A)
  })
})

test('real HTTP: an explicit switch moves focus, and "go back" (no target) returns to the prior one', async () => {
  await withServer(async (base) => {
    await chat(base, { projectId: null, message: `Let's work on ${PROJECT_A}.` })
    const switched = await chat(base, { projectId: null, message: `Okay, switch to ${PROJECT_B}.` })
    assert.equal(switched.body.focusProjectId, PROJECT_B)

    const wentBack = await chat(base, { projectId: null, message: 'Go back.' })
    assert.equal(wentBack.body.focusProjectId, PROJECT_A)
  })
})

test('real HTTP: a genuine Planner Chat request (projectId explicitly set) never moves or reports Command focus', async () => {
  await withServer(async (base) => {
    await chat(base, { projectId: null, message: `Let's work on ${PROJECT_A}.` })
    const plannerChat = await chat(base, {
      projectId: PROJECT_B,
      message: 'What is the current state of this project?'
    })
    assert.equal(plannerChat.body.focusProjectId, undefined)

    const state = loadState()
    assert.equal(
      state.commandFocus.focusProjectId,
      PROJECT_A,
      'Planner Chat must never move durable Command focus'
    )
  })
})

test('real HTTP: GET /api/chat/__command__/focus reads back the durable focus a prior turn set, for client rehydration on mount/reload', async () => {
  await withServer(async (base) => {
    await chat(base, { projectId: null, message: `Let's work on ${PROJECT_A}.` })
    const res = await fetch(`${base}/api/chat/__command__/focus`)
    const body = await res.json()
    assert.equal(res.status, 200)
    assert.equal(body.focusProjectId, PROJECT_A)
    assert.deepEqual(body.recentProjectStack, [])
  })
})

test('real HTTP: GET /api/chat/__command__/focus degrades to an empty-but-well-formed object, never null, before any Command turn has set focus', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/api/chat/__command__/focus`)
    const body = await res.json()
    assert.equal(res.status, 200)
    assert.equal(body.focusProjectId, null)
    assert.deepEqual(body.recentProjectStack, [])
  })
})

test('RESTART_DURABILITY: focus persists in the real, on-disk store, readable independently of any running server', async () => {
  await withServer(async (base) => {
    await chat(base, { projectId: null, message: `Let's work on ${PROJECT_A}.` })
    await chat(base, { projectId: null, message: `Okay, switch to ${PROJECT_B}.` })
    // loadState() always reads fresh from disk (server/data-store.mjs), same
    // as it would from a freshly-started process after a real restart --
    // this proves the data is genuinely durable, not an in-memory-only
    // carryover the running server happens to still hold.
    const freshState = loadState()
    assert.equal(freshState.commandFocus.focusProjectId, PROJECT_B)
    assert.deepEqual(freshState.commandFocus.recentProjectStack, [PROJECT_A])
  })
})

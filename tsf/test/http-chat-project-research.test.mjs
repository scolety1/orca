// Operator IA consolidation: "Research for this project" must create a
// mission attributed to the REAL project, through the SAME research bridge
// Command's global scope already uses -- no second research engine, no
// change to global (projectId: null) Command behavior.
import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'node:http'
import path from 'node:path'
import { rmSync } from 'node:fs'

const HERE = import.meta.dirname
const STATE_FILE = path.join(HERE, '..', 'server', '.local-state', `operator-state.test-http-chat-project-research-${process.pid}.json`)
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

// tsf-ui-capability-check is the always-present fixture project id
// (server/fixture-project.mjs) -- same lightweight fixture http-chat-
// dispatch.test.mjs uses, chosen here specifically because research routing
// needs no git worktree/dispatch machinery at all.
const PROJECT_ID = 'tsf-ui-capability-check'

async function chat(base, body) {
  const res = await fetch(`${base}/api/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  return { status: res.status, body: await res.json() }
}

test('a research-shaped message sent in a project-scoped chat creates a mission attributed to that REAL project, not COMMAND_CHAT', async () => {
  await withServer(async (base) => {
    const { status, body } = await chat(base, { projectId: PROJECT_ID, message: 'research NFL salary cap 2018 through 2020 and give me a sourced dataset. don\'t spend any money.' })
    assert.equal(status, 200)
    assert.equal(body.scope, 'RESEARCH')
    assert.ok(body.researchMissionId)

    const listRes = await fetch(`${base}/api/research?projectId=${encodeURIComponent(PROJECT_ID)}`)
    const { missions } = await listRes.json()
    const mine = missions.find((m) => m.missionId === body.researchMissionId)
    assert.ok(mine, 'the created mission is listed under its real project')
    assert.equal(mine.projectId, PROJECT_ID)

    // A second research-shaped follow-up in the SAME project conversation
    // resolves to the SAME mission -- proves resolveMissionContext's own
    // conversational-referent logic is completely unaffected by threading
    // a real contextProjectId through.
    const follow = await chat(base, { projectId: PROJECT_ID, message: 'is it done?' })
    assert.equal(follow.body.researchMissionId, body.researchMissionId)
  })
})

test('global Command (projectId: null) research creation is completely unaffected -- still attributed to COMMAND_CHAT', async () => {
  await withServer(async (base) => {
    const { body } = await chat(base, { projectId: null, message: 'research NFL salary cap 2018 through 2020 and give me a sourced dataset. don\'t spend any money.' })
    assert.equal(body.scope, 'RESEARCH')
    const listRes = await fetch(`${base}/api/research?projectId=COMMAND_CHAT`)
    const { missions } = await listRes.json()
    assert.ok(missions.some((m) => m.missionId === body.researchMissionId))
  })
})

test('an ordinary, non-research project-scoped chat message is routed exactly as before', async () => {
  await withServer(async (base) => {
    const { status, body } = await chat(base, { projectId: PROJECT_ID, message: 'what is the status of this project?' })
    assert.equal(status, 200)
    assert.notEqual(body.scope, 'RESEARCH')
    assert.equal(body.researchMissionId, undefined)
  })
})

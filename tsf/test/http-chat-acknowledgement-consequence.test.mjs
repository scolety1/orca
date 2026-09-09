// Full Conversational Control Plane Exhaustive Gauntlet V1, Phase 4/21: the
// exact reported live bug -- "Landing Page / candidate / adoption
// discussion. User: 'awesome! this is so great!'" being treated as a
// consequential decision -- reproduced and proven fixed against the REAL
// /api/chat HTTP route. The stub planner CLI echoes "stub-answer-for::" for
// anything that reaches the live-LLM fallback, which gives a strong,
// verifiable oracle: if that marker appears, the deterministic
// ACKNOWLEDGEMENT guard was bypassed and the message reached the
// no-guardrail live path -- exactly the risk this fix closes.
import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'node:http'
import path from 'node:path'
import { rmSync } from 'node:fs'

const HERE = import.meta.dirname
const STATE_FILE = path.join(HERE, '..', 'server', '.local-state', `operator-state.test-http-chat-acknowledgement-${process.pid}.json`)
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

test('the exact reported scenario: adoption-readiness discussion then bare enthusiasm never implies a decision was made', async () => {
  await withServer(async (base) => {
    const turn1 = await chat(base, { projectId: PROJECT_ID, message: 'is this ready for adoption?' })
    assert.equal(turn1.status, 200)

    const turn2 = await chat(base, { projectId: PROJECT_ID, message: 'awesome! this is so great!' })
    assert.equal(turn2.status, 200)
    assert.equal(turn2.body.intent, 'ACKNOWLEDGEMENT')
    assert.equal(turn2.body.live, false, 'a grounded ACKNOWLEDGEMENT answer must never claim to be a live call')
    // The strong oracle: the stub planner's telltale marker must be
    // completely absent -- proves this never reached the no-guardrail
    // live-LLM fallback at all.
    assert.doesNotMatch(turn2.body.text, /stub-answer-for::/)
    assert.match(turn2.body.text, /no action was taken/i)

    const projectAfter = await fetch(`${base}/api/projects/${PROJECT_ID}`).then((r) => r.json())
    assert.equal(projectAfter.release?.adoption, 'PENDING_YOUR_DECISION', 'real project state must be completely unmutated by mere acknowledgement')
  })
})

test('control: an explicit adoption request in the same project reaches real handling, not the acknowledgement guard', async () => {
  await withServer(async (base) => {
    const result = await chat(base, { projectId: PROJECT_ID, message: 'adopt it' })
    assert.equal(result.status, 200)
    assert.notEqual(result.body.intent, 'ACKNOWLEDGEMENT')
  })
})

test('a bare acknowledgement with zero prior context still answers gracefully and never reaches the live planner', async () => {
  await withServer(async (base) => {
    const result = await chat(base, { projectId: PROJECT_ID, message: 'perfect!' })
    assert.equal(result.status, 200)
    assert.equal(result.body.intent, 'ACKNOWLEDGEMENT')
    assert.doesNotMatch(result.body.text, /stub-answer-for::/)
  })
})

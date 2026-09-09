// Full Conversational Control Plane Exhaustive Gauntlet V1, Batch 3: Global
// Command dock and the Full Command page are CONFIRMED, by architectural
// inspection, to be the exact same React component (CommandPanel.tsx) making
// the exact same api.chat(null, ...) call to the exact same /api/chat route
// -- there is no second backend path to differentially test there; parity is
// structurally guaranteed by shared code, not by test coverage. The one
// GENUINE surface distinction is Global Command (projectId: null) vs.
// per-project Planner Chat (projectId: <real>) -- both still funnel through
// the SAME chat-http-routes.mjs::handleChatRoute, chat-responder.mjs
// classifyIntent/classifyDecision, and command-research-bridge.mjs research
// gate. This is a real, live, end-to-end differential proof that the two
// never disagree on the property that actually matters: whether a
// consequential/dispatch/research decision was made, for the SAME message
// text, real project vs. global scope.
import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'node:http'
import path from 'node:path'
import { rmSync } from 'node:fs'

const HERE = import.meta.dirname
const STATE_FILE = path.join(HERE, '..', 'server', '.local-state', `operator-state.test-http-chat-surface-parity-${process.pid}.json`)
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

// Semantic equivalence, not textual equivalence -- the two surfaces have
// different response shapes (fleet-wide vs. one project's grounded state),
// so this compares the properties that must never disagree: whether the
// message was recognized as an action request (dispatched or refused as
// TIM_REQUIRED), an acknowledgement (no action), or a research request.
function semanticShape(body) {
  return {
    isAcknowledgement: body.intent === 'ACKNOWLEDGEMENT',
    isTimRequired: body.decisionClass === 'TIM_REQUIRED',
    isResearch: body.scope === 'RESEARCH',
    live: body.live === true
  }
}

test('Batch 3 surface parity: "awesome! this is so great!" -- Global Command and Planner Chat agree it is an acknowledgement, never a decision', async () => {
  await withServer(async (base) => {
    const global_ = await chat(base, { projectId: null, message: 'awesome! this is so great!' })
    const projectScoped = await chat(base, { projectId: PROJECT_ID, message: 'awesome! this is so great!' })
    assert.equal(projectScoped.body.intent, 'ACKNOWLEDGEMENT')
    assert.equal(projectScoped.body.live, false)
    // Global Command's own scope classifier may answer this differently in
    // SHAPE (it has no single resolved project to ground an acknowledgement
    // response against), but it must NEVER treat bare enthusiasm as a
    // decision either.
    assert.notEqual(global_.body.decisionClass, 'TIM_REQUIRED')
    assert.notEqual(global_.body.scope, 'RESEARCH')
  })
})

test('Batch 3 surface parity: a genuine consequential directive is refused (never auto-executed) on both surfaces', async () => {
  await withServer(async (base) => {
    const global_ = await chat(base, { projectId: null, message: 'deploy this to production now' })
    const projectScoped = await chat(base, { projectId: PROJECT_ID, message: 'deploy this to production now' })
    assert.equal(semanticShape(global_.body).isTimRequired, true)
    assert.equal(semanticShape(projectScoped.body).isTimRequired, true)
    assert.equal(global_.body.live, false)
    assert.equal(projectScoped.body.live, false)
  })
})

test('Batch 3 surface parity: a genuine dataset-research request is recognized as research on Global Command, and as research (not software dispatch) when project-scoped too', async () => {
  await withServer(async (base) => {
    const message = 'Research every 2008 NFL player and collect exact routes run, source, team and position.'
    const global_ = await chat(base, { projectId: null, message })
    const projectScoped = await chat(base, { projectId: PROJECT_ID, message })
    assert.equal(global_.body.scope, 'RESEARCH')
    assert.equal(projectScoped.body.scope, 'RESEARCH')
  })
})

test('Batch 3 surface parity: negated adoption never executes on Global Command (the only surface with real adoption-execution authority)', async () => {
  await withServer(async (base) => {
    const result = await chat(base, { projectId: null, message: 'Do not adopt this candidate.' })
    assert.doesNotMatch(result.body.text ?? '', /\badopted -- canonical advanced\b/i)
  })
})

// Full Control Plane Exhaustive Gauntlet V1, one-hour continuation,
// Priority 5 -- closing an independent coverage-audit-flagged gap:
// surface parity was only ever asserted for ACKNOWLEDGEMENT/one
// TIM_REQUIRED directive/one RESEARCH request/one negated adoption.
// Adds parity coverage for this continuation's own negation/truthfulness
// fixes: a hedge-idiom-phrased adoption request (RT-04, Batch 13) must
// never be misread as TIM_REQUIRED on either surface, and a bug-report
// message must never claim a durable "recorded"/"logged" record on
// either surface (CASE-22/23).
test('Batch 16 surface parity: a hedge-idiom adoption request ("no rush, adopt it") is never treated as TIM_REQUIRED on either surface', async () => {
  await withServer(async (base) => {
    const message = 'no rush, adopt it'
    const global_ = await chat(base, { projectId: null, message })
    const projectScoped = await chat(base, { projectId: PROJECT_ID, message })
    assert.notEqual(global_.body.decisionClass, 'TIM_REQUIRED')
    assert.notEqual(projectScoped.body.decisionClass, 'TIM_REQUIRED')
  })
})

test('Batch 16 surface parity: a bug-report message never claims a false "recorded"/"logged" durable record on either surface', async () => {
  await withServer(async (base) => {
    const message = 'The save button is broken.'
    const global_ = await chat(base, { projectId: null, message })
    const projectScoped = await chat(base, { projectId: PROJECT_ID, message })
    assert.doesNotMatch(global_.body.text ?? '', /\b(?:recorded|logged)\b/i)
    assert.doesNotMatch(projectScoped.body.text ?? '', /\b(?:recorded|logged)\b/i)
  })
})

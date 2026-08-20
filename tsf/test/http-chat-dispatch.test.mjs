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
  `operator-state.test-http-chat-dispatch-${process.pid}.json`
)
const PLANNER_STUB = path.join(HERE, 'fixtures', 'stub-planner-cli.mjs')
const ORCA_STUB = path.join(HERE, 'fixtures', 'stub-orca-cli.mjs')

process.env.TSF_UI_STATE_FILE = STATE_FILE
process.env.TSF_PLANNER_CLAUDE_COMMAND = PLANNER_STUB
process.env.STUB_MODE = 'success'
process.env.STUB_SESSION_ID = 'http-chat-dispatch-test-session'
process.env.TSF_ORCA_CLI_COMMAND = ORCA_STUB
process.env.STUB_ORCA_MODE = 'success'

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
    rmSync(`${STATE_FILE}.lock`, { force: true })
  }
}

// tsf-ui-capability-check is the always-present fixture project id
// (tsf/server/fixture-project.mjs), reachable through the general chat
// route's project map -- the same fixture M2's own HTTP tests use.
const PROJECT_ID = 'tsf-ui-capability-check'
// resolveRepositoryIdentity needs a REAL git worktree -- this repo itself
// is exactly what M2's own manual UI acceptance testing used ("current"
// resolving to this repo), so it's the correct, safe, real target here too.
const REAL_WORKTREE = path.join(HERE, '..', '..')

async function chat(base, body) {
  const res = await fetch(`${base}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  })
  return { status: res.status, body: await res.json() }
}

test('a dispatch-worthy chat message with an explicit placement genuinely dispatches through real Keep Going, no terminal opened by hand', async () => {
  await withServer(async (base) => {
    const { status, body } = await chat(base, {
      projectId: PROJECT_ID,
      message: 'go ahead and add a bounded doc note',
      placement: { worktree: REAL_WORKTREE, agent: 'codex' }
    })
    assert.equal(status, 200)
    assert.equal(body.intent, 'DISPATCH_REQUEST')
    assert.equal(body.decisionClass, 'RECOMMEND_AND_PROCEED')
    assert.equal(body.dispatched, true)
    assert.equal(body.tickResult.action, 'WAVE_DISPATCHED')
    assert.match(body.text, /Dispatched/)
    assert.ok(
      body.planCapsule.repository.head.match(/^[0-9a-f]{40}$/),
      'a real HEAD was resolved, not fabricated'
    )
  })
})

test('a follow-up "what is it doing?" after a real dispatch answers from the live run, not a canned/fabricated reply', async () => {
  await withServer(async (base) => {
    const dispatch = await chat(base, {
      projectId: PROJECT_ID,
      message: 'go ahead and add a bounded doc note',
      placement: { worktree: REAL_WORKTREE, agent: 'codex' }
    })
    assert.equal(dispatch.body.dispatched, true)
    const followUp = await chat(base, {
      projectId: PROJECT_ID,
      message: 'what is it doing?'
    })
    assert.equal(followUp.body.intent, 'STATUS')
    assert.equal(followUp.body.live, false)
    assert.match(followUp.body.providerLabel, /grounded in the live Keep Going run/)
    assert.match(followUp.body.text, /Keep Going run/)
    assert.match(followUp.body.text, /WORKING/)
  })
})

test('the exact same message WITHOUT a placement keeps the prior conversational behavior unchanged', async () => {
  await withServer(async (base) => {
    const { body } = await chat(base, {
      projectId: PROJECT_ID,
      message: 'go ahead and add a bounded doc note'
    })
    assert.equal(body.dispatched, undefined)
    assert.equal(body.live, true)
    assert.match(body.text, /^stub-answer-for::/)
  })
})

test('TIM_REQUIRED phrasing refuses even when a placement is supplied -- chat cannot silently authorize a forbidden action just by adding a worktree', async () => {
  await withServer(async (base) => {
    const { body } = await chat(base, {
      projectId: PROJECT_ID,
      message: 'go ahead and push this to production',
      placement: { worktree: REAL_WORKTREE, agent: 'codex' }
    })
    assert.equal(body.decisionClass, 'TIM_REQUIRED')
    assert.equal(body.dispatched, undefined)
    assert.match(body.text, /consequential/i)
  })
})

test('an invalid worktree path fails honestly rather than fabricating a dispatch', async () => {
  await withServer(async (base) => {
    const { body } = await chat(base, {
      projectId: PROJECT_ID,
      message: 'go ahead and add a bounded doc note',
      placement: { worktree: 'C:/definitely-not-a-real-path-xyz-987654321', agent: 'codex' }
    })
    assert.equal(body.dispatched, false)
    assert.match(body.text, /can't dispatch this/)
  })
})

test('a second dispatch request while the first wave is still in flight is reported honestly, not a duplicate dispatch', async () => {
  await withServer(async (base) => {
    const first = await chat(base, {
      projectId: PROJECT_ID,
      message: 'go ahead and add a bounded doc note',
      placement: { worktree: REAL_WORKTREE, agent: 'codex' }
    })
    assert.equal(first.body.dispatched, true)
    assert.equal(first.body.tickResult.action, 'WAVE_DISPATCHED')
    const firstWorkItemId = first.body.candidateWorkItem.id
    // The run is now ACTIVE with an in-flight wave -- tickKeepGoingRun
    // itself routes this second attempt to settleStep (re-checking the
    // SAME wave), never a fresh dispatch of the second, different work
    // item this call built a plan capsule for. Whatever settleStep's real
    // outcome is, the second work item must never appear as a genuinely
    // dispatched one -- that would be exactly the duplicate/lost-work bug
    // class this assertion exists to catch.
    const second = await chat(base, {
      projectId: PROJECT_ID,
      message: 'go ahead and add a different note',
      placement: { worktree: REAL_WORKTREE, agent: 'codex' }
    })
    assert.notEqual(second.body.tickResult.action, 'WAVE_DISPATCHED')
    const secondDispatchedIds = (second.body.tickResult.dispatchRecords ?? []).map(
      (r) => r.workItemId
    )
    assert.ok(
      !secondDispatchedIds.includes(second.body.candidateWorkItem.id),
      'the second, different work item must never appear as genuinely dispatched while wave 1 is still in flight'
    )
    assert.ok(
      secondDispatchedIds.every((id) => id === firstWorkItemId || secondDispatchedIds.length === 0),
      'any dispatch record present must belong to the original in-flight wave, not a duplicate'
    )
  })
})

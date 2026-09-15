// TSF_DOGFOOD_FINDING_1_EXECUTION_HOLD_SAFETY_V1: proves the fix over the
// REAL HTTP layer, not just the domain/controller functions directly --
// keep-going-http-routes.mjs's own mutateThroughStore used to build a
// "throwaway opState" carrying ONLY keepGoingRuns, so even after
// keep-going-controller.mjs grew its own hold-aware gate, a request
// arriving through POST /api/keep-going/:id/start or /resume would still
// silently see projectExecutionHolds as undefined and never trigger it.
// This is the plumbing half of the fix; keep-going-controller-execution-
// hold.test.mjs is the domain half.
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
  `operator-state.test-keep-going-http-hold-${process.pid}.json`
)

process.env.TSF_UI_STATE_FILE = STATE_FILE

const { createRequestHandler } = await import('../server/http-server.mjs')
const { withProjectExecutionHold, readProjectExecutionHold } =
  await import('../server/project-execution-hold-store.mjs')
const { createProjectExecutionHold } = await import('../domain/project-execution-hold.mjs')

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

const PROJECT_ID = 'tsf-ui-capability-check'
const clock = () => new Date('2026-09-15T18:00:00.000Z')

async function post(base, urlPath, body) {
  const res = await fetch(`${base}${urlPath}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  })
  return { status: res.status, body: await res.json() }
}

async function setHold(projectId) {
  return withProjectExecutionHold(projectId, () =>
    createProjectExecutionHold(
      {
        projectId,
        reason: 'EXTERNAL_WORK_ACTIVE',
        setBy: 'OPERATOR_CHAT',
        note: 'another AI is actively working this repo'
      },
      clock
    )
  )
}

test('POST /api/keep-going/:id/start refuses over real HTTP when the project is held, and the hold stays byte-identical', async () => {
  await withServer(async (base) => {
    const hold = await setHold(PROJECT_ID)
    const { status, body } = await post(base, `/api/keep-going/${PROJECT_ID}/start`, {
      originalGoal: 'Ship it.',
      acceptanceCriteria: ['A_DONE']
    })
    assert.equal(status, 422)
    assert.equal(body.code, 'TSF_PROJECT_EXECUTION_HOLD_ACTIVE')
    assert.match(body.error, /execution hold/)

    const getRes = await fetch(`${base}/api/keep-going/${PROJECT_ID}`)
    const runView = await getRes.json()
    assert.equal(runView.started, false, 'no run was created for the held project')

    assert.deepEqual(
      readProjectExecutionHold(PROJECT_ID),
      hold,
      'the hold itself was never touched'
    )
  })
})

test('POST /api/keep-going/:id/resume refuses over real HTTP when the project is held', async () => {
  await withServer(async (base) => {
    await post(base, `/api/keep-going/${PROJECT_ID}/start`, {
      originalGoal: 'Ship it.',
      acceptanceCriteria: ['A_DONE']
    })
    await post(base, `/api/keep-going/${PROJECT_ID}/pause`, {})
    const hold = await setHold(PROJECT_ID)

    const { status, body } = await post(base, `/api/keep-going/${PROJECT_ID}/resume`, {})
    assert.equal(status, 422)
    assert.equal(body.code, 'TSF_PROJECT_EXECUTION_HOLD_ACTIVE')

    const getRes = await fetch(`${base}/api/keep-going/${PROJECT_ID}`)
    const runView = await getRes.json()
    assert.equal(runView.state, 'PAUSED', 'the run stayed PAUSED, never silently resumed')
    assert.deepEqual(readProjectExecutionHold(PROJECT_ID), hold)
  })
})

test('POST /api/keep-going/:id/pause is NEVER blocked by a hold, over real HTTP', async () => {
  await withServer(async (base) => {
    await post(base, `/api/keep-going/${PROJECT_ID}/start`, {
      originalGoal: 'Ship it.',
      acceptanceCriteria: ['A_DONE']
    })
    await setHold(PROJECT_ID)
    const { status, body } = await post(base, `/api/keep-going/${PROJECT_ID}/pause`, {})
    assert.equal(status, 200)
    assert.equal(body.state, 'PAUSED')
  })
})

test('once the hold is released, start/resume work normally again over real HTTP', async () => {
  await withServer(async (base) => {
    await setHold(PROJECT_ID)
    const refused = await post(base, `/api/keep-going/${PROJECT_ID}/start`, {
      originalGoal: 'Ship it.',
      acceptanceCriteria: ['A_DONE']
    })
    assert.equal(refused.status, 422)

    await withProjectExecutionHold(PROJECT_ID, (current) => ({
      ...current,
      status: 'RELEASED',
      releasedBy: 'OPERATOR_CHAT',
      releasedAt: clock().toISOString()
    }))

    const { status, body } = await post(base, `/api/keep-going/${PROJECT_ID}/start`, {
      originalGoal: 'Ship it.',
      acceptanceCriteria: ['A_DONE']
    })
    assert.equal(status, 200)
    assert.equal(body.state, 'ACTIVE')
  })
})

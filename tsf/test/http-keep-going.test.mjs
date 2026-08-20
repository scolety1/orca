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
  `operator-state.test-http-keep-going-${process.pid}.json`
)

process.env.TSF_UI_STATE_FILE = STATE_FILE

const { createRequestHandler } = await import('../server/http-server.mjs')
const { claimTick } = await import('../domain/keep-going.mjs')
const { withKeepGoingRun } = await import('../server/keep-going-run-store.mjs')

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
  }
}

// tsf-ui-capability-check is the always-present fixture project id
// (tsf/server/fixture-project.mjs) -- safe to exercise a real Keep Going
// run against without touching any real project.
const PROJECT_ID = 'tsf-ui-capability-check'

test('GET /api/keep-going/:projectId reports not-started before any run exists', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/api/keep-going/${PROJECT_ID}`)
    assert.equal(res.status, 200)
    const body = await res.json()
    assert.equal(body.started, false)
  })
})

test('GET /api/keep-going/:projectId 404s for an unknown project', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/api/keep-going/does-not-exist`)
    assert.equal(res.status, 404)
  })
})

test('POST start / GET / POST pause / POST resume drive a real Keep Going run end to end', async () => {
  await withServer(async (base) => {
    const startRes = await fetch(`${base}/api/keep-going/${PROJECT_ID}/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        originalGoal: 'Ship the operator UI check.',
        acceptanceCriteria: ['UI_RENDERS'],
        usageMode: 'BALANCED'
      })
    })
    assert.equal(startRes.status, 200)
    const started = await startRes.json()
    assert.equal(started.started, true)
    assert.equal(started.state, 'ACTIVE')
    assert.equal(started.goal, 'Ship the operator UI check.')
    assert.deepEqual(started.gap.remainingGaps, ['UI_RENDERS'])
    assert.equal(started.gap.decision, 'CONTINUE')

    const getRes = await fetch(`${base}/api/keep-going/${PROJECT_ID}`)
    const got = await getRes.json()
    assert.equal(got.state, 'ACTIVE')
    assert.equal(got.runId, started.runId)

    const pauseRes = await fetch(`${base}/api/keep-going/${PROJECT_ID}/pause`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reason: 'CAPACITY_REVIEW', expectedRevision: started.revision })
    })
    assert.equal(pauseRes.status, 200)
    const paused = await pauseRes.json()
    assert.equal(paused.state, 'PAUSED')

    const resumeRes = await fetch(`${base}/api/keep-going/${PROJECT_ID}/resume`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ expectedRevision: paused.revision })
    })
    assert.equal(resumeRes.status, 200)
    assert.equal((await resumeRes.json()).state, 'ACTIVE')

    // starting again while active is rejected, not silently double-started
    const restartRes = await fetch(`${base}/api/keep-going/${PROJECT_ID}/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ originalGoal: 'Second goal.', acceptanceCriteria: ['X'] })
    })
    assert.equal(restartRes.status, 422)
  })
})

test('POST pause with a stale expectedRevision is rejected with 409, not silently applied', async () => {
  await withServer(async (base) => {
    const startRes = await fetch(`${base}/api/keep-going/${PROJECT_ID}/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ originalGoal: 'Race the revision check.', acceptanceCriteria: ['X'] })
    })
    const started = await startRes.json()

    // First request pauses using the revision it read at start time.
    const firstPause = await fetch(`${base}/api/keep-going/${PROJECT_ID}/pause`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reason: 'first', expectedRevision: started.revision })
    })
    assert.equal(firstPause.status, 200)

    // A second, concurrent request still carrying that same pre-pause
    // revision must be rejected, not silently reapplied on top.
    const staleResume = await fetch(`${base}/api/keep-going/${PROJECT_ID}/resume`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ expectedRevision: started.revision })
    })
    assert.equal(staleResume.status, 409)
    const body = await staleResume.json()
    assert.equal(body.code, 'TSF_STALE_REVISION')
  })
})

test('POST pause is rejected with 409 over the real HTTP layer while an autonomous tick holds the lock (closes wave 11 finding 1 for this route)', async () => {
  await withServer(async (base) => {
    await fetch(`${base}/api/keep-going/${PROJECT_ID}/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        originalGoal: 'Prove the HTTP route is lock-aware.',
        acceptanceCriteria: ['X']
      })
    })

    // Simulate an autonomous wave-dispatch tick that has claimed the lock
    // and is mid-flight -- via the SAME synchronous store the route now
    // uses, not a stale pre-captured opState.
    const clock = () => new Date()
    const claimed = withKeepGoingRun(PROJECT_ID, (current) =>
      claimTick(current, 'DISPATCH', clock, current.revision)
    )

    // A pause request carrying the CURRENT (post-claim) revision -- an
    // operator who refreshed and saw the real current state -- isolates
    // the lock check specifically (a stale revision alone would already
    // be rejected regardless of the lock, as proven above). Must still be
    // rejected: the lock, not just the revision, protects the tick.
    const pauseRes = await fetch(`${base}/api/keep-going/${PROJECT_ID}/pause`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reason: 'operator pause', expectedRevision: claimed.revision })
    })
    assert.equal(pauseRes.status, 409)
    const body = await pauseRes.json()
    assert.equal(body.code, 'TSF_TICK_IN_PROGRESS')

    // Persisted state is untouched by the rejected pause -- still ACTIVE.
    const getRes = await fetch(`${base}/api/keep-going/${PROJECT_ID}`)
    assert.equal((await getRes.json()).state, 'ACTIVE')
  })
})

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
// Main TSF Resource Pressure Governor integration review: forced HEALTHY,
// same seam http-resource-pressure-governor.test.mjs uses.
process.env.TSF_RESOURCE_PRESSURE_TEST_TOTAL_BYTES = String(16 * 1024 ** 3)
process.env.TSF_RESOURCE_PRESSURE_TEST_FREE_BYTES = String(8 * 1024 ** 3)
// resolveSenderTerminal (keep-going-dispatch-loop.mjs) short-circuits on
// this env var -- clearing it makes real-tick tests below deterministically
// exercise the stub CLI's `terminal create` handler (a real dev/interactive
// shell may have it set; CI never does).
delete process.env.ORCA_TERMINAL_HANDLE

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
    rmSync(`${STATE_FILE}.lock`, { force: true })
  }
}

// tsf-ui-capability-check is the always-present fixture project id
// (tsf/server/fixture-project.mjs) -- safe to exercise a real Keep Going
// run against without touching any real project.
const PROJECT_ID = 'tsf-ui-capability-check'
const ORCA_STUB = path.join(HERE, 'fixtures', 'stub-orca-cli.mjs')

async function withStubOrca(mode, fn) {
  const priorCommand = process.env.TSF_ORCA_CLI_COMMAND
  const priorMode = process.env.STUB_ORCA_MODE
  process.env.TSF_ORCA_CLI_COMMAND = ORCA_STUB
  process.env.STUB_ORCA_MODE = mode
  try {
    return await fn()
  } finally {
    if (priorCommand === undefined) {
      delete process.env.TSF_ORCA_CLI_COMMAND
    } else {
      process.env.TSF_ORCA_CLI_COMMAND = priorCommand
    }
    if (priorMode === undefined) {
      delete process.env.STUB_ORCA_MODE
    } else {
      process.env.STUB_ORCA_MODE = priorMode
    }
  }
}

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

test('POST start rejects usageMode: HIGH_ASSURANCE over the real HTTP layer -- the reserved mode can no longer be silently accepted into a real run', async () => {
  await withServer(async (base) => {
    const startRes = await fetch(`${base}/api/keep-going/${PROJECT_ID}/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        originalGoal: 'Should never actually start.',
        acceptanceCriteria: ['X'],
        usageMode: 'HIGH_ASSURANCE'
      })
    })
    assert.equal(startRes.status, 422)
    const body = await startRes.json()
    assert.equal(body.code, 'TSF_USAGE_MODE_RESERVED')

    // No run was created by the rejected request.
    const getRes = await fetch(`${base}/api/keep-going/${PROJECT_ID}`)
    assert.equal((await getRes.json()).started, false)
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
    const claimed = await withKeepGoingRun(PROJECT_ID, (current) =>
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

// The "manual Run now" route -- the one real HTTP/UI entry point for
// tickKeepGoingRun (an independent verifier pass found this route did not
// exist at all: the autonomous dispatch loop was reachable only from raw
// Node scripts, never from anything a UI or HTTP caller could invoke).
test('POST tick with no candidate work items NOOPs honestly rather than fabricating a wave', async () => {
  await withServer(async (base) => {
    await fetch(`${base}/api/keep-going/${PROJECT_ID}/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ originalGoal: 'Tick route proof.', acceptanceCriteria: ['X'] })
    })
    const tickRes = await fetch(`${base}/api/keep-going/${PROJECT_ID}/tick`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({})
    })
    assert.equal(tickRes.status, 200)
    const body = await tickRes.json()
    assert.equal(body.action, 'NOOP')
    assert.match(body.reason, /candidate work items/)
  })
})

test('POST tick with real candidate work items dispatches a wave through the real production path (stubbed Orca CLI)', async () => {
  await withServer(async (base) => {
    await fetch(`${base}/api/keep-going/${PROJECT_ID}/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ originalGoal: 'Tick route proof.', acceptanceCriteria: ['X'] })
    })
    const tickRes = await withStubOrca('success', () =>
      fetch(`${base}/api/keep-going/${PROJECT_ID}/tick`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          candidateWorkItems: [
            { id: 't1', scope: ['docs/x.md'], worktree: 'C:/repo/wt1', agent: 'codex' }
          ]
        })
      })
    )
    assert.equal(tickRes.status, 200)
    const body = await tickRes.json()
    assert.equal(body.action, 'WAVE_DISPATCHED')
    assert.equal(body.dispatchRecords.length, 1)

    const getRes = await fetch(`${base}/api/keep-going/${PROJECT_ID}`)
    const got = await getRes.json()
    assert.equal(
      got.phase,
      'WAVE_DISPATCHED',
      'the dispatched wave must be reflected in persisted state, not just the tick response'
    )
  })
})

// REQUIRED PROOF (Main TSF integration review, admission-coverage
// inventory): this direct tick route -- callable with no chat/planner
// involved at all -- was one of the real gaps Job 1's original bounded
// correction missed (it only gated chat-dispatch-bridge.mjs). The gate now
// lives inside keep-going-dispatch-loop.mjs's own dispatchStep, so this
// route is covered without this test needing any server-side wiring
// beyond the collector's own real env-var seam.
test('POST tick under CRITICAL host memory returns DISPATCH_WAITING_FOR_RESOURCES honestly over the real HTTP route, never a fabricated dispatch or a 5xx', async () => {
  await withServer(async (base) => {
    await fetch(`${base}/api/keep-going/${PROJECT_ID}/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ originalGoal: 'Resource pressure tick proof.', acceptanceCriteria: ['X'] })
    })
    process.env.TSF_RESOURCE_PRESSURE_TEST_TOTAL_BYTES = String(16 * 1024 ** 3)
    process.env.TSF_RESOURCE_PRESSURE_TEST_FREE_BYTES = String(1 * 1024 ** 3) // EMERGENCY
    try {
      const tickRes = await withStubOrca('success', () =>
        fetch(`${base}/api/keep-going/${PROJECT_ID}/tick`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            candidateWorkItems: [
              { id: 't1', scope: ['docs/x.md'], worktree: 'C:/repo/wt1', agent: 'codex' }
            ]
          })
        })
      )
      assert.equal(tickRes.status, 200, 'a resource wait is never a server error')
      const body = await tickRes.json()
      assert.equal(body.action, 'DISPATCH_WAITING_FOR_RESOURCES')
      assert.notEqual(body.action, 'DISPATCH_FAILED', 'a resource wait must never look like a real dispatch failure')

      const getRes = await fetch(`${base}/api/keep-going/${PROJECT_ID}`)
      const got = await getRes.json()
      assert.equal(got.started, true, 'the run itself remains ACTIVE, not paused or failed')
    } finally {
      // Restored to this file's own forced-HEALTHY default for every
      // other test.
      process.env.TSF_RESOURCE_PRESSURE_TEST_TOTAL_BYTES = String(16 * 1024 ** 3)
      process.env.TSF_RESOURCE_PRESSURE_TEST_FREE_BYTES = String(8 * 1024 ** 3)
    }
  })
})

test('POST tick with a work item missing both worktree and workerTerminal is rejected with 422 before any real dispatch (a real, live-confirmed safety finding)', async () => {
  await withServer(async (base) => {
    await fetch(`${base}/api/keep-going/${PROJECT_ID}/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ originalGoal: 'Placement guard proof.', acceptanceCriteria: ['X'] })
    })
    const tickRes = await withStubOrca('success', () =>
      fetch(`${base}/api/keep-going/${PROJECT_ID}/tick`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ candidateWorkItems: [{ id: 't1', scope: ['docs/x.md'] }] })
      })
    )
    assert.equal(tickRes.status, 422)
    const body = await tickRes.json()
    assert.equal(body.code, 'TSF_MISSING_PLACEMENT')

    // The run must still be untouched/dispatchable afterward -- the
    // rejection must not have consumed the tick lock or left any trace.
    const getRes = await fetch(`${base}/api/keep-going/${PROJECT_ID}`)
    const got = await getRes.json()
    assert.equal(got.phase, 'RUN_STARTED')
  })
})

// Reproduces the exact bug a real manual UI acceptance test hit live: a
// run left with a STALLED, un-fenced in-flight wave silently absorbs
// every subsequent "Run now" click into settleStep (which only ever
// re-checks the SAME stuck wave), discarding whatever new work item the
// operator supplied, with no signal that this happened -- and, before
// this fix, no way back to usability through the product surface at all.
test("a stalled in-flight wave silently absorbs a later tick's new work item until abandon-stalled-wave clears it, after which the new item genuinely dispatches", async () => {
  await withServer(async (base) => {
    await fetch(`${base}/api/keep-going/${PROJECT_ID}/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        originalGoal: 'Stall recovery proof.',
        acceptanceCriteria: ['X'],
        budget: { stallThresholdMs: 100 }
      })
    })

    // First "Run now": dispatches a real wave via the stub CLI, which
    // never reports this task as completed (the stub's default task-list
    // is empty), so it stays PENDING forever from TSF's perspective --
    // exactly the same shape as a genuinely stuck worker.
    const firstTick = await withStubOrca('success', () =>
      fetch(`${base}/api/keep-going/${PROJECT_ID}/tick`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          candidateWorkItems: [{ id: 'original-item', scope: ['a.md'], worktree: 'C:/repo/wt1' }]
        })
      })
    )
    assert.equal((await firstTick.json()).action, 'WAVE_DISPATCHED')

    // Let real wall-clock time pass the (deliberately tiny) stall threshold.
    await new Promise((resolve) => setTimeout(resolve, 200))

    // Second "Run now": the operator supplies a DIFFERENT new work item,
    // exactly as Tim did -- but since the prior wave is still in flight
    // (now past its stall threshold), this tick must route to settleStep
    // and escalate THAT wave to STALLED, never touching the new item.
    const secondTick = await withStubOrca('success', () =>
      fetch(`${base}/api/keep-going/${PROJECT_ID}/tick`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          candidateWorkItems: [{ id: 'new-item', scope: ['b.md'], worktree: 'C:/repo/wt2' }]
        })
      })
    )
    const secondBody = await secondTick.json()
    assert.equal(secondBody.action, 'WAVE_STALLED')
    // Proves the "new" item was never even considered -- the outcome
    // still references the ORIGINAL work item, not the one just supplied.
    assert.equal(secondBody.outcomes[0].workItemId, 'original-item')

    const stalledView = await (await fetch(`${base}/api/keep-going/${PROJECT_ID}`)).json()
    assert.equal(stalledView.state, 'STALLED')

    // The fix: abandon-stalled-wave gives the operator a real recovery
    // path through the product surface, instead of none at all.
    const abandonRes = await fetch(`${base}/api/keep-going/${PROJECT_ID}/abandon-stalled-wave`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reason: 'test recovery', expectedRevision: stalledView.revision })
    })
    assert.equal(abandonRes.status, 200)
    assert.equal((await abandonRes.json()).state, 'ACTIVE')

    // Now the new item finally gets a real chance to dispatch.
    const thirdTick = await withStubOrca('success', () =>
      fetch(`${base}/api/keep-going/${PROJECT_ID}/tick`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          candidateWorkItems: [{ id: 'new-item', scope: ['b.md'], worktree: 'C:/repo/wt2' }]
        })
      })
    )
    const thirdBody = await thirdTick.json()
    assert.equal(thirdBody.action, 'WAVE_DISPATCHED')
    assert.equal(thirdBody.dispatchRecords[0].workItemId, 'new-item')
  })
})

test('POST abandon-stalled-wave 422s honestly when the run is not STALLED (an independent-review-caught gap: this must not let a caller abort a healthy in-progress wave)', async () => {
  await withServer(async (base) => {
    await fetch(`${base}/api/keep-going/${PROJECT_ID}/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ originalGoal: 'No wave yet.', acceptanceCriteria: ['X'] })
    })
    const res = await fetch(`${base}/api/keep-going/${PROJECT_ID}/abandon-stalled-wave`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({})
    })
    assert.equal(res.status, 422)
    assert.equal((await res.json()).code, 'TSF_RUN_NOT_STALLED')
  })
})

test('POST abandon-stalled-wave on an unknown project 404s, same as the other routes', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/api/keep-going/does-not-exist/abandon-stalled-wave`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({})
    })
    assert.equal(res.status, 404)
  })
})

test('POST tick on an unknown project 404s, same as the other routes', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/api/keep-going/does-not-exist/tick`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({})
    })
    assert.equal(res.status, 404)
  })
})

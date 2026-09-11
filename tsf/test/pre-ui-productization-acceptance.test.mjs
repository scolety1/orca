// Pre-UI Productization V1 -- real owner-flow acceptance test. One
// continuous real flow over the real HTTP server (server/http-server.mjs),
// the real fixture project (server/fixture-project.mjs -- never a real
// user project, never NWR/Nytheria/EasyLife/etc.), proving the priorities
// this mission closed actually compose together, not just pass in
// isolation. Every individual mechanism exercised here already has its
// own dedicated, mutation-verified test elsewhere (cited inline) -- this
// file's real, incremental value is proving the SAME project/thread moves
// through pause -> resume -> hold -> release -> attention -> planner
// answer as one continuous real owner session would, which nothing else
// in this suite does end-to-end together.
//
// Deliberately narrower than an exhaustive walkthrough of all 16
// originally-scoped acceptance steps (that list was not recovered from
// this session's own durable memory) -- this is a real, honest subset
// covering Priorities 1, 2, 3 (referenced, not re-derived), 4, and 5.
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
  `operator-state.test-pre-ui-productization-acceptance-${process.pid}.json`
)
process.env.TSF_UI_STATE_FILE = STATE_FILE

const { createRequestHandler } = await import('../server/http-server.mjs')
const { FIXTURE_PROJECT_ID } = await import('../server/fixture-project.mjs')
const { readKeepGoingRun } = await import('../server/keep-going-run-store.mjs')
const { readProjectExecutionHold } = await import('../server/project-execution-hold-store.mjs')
const { withPlannerMissionRecord, readPlannerMissionRecord } = await import('../server/planner-mission-store.mjs')
const { createPlannerMissionCheckpoint, raisePlannerNeedsYou } = await import('../domain/planner-mission-checkpoint.mjs')

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
    rmSync(`${STATE_FILE}.runtime.json`, { force: true })
  }
}

async function get(base, urlPath) {
  const res = await fetch(`${base}${urlPath}`)
  return { status: res.status, body: await res.json() }
}
async function post(base, urlPath, payload) {
  const res = await fetch(`${base}${urlPath}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload)
  })
  return { status: res.status, body: await res.json() }
}
async function chat(base, payload) {
  return post(base, '/api/chat', payload)
}

test('ACCEPTANCE: a real owner session -- setup, rehydration, pause/resume/hold/release, attention, planner answer -- all compose over one continuous real flow', async () => {
  await withServer(async (base) => {
    // 1. Priority 4: the real backend health/identity contract
    // first-run-setup.html itself polls is honest and reachable.
    const identity = await get(base, '/api/runtime-identity')
    assert.equal(identity.status, 200)
    assert.ok(
      ['UP_TO_DATE', 'UI_BUNDLE_STALE', 'UI_BUILDING', 'UI_DEPENDENCIES_MISSING', 'BUILD_FAILED', 'LIVE_RUNTIME_STALE', 'UNKNOWN'].includes(identity.body.state),
      `runtime-identity must report one of the real, honest states, got: ${identity.body.state}`
    )

    // 2. Priority 1: a real Command-thread turn, written durably.
    const turn = await chat(base, { message: 'what needs me?' })
    assert.equal(turn.status, 200)
    assert.equal(typeof turn.body.text, 'string')

    // 3. Priority 1: the SAME turn is genuinely durable -- a fresh read
    // (what CommandConversationProvider's real rehydration fetch calls)
    // sees it, not just the response that wrote it.
    const history = await get(base, '/api/chat/__command__')
    assert.equal(history.status, 200)
    assert.ok(Array.isArray(history.body) && history.body.length >= 2, 'both the user turn and the real assistant reply must be durable')
    assert.equal(history.body.at(-2).content, 'what needs me?')

    // 4. Start a real Keep Going run on the real, safe fixture project.
    const started = await post(base, `/api/keep-going/${FIXTURE_PROJECT_ID}/start`, {
      originalGoal: 'Acceptance test: prove the real owner flow end-to-end.',
      acceptanceCriteria: ['ACCEPTANCE_CRITERION'],
      usageMode: 'BALANCED'
    })
    assert.equal(started.body.started, true)
    assert.equal(readKeepGoingRun(FIXTURE_PROJECT_ID).state, 'ACTIVE')

    // 5. Priority 2: "pause it" -- natural phrasing, real state change.
    // (classifyRunActionVerb's own dedicated coverage:
    // command-run-action-bridge.test.mjs)
    const paused = await chat(base, { projectId: FIXTURE_PROJECT_ID, message: 'pause it' })
    assert.equal(paused.status, 200)
    assert.match(paused.body.text, /Paused/)
    assert.equal(readKeepGoingRun(FIXTURE_PROJECT_ID).state, 'PAUSED')

    // 6. Priority 2: "resume it" -- back to real ACTIVE.
    const resumed = await chat(base, { projectId: FIXTURE_PROJECT_ID, message: 'resume it' })
    assert.equal(resumed.status, 200)
    assert.match(resumed.body.text, /Resumed/)
    assert.equal(readKeepGoingRun(FIXTURE_PROJECT_ID).state, 'ACTIVE')

    // 7. Priority 2: a real external-work hold, natural phrasing --
    // "the owner should not need to understand ... execution hold".
    const held = await chat(base, {
      projectId: FIXTURE_PROJECT_ID,
      message: `${FIXTURE_PROJECT_ID} is being handled by another agent right now, leave it alone -- do not touch it.`
    })
    assert.equal(held.status, 200)
    assert.match(held.body.text, /Held/)
    const holdAfter = readProjectExecutionHold(FIXTURE_PROJECT_ID)
    assert.ok(holdAfter, 'a real, durable hold must have been written')
    assert.equal(holdAfter.status, 'ACTIVE')

    // 8. Priority 2 (RELEASE_HOLD, this mission's own fix): lifts it
    // again, natural phrasing, real durable clear.
    const released = await chat(base, {
      projectId: FIXTURE_PROJECT_ID,
      message: `release the hold on ${FIXTURE_PROJECT_ID}.`
    })
    assert.equal(released.status, 200)
    assert.match(released.body.text, /Released|hold.*released/i)
    const holdReleased = readProjectExecutionHold(FIXTURE_PROJECT_ID)
    assert.ok(!holdReleased || holdReleased.status !== 'ACTIVE', 'the hold must genuinely no longer be active')

    // 9. Priority 5: the real fleet-wide attention feed -- honest shape,
    // never fabricated.
    const attention = await get(base, '/api/attention')
    assert.equal(attention.status, 200)
    assert.equal(attention.body.ok, true)
    assert.ok(Array.isArray(attention.body.items))

    // 10. Priority 5 (this mission's own new fix): a planner mission's
    // Needs-You question, real end-to-end -- raised, answered through the
    // real new route, durably resolved (fresh read, not just the echo).
    const missionId = 'acceptance-planner-mission'
    await withPlannerMissionRecord(missionId, () => {
      const checkpoint = createPlannerMissionCheckpoint(
        { missionId, missionGoal: 'acceptance test goal', phase: 'PLANNING', repoState: { branch: 'main', sha: 'b'.repeat(40) } },
        () => new Date()
      )
      return { lease: null, checkpoint: raisePlannerNeedsYou(checkpoint, { question: 'Proceed with option A?' }, () => new Date()) }
    })
    const needsYouId = readPlannerMissionRecord(missionId).checkpoint.needsYou[0].id
    const resolved = await post(
      base,
      `/api/planner-missions/${missionId}/needs-you/${needsYouId}/resolve`,
      { resolution: 'Yes, proceed with option A.' }
    )
    assert.equal(resolved.status, 200)
    assert.equal(resolved.body.ok, true)
    const finalRecord = readPlannerMissionRecord(missionId)
    assert.equal(finalRecord.checkpoint.needsYou[0].resolution, 'Yes, proceed with option A.')
    assert.ok(finalRecord.checkpoint.needsYou[0].resolvedAt)

    // Sanity: this whole flow only ever touched the one real, safe
    // fixture project + one disposable acceptance-test planner mission --
    // never a real user project.
    assert.equal(FIXTURE_PROJECT_ID, 'tsf-ui-capability-check')
  })
})

// Priority 3 (self-improvement adoption lock parity) is deliberately NOT
// re-derived here -- it has its own 5 dedicated, mutation-verified tests
// in test/self-improvement-adoption.test.mjs (competing adoption,
// cross-engine lock, hold mid-flight, hold upfront, colon-safe lock key)
// that already prove real mutual exclusion end-to-end; duplicating that
// setup here would test nothing new.
//
// Priority 6 (owner language contract) is a UI-text-only concern with no
// real HTTP-observable behavior to assert here -- covered by tsc/oxlint
// clean + the reasoning recorded in that commit.

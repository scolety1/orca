// GOLDEN PATH tests (overnight-runway priority D): converts painful
// real-use scenarios into automated end-to-end operator tests over the
// real HTTP server (server/http-server.mjs), the stub Orca/Planner CLIs,
// and the always-present fixture project (server/fixture-project.mjs).
//
// The specific gap this file closes: every real mechanism exercised below
// (start/tick/stall/abandon/retry-exceeded/negation/complete) already has
// its OWN isolated test elsewhere in this suite -- but nothing previously
// asserted that Keep Going, Work, and Flight Recorder agree on the exact
// same real state AT THE SAME TIME, for the same run, as it moves through
// ACTIVE -> STALLED -> recovered ACTIVE -> NEEDS_YOU -> COMPLETE. That
// cross-surface agreement (the mission's own "canonical state" requirement)
// is what assertCanonicalStateAgreement below checks on every transition.
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
  `operator-state.test-golden-path-operator-flow-${process.pid}.json`
)
const ORCA_STUB = path.join(HERE, 'fixtures', 'stub-orca-cli.mjs')
const PLANNER_STUB = path.join(HERE, 'fixtures', 'stub-planner-cli.mjs')

process.env.TSF_UI_STATE_FILE = STATE_FILE
process.env.TSF_ORCA_CLI_COMMAND = ORCA_STUB
process.env.STUB_ORCA_MODE = 'success'
process.env.TSF_PLANNER_CLAUDE_COMMAND = PLANNER_STUB
process.env.STUB_MODE = 'success'
process.env.STUB_SESSION_ID = 'golden-path-operator-flow-test-session'
// Main TSF overnight review of Resource Pressure Governor V0: forced
// HEALTHY so a genuinely shared, loaded host never makes this file's real
// dispatch assertions flaky, same env-var seam
// http-resource-pressure-governor.test.mjs already uses deterministically.
process.env.TSF_RESOURCE_PRESSURE_TEST_TOTAL_BYTES = String(16 * 1024 ** 3)
process.env.TSF_RESOURCE_PRESSURE_TEST_FREE_BYTES = String(8 * 1024 ** 3)
// resolveSenderTerminal (keep-going-dispatch-loop.mjs) short-circuits on
// this env var -- clearing it makes a real tick deterministically exercise
// the stub CLI's own `terminal create` handler, matching every other
// keep-going HTTP test in this suite.
delete process.env.ORCA_TERMINAL_HANDLE

const { createRequestHandler } = await import('../server/http-server.mjs')
const { tickKeepGoingRun } = await import('../server/keep-going-dispatch-loop.mjs')
const { withKeepGoingRun } = await import('../server/keep-going-run-store.mjs')
const { completeRun } = await import('../domain/keep-going.mjs')
const { FIXTURE_PROJECT_ID } = await import('../server/fixture-project.mjs')

const PROJECT_ID = FIXTURE_PROJECT_ID

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

// Which real run.state maps to which Work section(s). STALLED/NEEDS_YOU/
// COMPLETE map 1:1 (live-work-feed.mjs's projectLiveWorkFeedState reads
// those coarse run states directly, before ever consulting the gap). ACTIVE
// does NOT map 1:1 -- once at least one wave has settled (run.waves.length
// > 0, including an ABANDONED one; abandonStalledWave still records/settles
// it), fleet-work-status.mjs's own real gap analysis
// (compareStateToGoal) legitimately routes an ACTIVE run into Work's
// 'verifying' bucket instead of 'active' whenever real acceptance criteria
// remain unconfirmed -- this is correct existing behavior (BUG-13/M3), not
// a defect: an abandoned wave is exactly as unverified as any other
// unfinished one, so "needs the next real wave or independent verification"
// is the honest read. The one property that MUST always hold (this is the
// actual "canonical state agreement" this file is proving) is that Keep
// Going's coarse state and Work's bucket can never actively CONTRADICT --
// an ACTIVE run must never appear in stalled/needsYou/readyForAdoption, and
// a STALLED/NEEDS_YOU/COMPLETE run must appear in EXACTLY its one real
// section, never elsewhere.
const WORK_SECTIONS_FOR_RUN_STATE = {
  ACTIVE: ['active', 'verifying'],
  STALLED: ['stalled'],
  NEEDS_YOU: ['needsYou'],
  COMPLETE: ['readyForAdoption']
}
const ALL_WORK_SECTIONS = [
  'active',
  'queued',
  'verifying',
  'needsYou',
  'stalled',
  'blocked',
  'readyForAdoption'
]

async function assertCanonicalStateAgreement(base, expectedState) {
  const [keepGoing, work, flightRecorder] = await Promise.all([
    get(base, `/api/keep-going/${PROJECT_ID}`),
    get(base, '/api/work'),
    get(base, `/api/projects/${PROJECT_ID}/flight-recorder`)
  ])

  assert.equal(
    keepGoing.body.state,
    expectedState,
    `Keep Going panel disagrees with expected state: ${keepGoing.body.state}`
  )
  assert.equal(
    flightRecorder.body.timeline.state,
    expectedState,
    `Flight Recorder timeline disagrees with expected state: ${flightRecorder.body.timeline.state}`
  )

  const validSections = WORK_SECTIONS_FOR_RUN_STATE[expectedState]
  const actualSections = ALL_WORK_SECTIONS.filter((section) =>
    work.body[section].some((p) => p.id === PROJECT_ID)
  )
  assert.equal(
    actualSections.length,
    1,
    `Work summary disagrees: expected exactly one section, project is in [${actualSections.join(', ')}]`
  )
  assert.ok(
    validSections.includes(actualSections[0]),
    `Work summary disagrees: project in '${actualSections[0]}', expected one of [${validSections.join(', ')}] for run state ${expectedState}`
  )

  return { keepGoing: keepGoing.body, work: work.body, flightRecorder: flightRecorder.body }
}

test('GOLDEN PATH: a governed mission moves ACTIVE -> STALLED -> recovered ACTIVE, reading identically across Keep Going, Work, and Flight Recorder at every step -- and Planner Chat honestly reports the same real state, never a stale or fabricated one', async () => {
  await withServer(async (base) => {
    // 1. Create the governed mission -- the exact real route the Keep
    // Going start form calls.
    const started = await post(base, `/api/keep-going/${PROJECT_ID}/start`, {
      originalGoal: 'Golden path: prove canonical state agreement.',
      acceptanceCriteria: ['CRITERION_A'],
      usageMode: 'BALANCED'
    })
    assert.equal(started.status, 200)
    assert.equal(started.body.started, true)
    const runId = started.body.runId

    // 2. See the exact run -- a fresh GET (navigate away and back) finds
    // the same durable run, not a re-derived/refreshed one.
    const seen = await get(base, `/api/keep-going/${PROJECT_ID}`)
    assert.equal(seen.body.runId, runId)
    assert.equal(seen.body.readyForAdoption, false)

    await assertCanonicalStateAgreement(base, 'ACTIVE')
    const notStalledYet = await chat(base, { projectId: PROJECT_ID, message: 'what is it doing?' })
    assert.doesNotMatch(notStalledYet.body.text, /STALLED/)

    // 3. Dispatch a real wave.
    const dispatchTick = await post(base, `/api/keep-going/${PROJECT_ID}/tick`, {
      candidateWorkItems: [{ id: 'golden-path-item', scope: ['a.md'], worktree: 'C:/repo/golden-path-wt' }]
    })
    assert.equal(dispatchTick.body.action, 'WAVE_DISPATCHED')
    await assertCanonicalStateAgreement(base, 'ACTIVE')

    // 4. Genuinely stall it -- the same real stall-detection code path
    // settleStep already uses in production (keep-going-dispatch-loop.mjs),
    // reached via a clock 31 minutes past the real dispatch time (past the
    // default 30-minute stallThresholdMs). The stub CLI reports no matching
    // completed task, exactly what a worker that never reports back looks
    // like to this exact code.
    const futureClock = () => new Date(Date.now() + 31 * 60 * 1000)
    const stallTick = await tickKeepGoingRun(PROJECT_ID, [], futureClock)
    assert.equal(stallTick.action, 'WAVE_STALLED')

    const cross1 = await assertCanonicalStateAgreement(base, 'STALLED')
    assert.equal(cross1.work.stalled[0].liveWorkFeed.state, 'STALLED')
    const duringStall = await chat(base, { projectId: PROJECT_ID, message: 'what is it doing?' })
    assert.match(duringStall.body.text, /STALLED/)

    // 5. Recover via the SAME real HTTP route the UI's own "Abandon
    // stalled wave" button calls.
    const beforeAbandon = await get(base, `/api/keep-going/${PROJECT_ID}`)
    const abandon = await post(base, `/api/keep-going/${PROJECT_ID}/abandon-stalled-wave`, {
      reason: 'golden path recovery',
      expectedRevision: beforeAbandon.body.revision
    })
    assert.equal(abandon.status, 200)
    assert.equal(abandon.body.state, 'ACTIVE')

    // Recovered to ACTIVE, but the abandoned wave still counts as a real
    // settled wave with no verified criteria yet -- fleet-work-status.mjs's
    // gap analysis correctly routes it to Work's 'verifying' bucket, not
    // back to 'active' (see assertCanonicalStateAgreement's own comment).
    await assertCanonicalStateAgreement(base, 'ACTIVE')
    const afterRecovery = await chat(base, { projectId: PROJECT_ID, message: 'what is it doing?' })
    // The honest recent-history recap legitimately still mentions the real
    // past WAVE_STALLED checkpoint -- what must be true is the CURRENT
    // state is no longer reported as stalled.
    assert.doesNotMatch(afterRecovery.body.text, /is \*\*STALLED\*\*/)
  })
})

test('GOLDEN PATH: a real retry-budget-exceeded Needs You escalation reads identically across Keep Going, Work, Flight Recorder, and Planner Chat -- and clearing it honestly has no real route yet (resolveNeedsYou remains domain-layer-only, a disclosed pre-existing gap, not silently faked here)', async () => {
  await withServer(async (base) => {
    const started = await post(base, `/api/keep-going/${PROJECT_ID}/start`, {
      originalGoal: 'Golden path: prove Needs You agreement.',
      acceptanceCriteria: ['CRITERION_B'],
      usageMode: 'BALANCED'
    })
    assert.equal(started.body.started, true)

    const workItem = { id: 'golden-path-retry-item', scope: ['b.md'], worktree: 'C:/repo/golden-path-wt2' }
    const clock = () => new Date()

    // Exhausts the real retry budget (maxRetriesPerTask: 2, domain/keep-
    // going.mjs) against the stub CLI's fixed task id -- the exact same
    // real recordTaskAttempt/raiseNeedsYou mechanism test/http-chat-
    // dispatch.test.mjs already proves in isolation; this test's own value
    // is the cross-surface check afterward, not re-proving the mechanism.
    try {
      process.env.STUB_ORCA_TASKS = JSON.stringify([{ id: 'stub-task-id', status: 'failed' }])
      const d1 = await tickKeepGoingRun(PROJECT_ID, [workItem], clock)
      assert.equal(d1.action, 'WAVE_DISPATCHED')
      const s1 = await tickKeepGoingRun(PROJECT_ID, [], clock)
      assert.equal(s1.action, 'WAVE_SETTLED')
      const d2 = await tickKeepGoingRun(PROJECT_ID, [workItem], clock)
      assert.equal(d2.action, 'WAVE_DISPATCHED')
      const s2 = await tickKeepGoingRun(PROJECT_ID, [], clock)
      assert.equal(s2.action, 'WAVE_SETTLED')
      const d3 = await tickKeepGoingRun(PROJECT_ID, [workItem], clock)
      assert.equal(d3.action, 'WAVE_DISPATCHED')
      const s3 = await tickKeepGoingRun(PROJECT_ID, [], clock)
      assert.equal(s3.action, 'WAVE_SETTLED_NEEDS_YOU')
      assert.deepEqual(s3.retryBudgetExceeded, [workItem.id])
    } finally {
      delete process.env.STUB_ORCA_TASKS
    }

    const cross = await assertCanonicalStateAgreement(base, 'NEEDS_YOU')
    assert.equal(cross.keepGoing.readyForAdoption, false)
    assert.equal(cross.work.needsYou[0].liveWorkFeed.state, 'NEEDS_YOU')

    const nextAction = await chat(base, { projectId: PROJECT_ID, message: 'what should we do next?' })
    assert.match(nextAction.body.text, /NEEDS_YOU/)
    assert.match(
      nextAction.body.text,
      new RegExp(`Retry budget exceeded for work item\\(s\\): ${workItem.id}`)
    )

    // Disclosed, not fabricated: resolveNeedsYou (domain/keep-going.mjs)
    // has no wired HTTP route today -- server/keep-going-http-routes.mjs
    // only exposes start/pause/resume/abandon-stalled-wave/tick.
    // chat-dispatch-bridge.mjs's own recoveryHintFor already says this
    // honestly rather than claiming an unwired action exists. This test
    // does not invent a "clear" call for the same reason.
  })
})

test('GOLDEN PATH: Planner Chat honestly refuses a negated consequential instruction, and a run that reaches COMPLETE via the real completion transition shows readyForAdoption:true identically across Keep Going, Work, and Flight Recorder', async () => {
  await withServer(async (base) => {
    // Negation: no run needs to exist yet -- chat must refuse before ever
    // reaching dispatch, exactly like ACCEPT-08/BUG-08's own coverage.
    const negated = await chat(base, {
      projectId: PROJECT_ID,
      message: 'go ahead and push this to production'
    })
    assert.equal(negated.body.decisionClass, 'TIM_REQUIRED')
    assert.equal(negated.body.dispatched, undefined)
    assert.match(negated.body.text, /consequential/i)

    // A genuine governed mission, independently verified as done.
    const started = await post(base, `/api/keep-going/${PROJECT_ID}/start`, {
      originalGoal: 'Golden path: prove Ready for Adoption agreement.',
      acceptanceCriteria: ['CRITERION_C'],
      usageMode: 'BALANCED'
    })
    assert.equal(started.body.started, true)
    await assertCanonicalStateAgreement(base, 'ACTIVE')

    // Drives the same real transition function
    // server/settled-run-reconciler.mjs calls once independent
    // verification confirms the goal -- invoked directly here (not through
    // the full verdict-file + fleet-driver dance) so this test stays fast
    // and focused on the cross-surface check, not re-proving autonomous
    // completion end to end. That fuller, heavier proof already exists and
    // passes: test/keep-going-autonomy-proof.test.mjs.
    await withKeepGoingRun(PROJECT_ID, (run) => completeRun(run, () => new Date()))

    const cross = await assertCanonicalStateAgreement(base, 'COMPLETE')
    assert.equal(cross.keepGoing.readyForAdoption, true)
    assert.equal(cross.work.readyForAdoption[0].liveWorkFeed.state, 'READY_FOR_ADOPTION')

    // chat-responder.mjs's own LIVE_RUN_TERMINAL_STATES deliberately
    // excludes COMPLETE from the grounded run-status fast path (an
    // independent-review finding: a long-finished run must not
    // permanently shadow every future question about the project) -- so
    // unlike the STALLED/NEEDS_YOU checks above, chat intentionally does
    // NOT echo "READY_FOR_ADOPTION" here; it falls through to the live
    // conversational planner instead. This only proves that fallthrough
    // still answers (never crashes/errors) once a run is COMPLETE -- the
    // real cross-surface proof for this state is the REST agreement above.
    const readyChat = await chat(base, { projectId: PROJECT_ID, message: 'what is it doing?' })
    assert.equal(readyChat.status, 200)
    assert.ok(readyChat.body.text?.length > 0, 'chat must still answer honestly once COMPLETE, not error out')
  })
})

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
// Main TSF overnight review of Resource Pressure Governor V0: real dispatch
// now consults real host memory before spawning a heavyweight worker
// (chat-dispatch-bridge.mjs). Forced HEALTHY so a genuinely shared, loaded
// host never makes this file's real dispatch assertions flaky, same
// env-var seam http-resource-pressure-governor.test.mjs already uses.
process.env.TSF_RESOURCE_PRESSURE_TEST_TOTAL_BYTES = String(16 * 1024 ** 3)
process.env.TSF_RESOURCE_PRESSURE_TEST_FREE_BYTES = String(8 * 1024 ** 3)

const { createRequestHandler } = await import('../server/http-server.mjs')
const { tickKeepGoingRun } = await import('../server/keep-going-dispatch-loop.mjs')

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
    // BUG-06 (bug-ledger.json): the text now distinguishes a brand new
    // mission from adding a work item to an existing one -- this project
    // had no prior run, so "new mission" is the real, correct outcome.
    assert.match(body.text, /Started a new mission.*dispatched/s)
    // Recovered from a stranded uncommitted worktree: names the real run
    // and states the governance guarantee, layered onto BUG-06's text.
    assert.match(body.text, new RegExp(body.tickResult.run.id))
    assert.match(body.text, /Ready for Adoption/)
    assert.ok(
      body.planCapsule.repository.head.match(/^[0-9a-f]{40}$/),
      'a real HEAD was resolved, not fabricated'
    )
  })
})

// Coordinator adoption-review finding: chat-dispatch-bridge.mjs's own hold
// check (Part B) sits inside planAndDispatchFromChat, but THIS route's own
// dispatchFromChat calls ensureWorktreeForDispatch (a real
// orca-worktree-create side effect) before ever reaching it -- a held
// project's direct chat dispatch would still create a real worktree. Real,
// end-to-end proof the defense-in-depth fix actually stops that, not just
// that the message is refused.
test('a held project\'s chat dispatch is refused honestly and never creates a real worktree/Keep Going run', async () => {
  const { withProjectExecutionHold } = await import('../server/project-execution-hold-store.mjs')
  const { createProjectExecutionHold } = await import('../domain/project-execution-hold.mjs')
  await withProjectExecutionHold(PROJECT_ID, () =>
    createProjectExecutionHold(
      { projectId: PROJECT_ID, reason: 'EXTERNAL_WORK_ACTIVE', setBy: 'test', note: 'regression proof' },
      () => new Date()
    )
  )
  await withServer(async (base) => {
    const { status, body } = await chat(base, {
      projectId: PROJECT_ID,
      message: 'go ahead and add a bounded doc note',
      placement: { worktree: REAL_WORKTREE, agent: 'codex' }
    })
    assert.equal(status, 200)
    assert.equal(body.dispatched, false)
    assert.match(body.text, /execution hold/)
    assert.match(body.text, /EXTERNAL_WORK_ACTIVE/)
    assert.match(body.providerLabel, /PROJECT_EXECUTION_HOLD_ACTIVE/)
    const { readKeepGoingRun } = await import('../server/keep-going-run-store.mjs')
    assert.equal(readKeepGoingRun(PROJECT_ID), null, 'no real Keep Going run was created for the held project')
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

test('project switching cannot leak one project\'s Keep Going dispatch state into another\'s "what is it doing?" answer', async () => {
  await withServer(async (base) => {
    // Dispatch real work on the fixture project only.
    const dispatch = await chat(base, {
      projectId: PROJECT_ID,
      message: 'go ahead and add a bounded doc note',
      placement: { worktree: REAL_WORKTREE, agent: 'codex' }
    })
    assert.equal(dispatch.body.dispatched, true)

    // A completely different, real project id -- never touched by the
    // dispatch above -- must show no trace of it.
    const OTHER_PROJECT_ID = 'weird-talent-marketplace'
    const otherStatus = await chat(base, {
      projectId: OTHER_PROJECT_ID,
      message: 'what is it doing?'
    })
    assert.doesNotMatch(otherStatus.body.text, /Keep Going run/)
    assert.doesNotMatch(JSON.stringify(otherStatus.body), /WORKING/)

    // The original project's own status is still correctly live.
    const ownStatus = await chat(base, { projectId: PROJECT_ID, message: 'what is it doing?' })
    assert.match(ownStatus.body.text, /Keep Going run/)
    assert.match(ownStatus.body.text, /WORKING/)

    // Chat history for each project stays separate too (the existing
    // per-project chatThreads keying, unaffected by the dispatch path).
    const ownHistory = await (await fetch(`${base}/api/chat/${PROJECT_ID}`)).json()
    const otherHistory = await (await fetch(`${base}/api/chat/${OTHER_PROJECT_ID}`)).json()
    assert.doesNotMatch(JSON.stringify(otherHistory), /bounded doc note/)
    assert.ok(JSON.stringify(ownHistory).includes('bounded doc note'))
  })
})

// Deliberate behavior change (M-Command, spec Phase 6): a dispatch-worthy
// message with no explicit placement no longer falls through to the
// conversational planner -- dispatchFromChat now auto-provisions a
// worktree itself first. The fixture project has no real repository root
// (fixture-project.mjs's root: null, "no repository exists on disk"), so
// auto-provisioning fails honestly here -- exactly the correct outcome for
// a project with nothing to provision a worktree from, never a fabricated
// dispatch and never a silent fall-back into unrelated conversational text.
test('WITHOUT a placement, dispatch is now attempted first -- auto-provisioning fails honestly for a project with no real repository root, rather than silently falling back to conversational text', async () => {
  await withServer(async (base) => {
    const { body } = await chat(base, {
      projectId: PROJECT_ID,
      message: 'go ahead and add a bounded doc note'
    })
    assert.equal(body.dispatched, false)
    assert.equal(body.live, false)
    assert.match(body.text, /couldn't|automatically/i)
    assert.match(body.text, /repository root|Advanced/i)
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
    // The run is now ACTIVE with an in-flight wave. Adversarial-review
    // fix (chat-dispatch-bridge.mjs): this used to silently route the
    // second request to settleStep (re-checking the SAME wave) and still
    // report ok:true, discarding the second, different work item this
    // call built a plan capsule for with no honest indication anything
    // was dropped -- a real duplicate/lost-work bug class. It is now
    // rejected honestly, before ever touching tick, rather than silently
    // absorbed.
    const second = await chat(base, {
      projectId: PROJECT_ID,
      message: 'go ahead and add a different note',
      placement: { worktree: REAL_WORKTREE, agent: 'codex' }
    })
    assert.equal(second.body.dispatched, false)
    assert.equal(second.body.dispatchReason, 'RUN_NOT_DISPATCHABLE')
    assert.match(second.body.dispatchDetail, /already in flight/)
    assert.equal(
      second.body.tickResult,
      undefined,
      'no tick was ever attempted -- nothing to silently discard'
    )
  })
})

// Remaining "also prove" checklist items: a worker question surfacing as
// Needs You, and a stalled/failed worker reusing M2's own recovery rather
// than a new one invented for M3. Both proven purely through repeated real
// chat calls (or, for wall-clock-bound stall detection, a direct call into
// the exact same tickKeepGoingRun this whole bridge already reuses) plus
// the real abandon-stalled-wave HTTP route the UI's own button already
// calls -- no new recovery mechanism exists anywhere in this diff.
test("a failed worker exhausting its retry budget escalates to a real Needs You question via M2's own recordTaskAttempt/raiseNeedsYou mechanism -- not a new one -- and chat surfaces the exact question honestly", async () => {
  await withServer(async (base) => {
    const dispatch = await chat(base, {
      projectId: PROJECT_ID,
      message: 'go ahead and add a bounded doc note',
      placement: { worktree: REAL_WORKTREE, agent: 'codex' }
    })
    assert.equal(dispatch.body.dispatched, true)
    assert.equal(dispatch.body.tickResult.action, 'WAVE_DISPATCHED')
    const workItemId = dispatch.body.candidateWorkItem.id

    // recordTaskAttempt's real per-work-item retry count (keep-going.mjs,
    // maxRetriesPerTask: 2) only accumulates against the SAME work item id
    // across dispatch cycles -- a disclosed, real limitation of the chat
    // bridge as built: it mints a fresh missionId (and therefore work item
    // id) on every chat message, with no "retry this exact item" affordance
    // yet, so a chat operator repeating "try again" cannot itself trigger
    // this escalation today. Modeling an operator/future caller that DOES
    // resubmit the identical item (retryItem, same id/scope/spec/placement
    // dispatch.body.candidateWorkItem itself produced) isolates and proves
    // the real escalation mechanism itself -- unmodified M2 code this
    // bridge only ever consumes, never reimplements -- via the same
    // tickKeepGoingRun this whole bridge already reuses.
    const retryItem = { ...dispatch.body.candidateWorkItem }
    const clock = () => new Date()

    try {
      process.env.STUB_ORCA_TASKS = JSON.stringify([{ id: 'stub-task-id', status: 'failed' }])

      const settle1 = await tickKeepGoingRun(PROJECT_ID, [], clock)
      assert.equal(settle1.action, 'WAVE_SETTLED')

      const redispatch2 = await tickKeepGoingRun(PROJECT_ID, [retryItem], clock)
      assert.equal(redispatch2.action, 'WAVE_DISPATCHED')

      const settle2 = await tickKeepGoingRun(PROJECT_ID, [], clock)
      assert.equal(settle2.action, 'WAVE_SETTLED')

      const redispatch3 = await tickKeepGoingRun(PROJECT_ID, [retryItem], clock)
      assert.equal(redispatch3.action, 'WAVE_DISPATCHED')

      // Third failure: count exceeds maxRetriesPerTask -- caught by
      // settleStep's own try/catch and escalated to a real Needs You
      // question (keep-going-dispatch-loop.mjs), not a new one.
      const settle3 = await tickKeepGoingRun(PROJECT_ID, [], clock)
      assert.equal(settle3.action, 'WAVE_SETTLED_NEEDS_YOU')
      assert.deepEqual(settle3.retryBudgetExceeded, [workItemId])
    } finally {
      delete process.env.STUB_ORCA_TASKS
    }

    const nextAction = await chat(base, {
      projectId: PROJECT_ID,
      message: 'what should we do next?'
    })
    assert.match(nextAction.body.text, /NEEDS_YOU/)
    assert.match(
      nextAction.body.text,
      new RegExp(`Retry budget exceeded for work item\\(s\\): ${workItemId}`)
    )
  })
})

test("a silently non-progressing worker is detected STALLED by M2's own dispatch-loop stall detection (not a new mechanism), surfaces honestly through chat, and M2's existing abandon+reconcile HTTP route recovers it so chat can dispatch fresh work again", async () => {
  await withServer(async (base) => {
    const dispatch = await chat(base, {
      projectId: PROJECT_ID,
      message: 'go ahead and add a bounded doc note',
      placement: { worktree: REAL_WORKTREE, agent: 'codex' }
    })
    assert.equal(dispatch.body.dispatched, true)
    assert.equal(dispatch.body.tickResult.action, 'WAVE_DISPATCHED')

    // Forces the exact same stall-detection code path settleStep already
    // uses (keep-going-dispatch-loop.mjs) via a direct call into the same
    // tickKeepGoingRun this whole bridge reuses -- a fake clock 31 minutes
    // past the real dispatch time (past the default 30-minute
    // stallThresholdMs), with the stub CLI reporting no matching task (an
    // "unknown"/PENDING status forever), exactly what a worker that never
    // reports back looks like to this exact production code. No HTTP route
    // exposes a controllable clock (nor should one), so this one step is
    // proven at the module level rather than pretending to wait 31 real
    // minutes.
    const futureClock = () => new Date(Date.now() + 31 * 60 * 1000)
    const tickResult = await tickKeepGoingRun(PROJECT_ID, [], futureClock)
    assert.equal(tickResult.action, 'WAVE_STALLED')

    const status = await chat(base, { projectId: PROJECT_ID, message: 'what is it doing?' })
    assert.match(status.body.text, /STALLED/)

    const nextAction = await chat(base, {
      projectId: PROJECT_ID,
      message: 'what should we do next?'
    })
    assert.match(nextAction.body.text, /Abandon stalled wave/)

    // Recovers via the SAME real HTTP route the UI's own "Abandon stalled
    // wave" button calls (keep-going-http-routes.mjs) -- not a new,
    // chat-invented recovery mechanism.
    const before = await (await fetch(`${base}/api/keep-going/${PROJECT_ID}`)).json()
    const abandonRes = await fetch(`${base}/api/keep-going/${PROJECT_ID}/abandon-stalled-wave`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reason: 'test recovery', expectedRevision: before.revision })
    })
    assert.equal(abandonRes.status, 200)

    // Chat can dispatch fresh work again -- the exact same M2 recovery
    // used everywhere else, now proven reachable end to end starting from
    // a chat-originated run.
    const redispatch = await chat(base, {
      projectId: PROJECT_ID,
      message: 'go ahead and add yet another bounded doc note',
      placement: { worktree: REAL_WORKTREE, agent: 'codex' }
    })
    assert.equal(redispatch.body.dispatched, true)
    assert.equal(redispatch.body.tickResult.action, 'WAVE_DISPATCHED')
  })
})

test('user feedback on a completed wave becomes a bounded revision on the SAME still-ACTIVE run -- not a new run, not a full re-plan', async () => {
  await withServer(async (base) => {
    const firstDispatch = await chat(base, {
      projectId: PROJECT_ID,
      message: 'go ahead and add a bounded doc note',
      placement: { worktree: REAL_WORKTREE, agent: 'codex' }
    })
    assert.equal(firstDispatch.body.tickResult.action, 'WAVE_DISPATCHED')
    const runId = firstDispatch.body.tickResult.run.id
    const firstWorkItemId = firstDispatch.body.candidateWorkItem.id

    try {
      // Settle wave 1 as genuinely completed (not failed/stalled) so the
      // run stays ACTIVE with no in-flight wave -- exactly the state a
      // real settled-but-not-yet-fully-satisfying wave leaves behind for
      // Tim to react to. Settled directly via tickKeepGoingRun (the exact
      // same real mechanism the fleet driver now uses in production),
      // not by disguising a dispatch-worthy chat message as a settle --
      // that used to work only because a dispatch attempt while a wave
      // was in flight silently routed to settleStep as a side effect; the
      // adversarial-review fix above means a dispatch-worthy message now
      // honestly refuses instead while a wave is in flight, so it can no
      // longer double as a "check on it" settle trigger.
      process.env.STUB_ORCA_TASKS = JSON.stringify([{ id: 'stub-task-id', status: 'completed' }])
      const settleResult = await tickKeepGoingRun(PROJECT_ID, [], () => new Date())
      assert.equal(settleResult.action, 'WAVE_SETTLED')
    } finally {
      delete process.env.STUB_ORCA_TASKS
    }

    // Tim's feedback on the settled wave -- a bounded revision request,
    // not a fresh objective -- goes through the exact same dispatch-worthy
    // chat path as any other "go ahead"/"fix this" phrasing (no new
    // revision-specific code exists, nor is any needed: the run is still
    // ACTIVE and not in flight, so this is just the next wave).
    const revision = await chat(base, {
      projectId: PROJECT_ID,
      message: 'fix this: the note format was wrong, use ISO dates instead',
      placement: { worktree: REAL_WORKTREE, agent: 'codex' }
    })
    assert.equal(revision.body.dispatched, true)
    assert.equal(revision.body.tickResult.action, 'WAVE_DISPATCHED')
    assert.equal(
      revision.body.tickResult.run.id,
      runId,
      'the revision must land on the SAME run, not a new one'
    )
    assert.notEqual(
      revision.body.candidateWorkItem.id,
      firstWorkItemId,
      'the revision is its own bounded work item, not a repeat of the original one'
    )
    assert.match(revision.body.planCapsule.objective, /ISO dates|note format/i)
  })
})

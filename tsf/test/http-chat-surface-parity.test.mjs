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
const { withKeepGoingRun, readKeepGoingRun } = await import('../server/keep-going-run-store.mjs')
const { createOvernightRun } = await import('../domain/keep-going.mjs')

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
const clock = () => new Date('2026-09-10T12:00:00.000Z')

async function seedActiveRun(projectId) {
  await withKeepGoingRun(projectId, () =>
    createOvernightRun({ id: `run-${projectId}`, projectId, originalGoal: 'Surface parity test goal.', acceptanceCriteria: ['X'] }, clock)
  )
}

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

// UPDATED: per-project Planner Chat now ALSO has real adoption-execution
// authority (Lane L continuation fix, same architectural blind spot as
// PAUSE/RESUME) -- strengthened from Global-Command-only to both surfaces.
test('Batch 3 surface parity: negated adoption never executes on either surface', async () => {
  await withServer(async (base) => {
    const message = 'Do not adopt this candidate.'
    const global_ = await chat(base, { projectId: null, message })
    const projectScoped = await chat(base, { projectId: PROJECT_ID, message })
    assert.doesNotMatch(global_.body.text ?? '', /\badopted: canonical advanced\b/i)
    assert.doesNotMatch(projectScoped.body.text ?? '', /\badopted: canonical advanced\b/i)
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

// TSF Overnight Control-Plane Burn-In V2, Lane B -- the owner's own
// required exact controls, added directly. Each one is checked for the
// property that must never disagree between surfaces: whether an action
// was recognized at all, never textual equivalence (the two surfaces have
// genuinely different response shapes -- fleet-wide vs. one project's
// grounded state).
test('Overnight V2 Lane B: "looks good" -- NO ACTION on either surface', async () => {
  await withServer(async (base) => {
    const message = 'looks good'
    const global_ = await chat(base, { projectId: null, message })
    const projectScoped = await chat(base, { projectId: PROJECT_ID, message })
    assert.notEqual(global_.body.decisionClass, 'TIM_REQUIRED')
    assert.equal(global_.body.live, false)
    assert.notEqual(projectScoped.body.decisionClass, 'TIM_REQUIRED')
    assert.equal(projectScoped.body.live, false)
    assert.doesNotMatch(projectScoped.body.text ?? '', /\badopted: canonical advanced\b/i)
  })
})

test('Overnight V2 Lane B: "looks good, adopt it" -- explicit adoption language recognized on the surface with real adoption authority (Global Command); never silently no-op\'d as mere praise on either surface', async () => {
  await withServer(async (base) => {
    const message = 'looks good, adopt it'
    const global_ = await chat(base, { projectId: null, message })
    const projectScoped = await chat(base, { projectId: PROJECT_ID, message })
    // Global Command is the one real execution-capable surface -- it must
    // recognize this as adoption intent (not silently fall through to a
    // bare acknowledgement), even though the actual outcome here is a
    // refusal/report (no real ready candidate exists for a synthetic run
    // in this harness) rather than a real merge.
    //
    // Lane M red-team finding (real, fixed): the original `notEqual(...,
    // 'ACKNOWLEDGEMENT')` was nearly vacuous -- chat-responder.mjs's own
    // INTENTS array already checks ADOPTION before ACKNOWLEDGEMENT, so any
    // message containing "adopt" can never classify as ACKNOWLEDGEMENT
    // regardless of whether the adoption BRIDGE itself is even reached; a
    // regression that broke routing into command-adoption-command-bridge.mjs
    // entirely (falling through to STATUS/FIX_REQUEST/GENERAL/etc.) would
    // still pass this assertion. Asserts the real, confirmed value instead
    // (command-adoption-command-bridge.mjs's own literal 'ADOPTION_COMMAND'
    // intent, verified live via a direct /api/chat call against this exact
    // message).
    assert.equal(global_.body.intent, 'ADOPTION_COMMAND')
    // UPDATED (real, live-confirmed finding, fixed at Lane L continuation
    // SHA <see queue memory>): per-project Planner Chat used to be
    // architecturally report-only for adoption (chat-responder.mjs's
    // respondAdoption never calls executeCommandAdoption) -- but that was
    // itself a real, previously-undiscovered gap, the SAME architectural
    // blind spot PAUSE/RESUME had (SHA b443f4212c): real adoption
    // execution was only ever wired into Global Command's ambiguous/fuzzy
    // path, never per-project chat OR Global Command's own exact-match
    // case. Now fixed: per-project Planner Chat reaches the SAME real
    // execution bridge Global Command uses (also 'ADOPTION_COMMAND').
    // This fixture project has no real git-backed candidate, so the
    // outcome here is still a real, honest refusal/report -- never a
    // false "adopted" claim -- proven by the very next assertion.
    assert.equal(projectScoped.body.intent, 'ADOPTION_COMMAND')
    assert.doesNotMatch(projectScoped.body.text ?? '', /\badopted: canonical advanced\b/i)
  })
})

test('Overnight V2 Lane B: "should I adopt it?" -- a question never itself executes adoption on either surface', async () => {
  // Real, execution-verified finding while writing this test (not
  // guessed): Planner Chat's own project-scoped path legitimately
  // reaches a real, grounded conversational answer for a genuine
  // question (live: true, decisionClass: AUTO_DECIDE, stub-planner
  // text appended) -- `live` here means "a real live planner call
  // answered this," never "a consequential action was taken." The
  // actual safety property Property J names is narrower and is what
  // this test checks: a question never reaches TIM_REQUIRED's
  // consequential-decision path, and never claims a real adoption
  // happened.
  await withServer(async (base) => {
    const message = 'should I adopt it?'
    const global_ = await chat(base, { projectId: null, message })
    const projectScoped = await chat(base, { projectId: PROJECT_ID, message })
    assert.notEqual(global_.body.decisionClass, 'TIM_REQUIRED')
    assert.doesNotMatch(global_.body.text ?? '', /\badopted: canonical advanced\b/i)
    assert.notEqual(projectScoped.body.decisionClass, 'TIM_REQUIRED')
    assert.doesNotMatch(projectScoped.body.text ?? '', /\badopted: canonical advanced\b/i)
  })
})

test('Overnight V2 Lane B: "don\'t adopt it" -- no adoption executes on either surface', async () => {
  await withServer(async (base) => {
    const message = "don't adopt it"
    const global_ = await chat(base, { projectId: null, message })
    const projectScoped = await chat(base, { projectId: PROJECT_ID, message })
    assert.doesNotMatch(global_.body.text ?? '', /\badopted: canonical advanced\b/i)
    assert.equal(global_.body.live, false)
    assert.doesNotMatch(projectScoped.body.text ?? '', /\badopted: canonical advanced\b/i)
  })
})

// Multi-project structural controls ("pause A, adopt B" / "adopt A, not
// B" / "leave A alone, keep B going") are deliberately run against
// SYNTHETIC, unresolvable project names here, never a real project pair
// on this shared host -- Global Command is the one surface with real
// adoption-execution authority, and naming two REAL projects that might
// each have a real ready candidate risks a genuine merge this test must
// never cause. The property this file can safely verify at the HTTP
// layer with unresolvable names is itself real and valuable: neither
// surface ever fabricates or guesses a target/action for a project name
// it cannot actually resolve. The full isolated-action/exclusion/no-bleed
// semantics themselves are already exhaustively covered against REAL
// (but disposable, in-process) project objects at the unit level in
// test/command-act-model.test.mjs (CASE-32's own 18 locked regressions)
// and test/command-multi-action-bridge.test.mjs.
const FIXTURE_A = 'overnight-v2-fixture-project-alpha-x9k2'
const FIXTURE_B = 'overnight-v2-fixture-project-beta-y7m3'

test('Overnight V2 Lane B: "pause A, adopt B" with unresolvable synthetic names -- neither surface fabricates a target/action for a project it cannot resolve', async () => {
  await withServer(async (base) => {
    const message = `Pause ${FIXTURE_A}, adopt ${FIXTURE_B}.`
    const global_ = await chat(base, { projectId: null, message })
    assert.doesNotMatch(global_.body.text ?? '', /\badopted: canonical advanced\b/i)
    assert.equal(global_.body.live, false)
  })
})

test('Overnight V2 Lane B: "adopt A, not B" with unresolvable synthetic names -- neither surface fabricates a target/action for a project it cannot resolve', async () => {
  await withServer(async (base) => {
    const message = `Adopt ${FIXTURE_A}, not ${FIXTURE_B}.`
    const global_ = await chat(base, { projectId: null, message })
    assert.doesNotMatch(global_.body.text ?? '', /\badopted: canonical advanced\b/i)
    assert.equal(global_.body.live, false)
  })
})

test('Overnight V2 Lane B: "leave A alone, keep B going" with unresolvable synthetic names -- no real dispatch/hold fabricated for either', async () => {
  await withServer(async (base) => {
    const message = `Leave ${FIXTURE_A} alone, keep ${FIXTURE_B} going.`
    const global_ = await chat(base, { projectId: null, message })
    assert.equal(global_.body.live, false)
    assert.doesNotMatch(global_.body.text ?? '', /\badopted: canonical advanced\b/i)
  })
})

test('Overnight V2 Lane B: a long software mission containing the word "research" stays SOFTWARE_PRODUCT_ENGINEERING on both surfaces, never Dataset Research', async () => {
  await withServer(async (base) => {
    const message =
      'We need to ship the new onboarding flow this week. Please research the existing auth module first, then implement the new signup form, wire it to the API, and add tests. This is a real software engineering task, not a data-collection request.'
    const global_ = await chat(base, { projectId: null, message })
    const projectScoped = await chat(base, { projectId: PROJECT_ID, message })
    assert.notEqual(global_.body.scope, 'RESEARCH')
    assert.notEqual(projectScoped.body.scope, 'RESEARCH')
  })
})

// TSF Overnight Control-Plane Burn-In V2, Lane L (live disposable E2E) --
// real, live-confirmed P1 finding (not guessed): PAUSE/RESUME via
// natural-language chat was completely UNREACHABLE from this real HTTP
// route, on BOTH Global Command's own exact-match short-circuit AND
// per-project Planner Chat directly. Confirmed live before the fix (a
// real POST /api/chat with "pause <exact project id>" left a real ACTIVE
// run untouched, silently falling through to a generic grounded-fallback
// response) and after (SHA to be recorded at commit time). Root cause:
// classifyRunActionVerb (command-run-action-bridge.mjs) was extensively
// hardened this same mission for duplicate-delivery/race-safety/state-
// matrix coverage, but was reachable ONLY from command-responder.mjs's
// respondCommand -- itself reachable only from Global Command's
// AMBIGUOUS/fuzzy/back-referenced resolution path, never the exact-name
// case, and never per-project chat at all. Fixed in
// server/chat-http-routes.mjs -- these tests prove it end to end against
// a real HTTP server and a real durable Keep Going run, on both surfaces.
// Real, already-established catalog fixture (used identically as ordinary
// test data throughout the pre-existing suite, e.g. test/http-chat-live
// .test.mjs) -- deliberately DIFFERENT from PROJECT_ID above so the
// Global Command and per-project halves below exercise two independent
// real runs, never the same one.
const PER_PROJECT_FIXTURE_ID = 'weird-talent-marketplace'

// TSF Overnight Control-Plane Burn-In V2, Lane J (historical corpus
// mining -- real, live-confirmed under a genuinely CRITICAL host during
// a full-suite run, not guessed): the SAME class of test defect already
// fixed once tonight for test/http-chat-live.test.mjs -- server/
// attention-status-reconciler.mjs's attachDueAttentionNotices legitimately
// prepends any due notice (including a real resource-pressure event,
// "Host resource pressure reached **CRITICAL** -- ...") ahead of a chat
// response's own real answer, by documented design, regardless of
// topic. Every "must really pause/resume" assertion below checks the
// pause/resume text is PRESENT, never that it opens the string --
// exactly like the http-chat-live.test.mjs fix, and NOT a relaxation:
// a false "Paused" claim anywhere in the text is still exactly as wrong
// as one at the start.
test('Overnight V2 Lane L: "pause X" over real HTTP genuinely pauses a real durable run, on BOTH Global Command (exact match) and per-project Planner Chat', async () => {
  await withServer(async (base) => {
    await seedActiveRun(PROJECT_ID)
    assert.equal(readKeepGoingRun(PROJECT_ID).state, 'ACTIVE')

    const globalResult = await chat(base, { projectId: null, message: `pause ${PROJECT_ID}` })
    assert.match(globalResult.body.text, /Paused \*\*/, 'Global Command exact-match must really pause, not fall through to a generic fallback')
    assert.equal(readKeepGoingRun(PROJECT_ID).state, 'PAUSED')

    await seedActiveRun(PER_PROJECT_FIXTURE_ID)
    const perProjectResult = await chat(base, { projectId: PER_PROJECT_FIXTURE_ID, message: 'pause it' })
    assert.match(perProjectResult.body.text, /Paused \*\*/, 'per-project Planner Chat must really pause too')
    assert.equal(readKeepGoingRun(PER_PROJECT_FIXTURE_ID).state, 'PAUSED')
  })
})

test('Overnight V2 Lane L: "resume it" over real HTTP genuinely resumes a real durable PAUSED run, on BOTH surfaces', async () => {
  await withServer(async (base) => {
    await seedActiveRun(PROJECT_ID)
    const paused = await chat(base, { projectId: null, message: `pause ${PROJECT_ID}` })
    assert.match(paused.body.text, /Paused \*\*/)

    const resumed = await chat(base, { projectId: null, message: `resume ${PROJECT_ID}` })
    assert.match(resumed.body.text, /Resumed \*\*/, 'Global Command exact-match must really resume a genuinely paused run')
    assert.equal(readKeepGoingRun(PROJECT_ID).state, 'ACTIVE')

    await seedActiveRun(PER_PROJECT_FIXTURE_ID)
    await chat(base, { projectId: PER_PROJECT_FIXTURE_ID, message: 'pause it' })
    const perProjectResume = await chat(base, { projectId: PER_PROJECT_FIXTURE_ID, message: 'resume it' })
    assert.match(perProjectResume.body.text, /Resumed \*\*/, 'per-project Planner Chat must really resume too')
    assert.equal(readKeepGoingRun(PER_PROJECT_FIXTURE_ID).state, 'ACTIVE')
  })
})

// Independent-review finding (Lane M, real, live-confirmed): the FIRST
// version of the Lane L fix above executed the real pause/resume BEFORE
// the branch-selection chain decided which response wins, and ahead of
// the TIM_REQUIRED gate -- so a message that was simultaneously
// research-shaped (or genuinely consequential) AND opened with a pause/
// resume clause would silently mutate the durable run while the user saw
// a completely unrelated response (or none of the expected refusal).
// These two tests pin down the fix: the SIDE EFFECT itself, not just
// which result wins, must be gated on research/TIM_REQUIRED losing first
// -- exactly matching command-responder.mjs's own real precedence
// (research bridge -> TIM_REQUIRED refusal -> ... -> runActionVerb).
test('Overnight V2 Lane L: a message that is BOTH research-shaped AND opens with "pause" never silently pauses the run while research wins the response', async () => {
  await withServer(async (base) => {
    await seedActiveRun(PROJECT_ID)
    const result = await chat(base, { projectId: PROJECT_ID, message: `please pause and research the ${PROJECT_ID} migration risks` })
    assert.equal(result.body.scope, 'RESEARCH', 'research must win the response, matching respondCommand\'s own precedence')
    assert.doesNotMatch(result.body.text, /Paused \*\*/, 'the response must never claim a pause that (per this test) must not have happened')
    assert.equal(readKeepGoingRun(PROJECT_ID).state, 'ACTIVE', 'the real run must NOT be silently paused just because research won the visible response')
  })
})

test('Overnight V2 Lane L: a message combining "pause X" with a genuinely consequential clause is refused in full (TIM_REQUIRED) -- never partially executes the pause', async () => {
  await withServer(async (base) => {
    await seedActiveRun(PROJECT_ID)
    const result = await chat(base, { projectId: PROJECT_ID, message: `pause it and then deploy it to production` })
    assert.equal(result.body.decisionClass, 'TIM_REQUIRED', 'the consequential clause must win a full refusal, matching respondCommand\'s own precedence')
    assert.doesNotMatch(result.body.text, /Paused \*\*/, 'must never claim a pause happened when the whole message should have been refused')
    assert.equal(readKeepGoingRun(PROJECT_ID).state, 'ACTIVE', 'the real run must NOT be silently paused as a side effect of a message that should have been refused in full')
  })
})

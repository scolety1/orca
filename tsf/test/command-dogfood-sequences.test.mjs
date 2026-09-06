// Command architecture round 3: scripted, multi-turn conversational
// journeys (dogfood sequences A-F), each turn a real respondCommand call,
// with real durable state verified after every action turn -- not "the
// LLM liked its own answer." Isolated-state-file pattern (TSF_UI_STATE_FILE
// set before any dynamic import that transitively touches
// server/data-store.mjs); planner explicitly stubbed/blocked per turn as
// each sequence needs (this machine has a real, working planner CLI).
import assert from 'node:assert/strict'
import test from 'node:test'
import { rmSync } from 'node:fs'
import path from 'node:path'

const HERE = import.meta.dirname
const STATE_FILE = path.join(HERE, '..', 'server', '.local-state', `operator-state.test-command-dogfood-${process.pid}.json`)
process.env.TSF_UI_STATE_FILE = STATE_FILE
const NONEXISTENT = path.join(HERE, 'fixtures', 'does-not-exist-binary')
const PLANNER_STUB = path.join(HERE, 'fixtures', 'stub-planner-cli.mjs')
process.env.TSF_PLANNER_CLAUDE_COMMAND = NONEXISTENT
process.env.TSF_PLANNER_CODEX_COMMAND = NONEXISTENT

const { respondCommand } = await import('../server/command-responder.mjs')
const { readResearchMissionStatus, readActiveResearchPaidApproval } = await import('../server/research-mission-driver.mjs')
const { EXA_PROVIDER_ID } = await import('../adapters/exa-research-worker.mjs')
const { withKeepGoingRun, readKeepGoingRun } = await import('../server/keep-going-run-store.mjs')
const { createOvernightRun } = await import('../domain/keep-going.mjs')
const { loadState } = await import('../server/data-store.mjs')

function cleanupStateFile() {
  for (const suffix of ['', '.tmp', '.keep-going.lock', '.research.lock']) rmSync(`${STATE_FILE}${suffix}`, { force: true })
}
cleanupStateFile()

const clock = () => new Date('2026-09-04T14:00:00.000Z')
const STUB_DISPATCH_DEPS = { resolveRepositoryIdentity: async () => ({ ok: false, reason: 'REPOSITORY_UNAVAILABLE' }) }

function project(id, displayName, sourceClass = 'REAL') {
  return { id, displayName, sourceClass, mission: { state: 'ONBOARDED', id: null, blockedReason: null }, candidate: null, receipts: { chain: [] } }
}

// Simulates what http-server.mjs actually does: reload real persisted
// state fresh before each turn, and persist each turn's own
// resolvedProjectIds/scope onto chatThreads.__command__ afterward -- the
// exact real conversational-context plumbing, not a hand-built shortcut.
async function turn(message, projects, extra = {}) {
  const state = loadState()
  const result = await respondCommand({ message, projects, opState: { ...state, ...extra }, clock, deps: STUB_DISPATCH_DEPS })
  const fresh = loadState()
  const threads = { ...fresh.chatThreads }
  threads.__command__ = [
    ...(threads.__command__ ?? []),
    { role: 'user', content: message, at: clock().toISOString() },
    { role: 'assistant', content: result.text, at: clock().toISOString(), decisionClass: result.decisionClass, intent: result.intent, resolvedProjectIds: result.resolvedProjectIds, researchMissionId: result.researchMissionId ?? null, scope: result.scope }
  ]
  const { saveState } = await import('../server/data-store.mjs')
  saveState({ ...fresh, chatThreads: threads })
  return result
}

async function seedActiveRun(projectId) {
  await withKeepGoingRun(projectId, () => createOvernightRun({ id: `run-${projectId}`, projectId, originalGoal: 'Test goal.', acceptanceCriteria: ['X'] }, clock))
}

async function seedNeedsYouRun(projectId, question) {
  await withKeepGoingRun(projectId, (current) => {
    const run = current ?? createOvernightRun({ id: `run-${projectId}`, projectId, originalGoal: 'Test goal.', acceptanceCriteria: ['X'] }, clock)
    return { ...run, state: 'NEEDS_YOU', needsYou: [{ id: 'q1', question, resolvedAt: null }] }
  })
}

// ---------------------------------------------------------------------
// A. global status -> what does that mean? -> Needs You -> why is that blocked?
// ---------------------------------------------------------------------
test('dogfood A: global status -> what does that mean? -> what needs me? -> why is that blocked? (real state after each turn)', async () => {
  await seedActiveRun('dogfood-a-project')
  await seedNeedsYouRun('dogfood-a-blocked-project', 'A real decision is pending on dogfood-a-blocked-project')
  const projects = [project('dogfood-a-project', 'Dogfood A Project'), project('dogfood-a-blocked-project', 'Dogfood A Blocked Project')]

  const status = await turn("what's running right now?", projects)
  assert.equal(status.scope, 'FLEET')
  assert.match(status.text, /Dogfood A Project/)

  // "what does that mean?" on a fleet-wide status answer has no single
  // project/mission referent -- Gap 1's honest "nothing specific" answer,
  // never a fabricated action.
  const explanation = await turn('what does that mean?', projects)
  assert.equal(explanation.intent, 'FOLLOW_UP_EXPLANATION')
  assert.doesNotMatch(explanation.text, /^Paused|^Resumed|^Cancelled|^Created a real research mission/, 'must never fabricate an action from an unresolvable meta-question')

  const needsYou = await turn('what needs me?', projects)
  assert.match(needsYou.text, /Dogfood A Blocked Project/)
  assert.match(needsYou.text, /A real decision is pending/)

  // Gap 1: "why is that blocked?" now explains the REAL open item behind
  // the just-given Needs You answer, not a generic non-answer.
  const why = await turn('why is that blocked?', projects)
  assert.equal(why.intent, 'FOLLOW_UP_EXPLANATION')
  assert.match(why.text, /Dogfood A Blocked Project/)
  assert.match(why.text, /A real decision is pending/)
})

// ---------------------------------------------------------------------
// B. project status -> why? -> run it -> what's it doing now?
// ---------------------------------------------------------------------
test("dogfood B: what's going on with NWR? -> why? -> run it -> what's it doing now?", async () => {
  const projects = [project('dogfood-b-nwr', 'NWR')]
  const status = await turn('what is the current state of dogfood-b-nwr', projects)
  assert.deepEqual(status.resolvedProjectIds, ['dogfood-b-nwr'])

  // Gap 1: bare "why?" now resolves to the prior turn's project and
  // explains its real current state -- never fabricates an action.
  const why = await turn('why?', projects)
  assert.equal(why.intent, 'FOLLOW_UP_EXPLANATION')
  assert.deepEqual(why.resolvedProjectIds, ['dogfood-b-nwr'])
  assert.match(why.text, /NWR/)
  assert.doesNotMatch(why.text, /^Paused|^Resumed|^Cancelled/)

  const runIt = await turn('run it', projects)
  assert.deepEqual(runIt.resolvedProjectIds, ['dogfood-b-nwr'])
  assert.ok(runIt.dispatchResults, 'a real dispatch attempt was made against the back-referenced project')

  const now = await turn("what's that project doing now?", projects)
  assert.deepEqual(now.resolvedProjectIds, ['dogfood-b-nwr'])
  assert.match(now.text, /NWR/)
})

// ---------------------------------------------------------------------
// C. safe-project advisory -> why that one? -> run that -> prove durable state
// ---------------------------------------------------------------------
test('dogfood C: find me something safe to test on -> why that one? -> run that -> real durable dispatch attempt', async () => {
  const projects = [project('dogfood-c-real', 'Dogfood C Real'), project('dogfood-c-test-project', 'dogfood-c-TEST-project')]
  const advisory = await turn('find me something safe to test on', projects)
  assert.deepEqual(advisory.resolvedProjectIds, ['dogfood-c-test-project'], 'exactly one safe candidate -- remembered as a back-reference target')
  assert.equal(advisory.dispatchResults, undefined, 'advisory alone never dispatches')

  // Gap 1: "why that one?" grounds in real current state -- never a
  // fabricated action, never a repeat of the raw prior answer text.
  const why = await turn('why that one?', projects)
  assert.equal(why.intent, 'FOLLOW_UP_EXPLANATION')
  assert.match(why.text, /dogfood-c-TEST-project/)
  assert.doesNotMatch(why.text, /^Paused|^Resumed|^Cancelled/)

  const runThat = await turn('run that', projects)
  assert.deepEqual(runThat.resolvedProjectIds, ['dogfood-c-test-project'])
  assert.ok(runThat.dispatchResults, 'a real dispatch attempt was made -- durable proof, not a claimed action')
})

// ---------------------------------------------------------------------
// D. research request -> status -> completeness -> artifacts
// ---------------------------------------------------------------------
test('dogfood D: research request -> status -> completeness -> artifacts, all grounded in the real durable mission', async () => {
  const saved = process.env.TSF_PLANNER_CLAUDE_COMMAND
  process.env.TSF_PLANNER_CLAUDE_COMMAND = PLANNER_STUB
  try {
    const created = await turn('research the history of the NFL salary cap from 2018 through 2020, sourced dataset, no money', [])
    // Round 3 Bug 1 fix: creation immediately attempts free-path progress
    // rather than waiting for a manual "continue" -- this fixture's spec
    // has fields with no free-path match, so it honestly surfaces a
    // paid-research approval request instead of silently stalling.
    assert.match(created.text, /^Created the research mission/)
    // Adversarial-review finding, fixed: this fixture's "no money" phrasing
    // doesn't match isFreeOnlyRequest's regex (only "don't spend any
    // money"/"no spend"/etc. do), so this mission is NOT freeOnly and its
    // real free-path gap genuinely blocks on a paid-research decision --
    // "Queued for autonomous progression" must NOT appear alongside that.
    assert.match(created.text, /paid-research approval request/)
    assert.doesNotMatch(created.text, /Queued for autonomous progression/)
    const missionId = created.researchMissionId
    assert.ok(missionId)

    // Real durable proof: the free-path attempt already ran at creation
    // time and raised a genuine Needs You item -- not the old "CREATED,
    // nothing dispatched yet" phase.
    const status = await turn("what's the research doing?", [])
    assert.equal(status.researchMissionId, missionId)
    assert.match(status.text, /WAITING_NEEDS_INPUT/)

    // Gap 1: "what does that mean?" grounds in the REAL current mission
    // phase, resolved via the persisted conversational context, not a
    // repeat of the raw status text.
    const explanation = await turn('what does that mean?', [])
    assert.equal(explanation.intent, 'FOLLOW_UP_EXPLANATION')
    assert.equal(explanation.researchMissionId, missionId)
    assert.match(explanation.text, /waiting on you/)

    // Gap 2: "could Exa help?" resolves THIS mission from conversational
    // context (no id in the message) and answers advisory-only.
    const advisory = await turn('could Exa help?', [])
    assert.equal(advisory.intent, 'RESEARCH_PAID_ADVISORY')
    assert.equal(advisory.researchMissionId, missionId)
    assert.equal(advisory.live, false)
    assert.equal(readActiveResearchPaidApproval(missionId, EXA_PROVIDER_ID, clock), null, 'advisory alone must never grant anything')

    // "use Exa up to $2" is the existing explicit scoped-approval flow --
    // a durable grant, still zero actual spend (no dispatch call made).
    const grant = await turn('use Exa up to $2', [])
    assert.match(grant.text, /Approved/)
    const approval = readActiveResearchPaidApproval(missionId, EXA_PROVIDER_ID, clock)
    assert.equal(approval.maxSpendUsd, 2)

    const completeness = await turn('how complete is it?', [])
    assert.equal(completeness.researchMissionId, missionId)
    assert.match(completeness.text, /isn't done yet/)

    const artifacts = await turn('show me the CSV', [])
    assert.equal(artifacts.researchMissionId, missionId)
    assert.match(artifacts.text, /hasn't produced that artifact yet/)

    // Real durable proof, not just chat text: the free-path attempt at
    // creation time genuinely advanced this mission past CREATED.
    assert.equal(readResearchMissionStatus(missionId).phase, 'WAITING_NEEDS_INPUT')
  } finally {
    if (saved === undefined) delete process.env.TSF_PLANNER_CLAUDE_COMMAND
    else process.env.TSF_PLANNER_CLAUDE_COMMAND = saved
  }
})

// ---------------------------------------------------------------------
// E. paid-provider advisory -> scoped approval request, zero real spend
// ---------------------------------------------------------------------
test('dogfood E: could Exa help? (advisory only) -> use Exa up to $2 (scoped grant) -- zero real spend throughout', async () => {
  const created = await turn('research dogfood sequence E topic', [])
  const missionId = created.researchMissionId
  assert.ok(missionId)

  const advisory = await turn(`could Exa help with ${missionId}?`, [])
  assert.equal(advisory.live, false)
  assert.equal(readActiveResearchPaidApproval(missionId, EXA_PROVIDER_ID, clock), null, 'advisory must never itself grant anything')

  const grant = await turn(`use Exa for ${missionId} up to $2`, [])
  assert.match(grant.text, /Approved/)
  const approval = readActiveResearchPaidApproval(missionId, EXA_PROVIDER_ID, clock)
  assert.equal(approval.maxSpendUsd, 2, 'the exact scoped ceiling, never more')
  // Zero real spend: this test never calls dispatchResearchNodeWithApprovalDurable
  // at all -- granting authority is a durable state change, not itself a
  // network call (see command-research-bridge.mjs's own header on this).
})

// ---------------------------------------------------------------------
// F. multi-project overnight request with an explicit exclusion
// ---------------------------------------------------------------------
test('dogfood F: "run NWR and Nytheria overnight but don\'t touch TSF" -- correct inclusion/exclusion, real dispatch attempts only for the included two', async () => {
  const projects = [project('dogfood-f-nwr', 'NWR'), project('dogfood-f-nytheria', 'Nytheria'), project('dogfood-f-tsf', 'TSF')]
  const result = await turn('run dogfood-f-nwr and dogfood-f-nytheria overnight but do not touch dogfood-f-tsf', projects)
  assert.deepEqual(new Set(result.resolvedProjectIds), new Set(['dogfood-f-nwr', 'dogfood-f-nytheria']))
  assert.ok(!result.resolvedProjectIds.includes('dogfood-f-tsf'), 'the explicitly excluded project must never be dispatched to')
  assert.ok(result.dispatchResults, 'real dispatch attempts were made for the two included projects')
})

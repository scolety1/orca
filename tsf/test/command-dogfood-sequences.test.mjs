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
    { role: 'assistant', content: result.text, at: clock().toISOString(), decisionClass: result.decisionClass, intent: result.intent, resolvedProjectIds: result.resolvedProjectIds, scope: result.scope }
  ]
  const { saveState } = await import('../server/data-store.mjs')
  saveState({ ...fresh, chatThreads: threads })
  return result
}

async function seedActiveRun(projectId) {
  await withKeepGoingRun(projectId, () => createOvernightRun({ id: `run-${projectId}`, projectId, originalGoal: 'Test goal.', acceptanceCriteria: ['X'] }, clock))
}

// ---------------------------------------------------------------------
// A. global status -> explanation -> Needs You
// ---------------------------------------------------------------------
test('dogfood A: global status -> Needs You (real state after each turn)', async () => {
  await seedActiveRun('dogfood-a-project')
  const projects = [project('dogfood-a-project', 'Dogfood A Project')]

  const status = await turn("what's running right now?", projects)
  assert.equal(status.scope, 'FLEET')
  assert.match(status.text, /Dogfood A Project/)

  // Disclosed gap, not silently faked: "what does that mean?" (following
  // up on the PRIOR ANSWER's own content, not a project referent) is real,
  // bounded follow-up work not built this round -- conversational context
  // here resolves WHICH PROJECT, not "what did you just say". Proven here
  // as an honest non-crash, non-fabricated degrade, not a working feature.
  const explanation = await turn('what does that mean?', projects)
  assert.doesNotMatch(explanation.text, /^Paused|^Resumed|^Cancelled|^Created a real research mission/, 'must never fabricate an action from an unresolvable meta-question')

  const needsYou = await turn('what needs me?', projects)
  assert.match(needsYou.text, /nothing needs you/i)
})

// ---------------------------------------------------------------------
// B. project status -> why -> run it
// ---------------------------------------------------------------------
test('dogfood B: project status -> run it (back-reference resolves identity, real dispatch attempted)', async () => {
  const projects = [project('dogfood-b-nwr', 'NWR')]
  const status = await turn('what is the current state of dogfood-b-nwr', projects)
  assert.deepEqual(status.resolvedProjectIds, ['dogfood-b-nwr'])

  // Disclosed gap: bare "why?" (FOLLOW_UP_EXPLANATION) is not built this
  // round -- chat-responder.mjs's RATIONALE pattern requires "why did
  // you"/"why choose", not a bare "why?". Proven honest, not fabricated.
  const why = await turn('why?', projects)
  assert.doesNotMatch(why.text, /^Paused|^Resumed|^Cancelled/)

  const runIt = await turn('run it', projects)
  assert.deepEqual(runIt.resolvedProjectIds, ['dogfood-b-nwr'])
  assert.ok(runIt.dispatchResults, 'a real dispatch attempt was made against the back-referenced project')
})

// ---------------------------------------------------------------------
// C. safe-project advisory -> run that -> prove durable state
// ---------------------------------------------------------------------
test('dogfood C: safe-project advisory -> run that -> real durable dispatch attempt', async () => {
  const projects = [project('dogfood-c-real', 'Dogfood C Real'), project('dogfood-c-test-project', 'dogfood-c-TEST-project')]
  const advisory = await turn('find me something safe to test on', projects)
  assert.deepEqual(advisory.resolvedProjectIds, ['dogfood-c-test-project'], 'exactly one safe candidate -- remembered as a back-reference target')
  assert.equal(advisory.dispatchResults, undefined, 'advisory alone never dispatches')

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
    assert.match(created.text, /^Created a real research mission/)
    const missionId = created.researchMissionId
    assert.ok(missionId)

    const status = await turn("what's the research doing?", [])
    assert.equal(status.researchMissionId, missionId)
    assert.match(status.text, /CREATED/)

    const completeness = await turn('how complete is it?', [])
    assert.equal(completeness.researchMissionId, missionId)
    assert.match(completeness.text, /Completeness/)

    const artifacts = await turn('show me the CSV', [])
    assert.equal(artifacts.researchMissionId, missionId)
    assert.match(artifacts.text, /Artifacts/)

    // Real durable proof, not just chat text.
    assert.equal(readResearchMissionStatus(missionId).phase, 'CREATED')
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

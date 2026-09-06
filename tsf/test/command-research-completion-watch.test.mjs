// Hands-on pilot Round 4 -- Research Completion Notification Continuity.
// Real, reproduced bug: "can you let me know when its done" (and every
// natural variant of it) matched NOTHING in classifyResearchIntent, so it
// fell straight through to generic Command routing's "I couldn't tell
// which project this is about" -- even with an unambiguous single mission
// already in conversational context, right after several turns that DID
// correctly resolve it (status/artifact/completeness follow-ups).
//
// IMPORTANT -- this file also proves the "do not fake notifications"
// requirement: TSF has no push/OS/SSE/webhook channel to Tim at all
// (confirmed by direct investigation before writing any of this). What
// actually gets built and proven here is a real, durable, mission-ID-
// specific watch (domain/completion-watch.mjs + server/completion-watch-
// store.mjs) that fires exactly once when the target reaches a terminal
// outcome, and is delivered exactly once on the next real chat turn
// (server/completion-watch-reconciler.mjs's attachDueCompletionNotices) --
// never a fabricated "I'll ping you" claim with nothing behind it.
import assert from 'node:assert/strict'
import test from 'node:test'
import { rmSync } from 'node:fs'
import path from 'node:path'

const HERE = import.meta.dirname
const STATE_FILE = path.join(HERE, '..', 'server', '.local-state', `operator-state.test-completion-watch-${process.pid}.json`)
process.env.TSF_UI_STATE_FILE = STATE_FILE
process.env.TSF_PLANNER_CLAUDE_COMMAND = path.join(HERE, 'fixtures', 'does-not-exist-binary')
process.env.TSF_PLANNER_CODEX_COMMAND = path.join(HERE, 'fixtures', 'does-not-exist-binary')

const { classifyResearchIntent } = await import('../server/command-research-bridge.mjs')
const { respondCommand } = await import('../server/command-responder.mjs')
const { cancelResearchMissionDurable, createResearchMissionDurable } = await import('../server/research-mission-driver.mjs')
const { withResearchMission } = await import('../server/research-mission-store.mjs')
const { completeResearchMission } = await import('../domain/research-mission.mjs')
const { findActiveCompletionWatch, listCompletionWatches } = await import('../server/completion-watch-store.mjs')
const { attachDueCompletionNotices } = await import('../server/completion-watch-reconciler.mjs')
const { loadState, saveState } = await import('../server/data-store.mjs')

function cleanupStateFile() {
  for (const suffix of ['', '.tmp', '.research.lock', '.completion-watch.lock']) {
    rmSync(`${STATE_FILE}${suffix}`, { force: true })
  }
}
cleanupStateFile()
test.after(cleanupStateFile)

const clock = () => new Date('2026-09-06T12:00:00.000Z')

function fieldSpec(fieldNames) {
  return {
    schemaVersion: 'TSF_RESEARCH_SPECIFICATION_V1',
    id: 'spec:completion-watch',
    researchQuestion: 'q',
    entityType: 'FIXTURE',
    requestedFields: fieldNames.map((f) => ({ fieldName: f, valueType: 'number', required: true, derivationRule: null })),
    sourcePolicy: { preferredSources: [], disallowedSources: [], licensingConstraints: [], freshnessPolicy: 'UNSPECIFIED', requireIndependentSources: false, minSourceCount: 0, allowCrossMissionLibraryReuse: true },
    temporalRequirements: { asOfDate: '2026-09-06', periodScope: 'UNSPECIFIED' },
    budget: { maxCostUsd: 0, maxLatencyMs: null, maxToolCallsPerNode: null },
    toolPermissions: []
  }
}

function universe(entityId) {
  return { schemaVersion: 'TSF_EXPECTED_UNIVERSE_V1', entityType: 'FIXTURE', expectedCount: 1, expectedEntities: [{ entityId }] }
}

async function turn(message) {
  const state = loadState()
  const result = await respondCommand({ message, projects: [], opState: { ...state }, clock, deps: {} })
  const fresh = loadState()
  const threads = { ...fresh.chatThreads }
  threads.__command__ = [
    ...(threads.__command__ ?? []),
    { role: 'user', content: message, at: clock().toISOString() },
    { role: 'assistant', content: result.text, at: clock().toISOString(), intent: result.intent, resolvedProjectIds: result.resolvedProjectIds, researchMissionId: result.researchMissionId ?? null, scope: result.scope }
  ]
  saveState({ ...fresh, chatThreads: threads })
  return result
}

test('classifyResearchIntent recognizes every required completion-notification phrasing, and does not confuse it with existing completeness/artifact intents', () => {
  const variants = [
    'can you let me know when its done',
    "let me know when it's done",
    'tell me when this finishes',
    'notify me when the research is complete',
    'let me know when the salary cap thing finishes',
    'can you tell me when it has the dataset'
  ]
  for (const message of variants) {
    assert.equal(classifyResearchIntent(message), 'RESEARCH_COMPLETION_WATCH_REQUEST', `"${message}" must classify as a completion-watch request`)
  }
  // Must not steal existing intents.
  assert.equal(classifyResearchIntent('is it done?'), 'RESEARCH_COMPLETENESS')
  assert.equal(classifyResearchIntent('what did it find'), 'RESEARCH_ARTIFACTS')
})

test('REQUIRED REGRESSION: research request -> status -> artifact -> is it done? -> let me know when it\'s done -- same mission retained throughout, no project-target rejection, no stale-context hijack', async () => {
  const created = await turn('research the completion notification regression topic, no money')
  const missionId = created.researchMissionId
  assert.ok(missionId)

  const status = await turn('how do i know if the regression topic thing is done')
  assert.equal(status.researchMissionId, missionId)
  assert.doesNotMatch(status.text, /couldn't tell which project/i)

  const artifact = await turn('what did it find')
  assert.equal(artifact.researchMissionId, missionId)
  assert.doesNotMatch(artifact.text, /couldn't tell which project/i)

  const done = await turn('is it done?')
  assert.equal(done.researchMissionId, missionId)
  assert.doesNotMatch(done.text, /couldn't tell which project/i)

  // The exact real, reproduced bug: this used to say "I couldn't tell
  // which project this is about" instead of resolving the mission.
  const notify = await turn('can you let me know when its done')
  assert.equal(notify.researchMissionId, missionId, 'must resolve to the SAME mission as every prior turn, not lose context')
  assert.doesNotMatch(notify.text, /couldn't tell which project/i)
  assert.match(notify.text, /I'll flag it here/i)

  // Real durable proof, not just chat text: a genuine PENDING watch exists.
  const watch = findActiveCompletionWatch('RESEARCH_MISSION', missionId)
  assert.ok(watch, 'a real completion watch must have been durably registered')
  assert.equal(watch.state, 'PENDING')
  assert.equal(watch.kind, 'RESEARCH_MISSION')
  assert.equal(watch.targetId, missionId)
})

test('duplicate "let me know when it\'s done" confirms the existing watch instead of creating a second one', async () => {
  const created = await turn('research the duplicate watch topic, no money')
  const missionId = created.researchMissionId
  await turn("let me know when it's done")
  const beforeCount = listCompletionWatches().filter((w) => w.targetId === missionId).length
  assert.equal(beforeCount, 1)

  const again = await turn('tell me when this finishes')
  assert.match(again.text, /already watching/i)
  const afterCount = listCompletionWatches().filter((w) => w.targetId === missionId).length
  assert.equal(afterCount, 1, 'no duplicate watch was ever created')
})

test('a mission that is ALREADY complete when asked answers honestly instead of registering a pointless watch', async () => {
  const missionId = 'mission:already-complete-watch-test'
  await createResearchMissionDurable(missionId, { projectId: 'test', specification: fieldSpec(['x']), expectedUniverse: universe('e1'), nodes: [] }, clock)
  await withResearchMission(missionId, (m) => completeResearchMission({ ...m, state: 'ACTIVE' }, clock, m.revision))
  await turn(`research status for ${missionId}`) // seed conversational context for the id
  const notify = await turn(`let me know when ${missionId} is done`)
  assert.match(notify.text, /already reached COMPLETE/i)
  assert.equal(findActiveCompletionWatch('RESEARCH_MISSION', missionId), null, 'no watch registered for an already-terminal mission')
})

test('a mission that was already cancelled when asked answers honestly instead of registering a pointless watch', async () => {
  const missionId = 'mission:already-cancelled-watch-test'
  await createResearchMissionDurable(missionId, { projectId: 'test', specification: fieldSpec(['x']), expectedUniverse: universe('e1'), nodes: [] }, clock)
  await cancelResearchMissionDurable(missionId, 'TEST_SETUP', clock)
  await turn(`research status for ${missionId}`)
  const notify = await turn(`notify me when ${missionId} is complete`)
  assert.match(notify.text, /already cancelled/i)
  assert.equal(findActiveCompletionWatch('RESEARCH_MISSION', missionId), null)
})

test('ambiguity is preserved: multiple plausible missions with no resolvable context asks rather than guessing which one to watch', async () => {
  const a = 'mission:completion-watch-ambiguous-a'
  const b = 'mission:completion-watch-ambiguous-b'
  await createResearchMissionDurable(a, { projectId: 'test', specification: fieldSpec(['x']), expectedUniverse: universe('e1'), nodes: [] }, clock)
  await createResearchMissionDurable(b, { projectId: 'test', specification: fieldSpec(['x']), expectedUniverse: universe('e1'), nodes: [] }, clock)
  const fresh = loadState()
  saveState({ ...fresh, chatThreads: { ...fresh.chatThreads, __command__: [] } }) // no conversational context to disambiguate
  const notify = await turn("let me know when it's done")
  assert.match(notify.text, /more than one research mission/i)
  assert.equal(findActiveCompletionWatch('RESEARCH_MISSION', a), null)
  assert.equal(findActiveCompletionWatch('RESEARCH_MISSION', b), null)
})

test('attachDueCompletionNotices: fires exactly once on real COMPLETE, delivers exactly once, never duplicates on a later call', async () => {
  const created = await turn('research the delivery-once topic, no money')
  const missionId = created.researchMissionId
  await turn("let me know when it's done")
  await withResearchMission(missionId, (m) => completeResearchMission({ ...m, state: 'ACTIVE' }, clock, m.revision))

  const first = await attachDueCompletionNotices({ text: 'unrelated reply one' }, clock)
  assert.match(first.text, /reached COMPLETE/)
  assert.match(first.text, /unrelated reply one/, 'the notice is PREPENDED, never replacing the real answer to whatever Tim actually asked')

  const watch = findActiveCompletionWatch('RESEARCH_MISSION', missionId)
  assert.equal(watch, null, 'DELIVERED watches are no longer "active" -- confirms the state actually advanced past FIRED_UNSEEN')

  const second = await attachDueCompletionNotices({ text: 'unrelated reply two' }, clock)
  assert.equal(second.text, 'unrelated reply two', 'no duplicate notification on a later call')
})

test('attachDueCompletionNotices: a watched mission that gets cancelled instead of completed is reported honestly, never as a false success', async () => {
  const created = await turn('research the honest-cancel topic, no money')
  const missionId = created.researchMissionId
  await turn("notify me when the research is complete")
  await cancelResearchMissionDurable(missionId, 'TEST_CANCEL', clock)

  const payload = await attachDueCompletionNotices({ text: 'unrelated reply' }, clock)
  assert.match(payload.text, /cancelled before completing -- it did not finish/i)
  assert.doesNotMatch(payload.text, /reached COMPLETE/)
})

test('durable across a fresh read of persisted state (restart-equivalent): a PENDING watch registered by one call is visible to a completely independent later read', async () => {
  const created = await turn('research the durability topic, no money')
  const missionId = created.researchMissionId
  await turn("let me know when it's done")
  // A fresh loadState() call is exactly what a restarted process's first
  // read looks like -- no in-memory state is reused here.
  const reread = loadState()
  const watch = Object.values(reread.completionWatches ?? {}).find((w) => w.targetId === missionId)
  assert.ok(watch, 'the watch survives being re-read from the durable state file, exactly as a real process restart would see it')
  assert.equal(watch.state, 'PENDING')
})

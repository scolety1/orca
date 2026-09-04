// Command architecture round 3: actionable follow-up context, the PAUSE/
// RESUME half. chat-responder.mjs's shared intent taxonomy has no pause/
// resume intent at all -- before this, "pause NWR" (named OR referenced)
// fell through to a read-only answer that paused nothing. Isolated-state-
// file pattern (env var set before any dynamic import that transitively
// touches server/data-store.mjs) since pauseProjectRun/resumeProjectRun/
// classifyContinueAction go through the REAL durable Keep Going run store.
import assert from 'node:assert/strict'
import test from 'node:test'
import { rmSync } from 'node:fs'
import path from 'node:path'

const HERE = import.meta.dirname
const STATE_FILE = path.join(HERE, '..', 'server', '.local-state', `operator-state.test-command-run-action-bridge-${process.pid}.json`)
process.env.TSF_UI_STATE_FILE = STATE_FILE
// This machine has a real, working planner CLI available -- a GENERAL-
// intent, zero-match message (e.g. "pause it" with no resolvable
// back-reference) falls through to command-scope-classifier.mjs's live-
// planner call. Refused explicitly so this file never makes a real,
// billable call.
process.env.TSF_PLANNER_CLAUDE_COMMAND = path.join(HERE, 'fixtures', 'does-not-exist-binary')
process.env.TSF_PLANNER_CODEX_COMMAND = path.join(HERE, 'fixtures', 'does-not-exist-binary')

const { classifyRunActionVerb, classifyContinueAction, pauseProjectRun, resumeProjectRun } = await import('../server/command-run-action-bridge.mjs')
const { respondCommand } = await import('../server/command-responder.mjs')
const { withKeepGoingRun, readKeepGoingRun } = await import('../server/keep-going-run-store.mjs')
const { createOvernightRun } = await import('../domain/keep-going.mjs')

function cleanupStateFile() {
  for (const suffix of ['', '.tmp', '.keep-going.lock']) rmSync(`${STATE_FILE}${suffix}`, { force: true })
}
cleanupStateFile()

const clock = () => new Date('2026-09-04T12:00:00.000Z')

async function seedActiveRun(projectId) {
  await withKeepGoingRun(projectId, () =>
    createOvernightRun({ id: `run-${projectId}`, projectId, originalGoal: 'Test goal.', acceptanceCriteria: ['X'] }, clock)
  )
}

async function seedPausedRun(projectId) {
  await withKeepGoingRun(projectId, (current) => {
    const run = current ?? createOvernightRun({ id: `run-${projectId}`, projectId, originalGoal: 'Test goal.', acceptanceCriteria: ['X'] }, clock)
    return { ...run, state: 'PAUSED' }
  })
}

test('classifyRunActionVerb: recognizes PAUSE/RESUME in both named ("pause NWR") and back-reference ("pause it") shapes', () => {
  assert.equal(classifyRunActionVerb('pause NWR'), 'PAUSE')
  assert.equal(classifyRunActionVerb('pause it'), 'PAUSE')
  assert.equal(classifyRunActionVerb('please pause'), 'PAUSE')
  assert.equal(classifyRunActionVerb('resume it'), 'RESUME')
  assert.equal(classifyRunActionVerb('continue that'), 'RESUME')
  assert.equal(classifyRunActionVerb('continue NWR'), 'RESUME')
})

test('classifyRunActionVerb: a negated action is never classified as actionable', () => {
  assert.equal(classifyRunActionVerb("don't pause it"), null)
  assert.equal(classifyRunActionVerb('please do not pause NWR'), null)
  assert.equal(classifyRunActionVerb('never resume that'), null)
})

test('classifyRunActionVerb: an EARLIER negation in an unrelated clause never suppresses a LATER genuine action', () => {
  assert.equal(classifyRunActionVerb("don't touch TSF, pause NWR"), 'PAUSE')
})

test('classifyRunActionVerb: ordinary prose mentioning the words is never misread as a directive', () => {
  assert.equal(classifyRunActionVerb('the tick paused the wave'), null)
  assert.equal(classifyRunActionVerb('is it paused?'), null)
})

test('classifyContinueAction: RESUME for a real PAUSED run, DISPATCH otherwise (no run, or an ACTIVE run)', async () => {
  await seedPausedRun('proj-paused')
  await seedActiveRun('proj-active')
  assert.equal(classifyContinueAction('proj-paused'), 'RESUME')
  assert.equal(classifyContinueAction('proj-active'), 'DISPATCH')
  assert.equal(classifyContinueAction('proj-no-run'), 'DISPATCH')
})

test('pauseProjectRun: a real, durable pause through the exact same primitive the HTTP route uses', async () => {
  await seedActiveRun('proj-to-pause')
  const run = await pauseProjectRun('proj-to-pause', 'test reason', clock)
  assert.equal(run.state, 'PAUSED')
  assert.equal(readKeepGoingRun('proj-to-pause').state, 'PAUSED', 'the pause is really durable, not just returned')
})

test('resumeProjectRun: a real, durable resume', async () => {
  await seedPausedRun('proj-to-resume')
  const run = await resumeProjectRun('proj-to-resume', clock)
  assert.equal(run.state, 'ACTIVE')
  assert.equal(readKeepGoingRun('proj-to-resume').state, 'ACTIVE')
})

test('pauseProjectRun: an honest failure (never a fabricated success) when no run exists at all', async () => {
  await assert.rejects(() => pauseProjectRun('proj-with-no-run-at-all', 'x', clock), /TSF_RUN_NOT_FOUND|no Keep Going run/)
})

// ---------------------------------------------------------------------
// Integration through the real respondCommand entry point.
// ---------------------------------------------------------------------
function project(id, displayName) {
  return { id, displayName, mission: { state: 'ONBOARDED', id: null, blockedReason: null }, candidate: null, receipts: { chain: [] } }
}

function opStateWithLastTurn(resolvedProjectIds) {
  return {
    keepGoingRuns: {},
    chatThreads: {
      __command__: [
        { role: 'user', content: 'x', at: clock().toISOString() },
        { role: 'assistant', content: 'ok', at: clock().toISOString(), decisionClass: 'AUTO_DECIDE', intent: 'STATUS', resolvedProjectIds, scope: resolvedProjectIds.length === 1 ? 'PROJECT' : 'FLEET' }
      ]
    }
  }
}

test('integration: "pause NWR" (named) really pauses the real durable run -- previously fell through to a read-only answer that paused nothing', async () => {
  await seedActiveRun('integration-pause-named')
  const result = await respondCommand({
    message: 'pause integration-pause-named',
    projects: [project('integration-pause-named', 'Integration Pause Named')],
    opState: { keepGoingRuns: {} },
    clock
  })
  assert.match(result.text, /^Paused/)
  assert.deepEqual(result.resolvedProjectIds, ['integration-pause-named'])
  assert.equal(readKeepGoingRun('integration-pause-named').state, 'PAUSED')
})

test('integration: "pause it" (back-reference) resolves identity from the prior turn and really pauses the real durable run', async () => {
  await seedActiveRun('integration-pause-backref')
  const result = await respondCommand({
    message: 'pause it',
    projects: [project('integration-pause-backref', 'Integration Pause Backref')],
    opState: opStateWithLastTurn(['integration-pause-backref']),
    clock
  })
  assert.match(result.text, /^Paused/)
  assert.equal(readKeepGoingRun('integration-pause-backref').state, 'PAUSED')
})

test('integration: "resume it" on a real PAUSED run really resumes it', async () => {
  await seedPausedRun('integration-resume-backref')
  const result = await respondCommand({
    message: 'resume it',
    projects: [project('integration-resume-backref', 'Integration Resume Backref')],
    opState: opStateWithLastTurn(['integration-resume-backref']),
    clock
  })
  assert.match(result.text, /^Resumed/)
  assert.equal(readKeepGoingRun('integration-resume-backref').state, 'ACTIVE')
})

test('integration: "continue it" on an ACTIVE run (nothing to resume) falls through to a real dispatch attempt instead, never a fabricated "resumed"', async () => {
  await seedActiveRun('integration-continue-active')
  const result = await respondCommand({
    message: 'continue it',
    projects: [project('integration-continue-active', 'Integration Continue Active')],
    opState: opStateWithLastTurn(['integration-continue-active']),
    clock,
    deps: { resolveRepositoryIdentity: async () => ({ ok: false, reason: 'REPOSITORY_UNAVAILABLE' }) }
  })
  assert.doesNotMatch(result.text, /^Resumed/)
  assert.ok(result.dispatchResults, 'a real dispatch attempt, not a resume, since there was nothing paused to resume')
})

test('integration: "pause it" with no back-reference context at all is refused honestly, never guesses a project to pause', async () => {
  const result = await respondCommand({
    message: 'pause it',
    projects: [project('some-project', 'Some Project')],
    opState: { keepGoingRuns: {} },
    clock
  })
  assert.match(result.text, /couldn't tell which project/i)
})

test('integration: authorization isolation -- a back-reference to project A never pauses project B', async () => {
  await seedActiveRun('proj-a-isolation')
  await seedActiveRun('proj-b-isolation')
  const result = await respondCommand({
    message: 'pause it',
    projects: [project('proj-a-isolation', 'Project A'), project('proj-b-isolation', 'Project B')],
    opState: opStateWithLastTurn(['proj-a-isolation']),
    clock
  })
  assert.deepEqual(result.resolvedProjectIds, ['proj-a-isolation'])
  assert.equal(readKeepGoingRun('proj-a-isolation').state, 'PAUSED')
  assert.equal(readKeepGoingRun('proj-b-isolation').state, 'ACTIVE', 'project B must be completely untouched')
})

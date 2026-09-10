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

// TSF Overnight Control-Plane Burn-In V2, Lane C (real, live-confirmed
// while writing a stateful dogfood sequence, not guessed): splitIntoClauses
// strips the trailing "?", so a genuine question like "why did you pause
// it?" survives as the clause "why did you pause it" -- which contains
// "pause it" as a literal substring and was being misread as a real
// directive (VERB_PLUS_PRONOUN), producing a real second pause attempt
// (only harmless because it happened to hit the same invalid-transition
// refusal duplicate-delivery already relies on) and a leaky "invalid
// overnight run transition" error instead of ever reaching a real
// explanation. Fixed via a new QUESTION_OPENER guard mirroring
// NEGATION_OPENER's own narrow "clause opens with X" shape.
test('classifyRunActionVerb: a genuine WH-question or auxiliary-inversion question containing the verb+pronoun is never misread as a directive', () => {
  assert.equal(classifyRunActionVerb('why did you pause it?'), null)
  assert.equal(classifyRunActionVerb('why did you resume it?'), null)
  assert.equal(classifyRunActionVerb('what did you pause?'), null)
  assert.equal(classifyRunActionVerb('did you pause it?'), null)
  assert.equal(classifyRunActionVerb('is it going to pause it again?'), null)
  // A question in a LATER, separate clause never suppresses a genuine
  // directive in an EARLIER clause -- same precedence NEGATION_OPENER
  // already gets right for "don't touch TSF, pause NWR".
  assert.equal(classifyRunActionVerb('pause NWR, why?'), 'PAUSE')
  // The OPENER check (clause literally starts with the verb) is
  // unaffected by the question guard either way.
  assert.equal(classifyRunActionVerb('pause it, please explain why'), 'PAUSE')
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
  // Lane M red-team finding (real, fixed): assert.ok on an array is
  // vacuously true even for []  -- strengthened to prove the dispatch
  // attempt actually targeted this one real project, not an empty/wrong
  // target list.
  assert.equal(result.dispatchResults?.length, 1, 'a real dispatch attempt, not a resume, since there was nothing paused to resume')
  assert.equal(result.dispatchResults[0].projectId, 'integration-continue-active')
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

// TSF Overnight Control-Plane Burn-In V2, Lane D (duplicate-delivery /
// idempotency, explicitly named P0 territory, extended beyond the
// adoption engine to the PAUSE/RESUME consequential actions named in the
// same directive). No test anywhere in this suite previously delivered
// "pause X" twice in a row against the real durable run -- domain/
// keep-going.mjs's own RUN_ALLOWED state machine has no PAUSED->PAUSED
// transition, so the second call throws TSF_INVALID_RUN_TRANSITION, and
// command-responder.mjs's own catch block turns that into a real refusal
// -- never a second false "Paused" claim. This is the correct, safe
// behavior; this test proves it end to end rather than leaving it
// unverified.
test('integration: duplicate delivery -- "pause X" delivered twice in a row never claims a second success, and the run is not corrupted by the refused second attempt', async () => {
  await seedActiveRun('integration-pause-duplicate')
  const projectFixture = [project('integration-pause-duplicate', 'Integration Pause Duplicate')]

  const first = await respondCommand({ message: 'pause integration-pause-duplicate', projects: projectFixture, opState: { keepGoingRuns: {} }, clock })
  assert.match(first.text, /^Paused/)
  assert.equal(readKeepGoingRun('integration-pause-duplicate').state, 'PAUSED')

  const second = await respondCommand({ message: 'pause integration-pause-duplicate', projects: projectFixture, opState: { keepGoingRuns: {} }, clock })
  assert.equal(second.live, false, 'a duplicate pause must never be reported as a real, live action')
  assert.doesNotMatch(second.text, /^Paused/, 'the duplicate delivery must never claim a second successful pause')
  assert.match(second.text, /couldn't pause/i)

  // The run itself is untouched by the refused duplicate -- still PAUSED,
  // and exactly ONE pause transition was ever recorded (the refused second
  // call left no trace in the transition history).
  const run = readKeepGoingRun('integration-pause-duplicate')
  assert.equal(run.state, 'PAUSED')
  const pauseTransitions = run.transitions.filter((t) => t.to === 'PAUSED')
  assert.equal(pauseTransitions.length, 1, 'the refused duplicate must not append a second PAUSED transition')
})

// Lane D, RESUME/"continue" half: unlike PAUSE, a duplicate "resume X" is
// not simply refused -- classifyContinueAction reads the run's REAL
// current state fresh each time, so once the first call has already
// flipped PAUSED->ACTIVE, a second "resume X" is correctly reclassified
// as DISPATCH (there is nothing durable left to resume), never a second
// false "Resumed" claim and never a crash from re-attempting an invalid
// ACTIVE->ACTIVE transition.
test('integration: duplicate delivery -- "resume X" delivered twice in a row never claims a second resume; the second call is honestly reclassified as a dispatch attempt instead', async () => {
  await seedPausedRun('integration-resume-duplicate')
  const projectFixture = [project('integration-resume-duplicate', 'Integration Resume Duplicate')]
  const dispatchDeps = { resolveRepositoryIdentity: async () => ({ ok: false, reason: 'REPOSITORY_UNAVAILABLE' }) }

  const first = await respondCommand({ message: 'resume integration-resume-duplicate', projects: projectFixture, opState: { keepGoingRuns: {} }, clock })
  assert.match(first.text, /^Resumed/)
  assert.equal(readKeepGoingRun('integration-resume-duplicate').state, 'ACTIVE')

  const second = await respondCommand({ message: 'resume integration-resume-duplicate', projects: projectFixture, opState: { keepGoingRuns: {} }, clock, deps: dispatchDeps })
  assert.doesNotMatch(second.text, /^Resumed/, 'the duplicate delivery must never claim a second successful resume')
  // Lane M red-team finding (real, fixed): assert.ok on an array is
  // vacuously true even for [] -- strengthened to prove the dispatch
  // attempt actually targeted this one real project (never a silently
  // empty or wrong-project target list).
  assert.equal(second.dispatchResults?.length, 1, 'reclassified as a real dispatch attempt, since there was nothing left to resume')
  assert.equal(second.dispatchResults[0].projectId, 'integration-resume-duplicate')

  // The run's own transition history has exactly one RESUME-to-ACTIVE
  // transition -- the duplicate never appended a second one.
  const run = readKeepGoingRun('integration-resume-duplicate')
  const resumeTransitions = run.transitions.filter((t) => t.to === 'ACTIVE' && t.reason === 'OPERATOR_RESUME')
  assert.equal(resumeTransitions.length, 1, 'the duplicate call must not append a second OPERATOR_RESUME transition')
})

// TSF Overnight Control-Plane Burn-In V2, Lane E (race/TOCTOU), extending
// the sequential PAUSE duplicate-delivery proof above to GENUINE
// concurrency -- Promise.all, not sequential awaits -- matching the same
// real-concurrency shape command-multi-action-bridge.test.mjs's own
// Batch-7 hold test already established for EXTERNAL_WORK_HOLD (a real
// client-retry-storm: N racing "pause X" requests firing before the
// first response returns). Verified directly (not assumed): in THIS
// single-process server, the actual safety guarantee here is domain/
// keep-going.mjs's own RUN_ALLOWED state machine plus the fact that
// withKeepGoingRun's load-mutate-save critical section contains no
// `await` -- Node's single-threaded event loop already runs that block
// to completion once started, so N concurrent calls still serialize
// correctly even with keep-going-run-store.mjs's own cross-process file
// lock experimentally removed (confirmed clean across 5 runs; that lock
// is real and still required for genuine cross-process safety, just not
// what this particular in-process test exercises). What this test does
// mutation-prove is the state machine itself: forcing a PAUSED->PAUSED
// self-transition to be legal turns it red (all 10 concurrent calls
// succeed instead of 1).
test('Lane E: N genuinely concurrent duplicate "pause X" chat calls for the same project are race-safe -- exactly one real pause, N-1 honest refusals, exactly one PAUSED transition', async () => {
  await seedActiveRun('lane-e-concurrent-pause')
  const projectFixture = [project('lane-e-concurrent-pause', 'Lane E Concurrent Pause')]

  const N = 10
  const results = await Promise.all(
    Array.from({ length: N }, () => respondCommand({ message: 'pause lane-e-concurrent-pause', projects: projectFixture, opState: { keepGoingRuns: {} }, clock }))
  )

  const paused = results.filter((r) => /^Paused/.test(r.text))
  const refused = results.filter((r) => r.live === false)
  assert.equal(paused.length, 1, `exactly one of ${N} genuinely concurrent duplicate pause calls must actually succeed`)
  assert.equal(refused.length, N - 1, 'every other concurrent call must be honestly refused, never a second false "Paused" claim')

  const run = readKeepGoingRun('lane-e-concurrent-pause')
  assert.equal(run.state, 'PAUSED')
  const pauseTransitions = run.transitions.filter((t) => t.to === 'PAUSED')
  assert.equal(pauseTransitions.length, 1, `exactly one PAUSED transition despite ${N} genuinely concurrent duplicate calls`)
})

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
const STATE_FILE = path.join(
  HERE,
  '..',
  'server',
  '.local-state',
  `operator-state.test-command-run-action-bridge-${process.pid}.json`
)
process.env.TSF_UI_STATE_FILE = STATE_FILE
// This machine has a real, working planner CLI available -- a GENERAL-
// intent, zero-match message (e.g. "pause it" with no resolvable
// back-reference) falls through to command-scope-classifier.mjs's live-
// planner call. Refused explicitly so this file never makes a real,
// billable call.
process.env.TSF_PLANNER_CLAUDE_COMMAND = path.join(HERE, 'fixtures', 'does-not-exist-binary')
process.env.TSF_PLANNER_CODEX_COMMAND = path.join(HERE, 'fixtures', 'does-not-exist-binary')

const { classifyRunActionVerb, classifyContinueAction, pauseProjectRun, resumeProjectRun } =
  await import('../server/command-run-action-bridge.mjs')
const { respondCommand } = await import('../server/command-responder.mjs')
const { withKeepGoingRun, readKeepGoingRun } = await import('../server/keep-going-run-store.mjs')
const { createOvernightRun } = await import('../domain/keep-going.mjs')
const { readProjectExecutionHold } = await import('../server/project-execution-hold-store.mjs')

function cleanupStateFile() {
  for (const suffix of ['', '.tmp', '.keep-going.lock', '.project-execution-hold.lock']) {
    rmSync(`${STATE_FILE}${suffix}`, { force: true })
  }
}
cleanupStateFile()

const clock = () => new Date('2026-09-04T12:00:00.000Z')

async function seedActiveRun(projectId) {
  await withKeepGoingRun(projectId, () =>
    createOvernightRun(
      { id: `run-${projectId}`, projectId, originalGoal: 'Test goal.', acceptanceCriteria: ['X'] },
      clock
    )
  )
}

async function seedPausedRun(projectId) {
  await withKeepGoingRun(projectId, (current) => {
    const run =
      current ??
      createOvernightRun(
        {
          id: `run-${projectId}`,
          projectId,
          originalGoal: 'Test goal.',
          acceptanceCriteria: ['X']
        },
        clock
      )
    return { ...run, state: 'PAUSED' }
  })
}

// Directly sets the run's own state field (same shortcut seedPausedRun
// above already uses) -- a chat-level PAUSE attempt only ever consults
// `run.state` (and an absent/inactive tickLock, which a freshly-created
// run already has), so this is a faithful starting point for the real
// RUN_ALLOWED gate below, without needing to drive every state through
// its own full domain transition sequence.
async function seedRunInState(projectId, state) {
  await withKeepGoingRun(projectId, (current) => {
    const run =
      current ??
      createOvernightRun(
        {
          id: `run-${projectId}`,
          projectId,
          originalGoal: 'Test goal.',
          acceptanceCriteria: ['X']
        },
        clock
      )
    return { ...run, state }
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
  assert.equal(
    readKeepGoingRun('proj-to-pause').state,
    'PAUSED',
    'the pause is really durable, not just returned'
  )
})

test('resumeProjectRun: a real, durable resume', async () => {
  await seedPausedRun('proj-to-resume')
  const run = await resumeProjectRun('proj-to-resume', clock)
  assert.equal(run.state, 'ACTIVE')
  assert.equal(readKeepGoingRun('proj-to-resume').state, 'ACTIVE')
})

test('pauseProjectRun: an honest failure (never a fabricated success) when no run exists at all', async () => {
  await assert.rejects(
    () => pauseProjectRun('proj-with-no-run-at-all', 'x', clock),
    /TSF_RUN_NOT_FOUND|no Keep Going run/
  )
})

// ---------------------------------------------------------------------
// Integration through the real respondCommand entry point.
// ---------------------------------------------------------------------
function project(id, displayName) {
  return {
    id,
    displayName,
    mission: { state: 'ONBOARDED', id: null, blockedReason: null },
    candidate: null,
    receipts: { chain: [] }
  }
}

function opStateWithLastTurn(resolvedProjectIds) {
  return {
    keepGoingRuns: {},
    chatThreads: {
      __command__: [
        { role: 'user', content: 'x', at: clock().toISOString() },
        {
          role: 'assistant',
          content: 'ok',
          at: clock().toISOString(),
          decisionClass: 'AUTO_DECIDE',
          intent: 'STATUS',
          resolvedProjectIds,
          scope: resolvedProjectIds.length === 1 ? 'PROJECT' : 'FLEET'
        }
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
    deps: {
      resolveRepositoryIdentity: async () => ({ ok: false, reason: 'REPOSITORY_UNAVAILABLE' })
    }
  })
  assert.doesNotMatch(result.text, /^Resumed/)
  // Lane M red-team finding (real, fixed): assert.ok on an array is
  // vacuously true even for []  -- strengthened to prove the dispatch
  // attempt actually targeted this one real project, not an empty/wrong
  // target list.
  assert.equal(
    result.dispatchResults?.length,
    1,
    'a real dispatch attempt, not a resume, since there was nothing paused to resume'
  )
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
  assert.equal(
    readKeepGoingRun('proj-b-isolation').state,
    'ACTIVE',
    'project B must be completely untouched'
  )
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

  const first = await respondCommand({
    message: 'pause integration-pause-duplicate',
    projects: projectFixture,
    opState: { keepGoingRuns: {} },
    clock
  })
  assert.match(first.text, /^Paused/)
  assert.equal(readKeepGoingRun('integration-pause-duplicate').state, 'PAUSED')

  const second = await respondCommand({
    message: 'pause integration-pause-duplicate',
    projects: projectFixture,
    opState: { keepGoingRuns: {} },
    clock
  })
  assert.equal(
    second.live,
    false,
    'a duplicate pause must never be reported as a real, live action'
  )
  assert.doesNotMatch(
    second.text,
    /^Paused/,
    'the duplicate delivery must never claim a second successful pause'
  )
  assert.match(second.text, /couldn't pause/i)

  // The run itself is untouched by the refused duplicate -- still PAUSED,
  // and exactly ONE pause transition was ever recorded (the refused second
  // call left no trace in the transition history).
  const run = readKeepGoingRun('integration-pause-duplicate')
  assert.equal(run.state, 'PAUSED')
  const pauseTransitions = run.transitions.filter((t) => t.to === 'PAUSED')
  assert.equal(
    pauseTransitions.length,
    1,
    'the refused duplicate must not append a second PAUSED transition'
  )
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
  const dispatchDeps = {
    resolveRepositoryIdentity: async () => ({ ok: false, reason: 'REPOSITORY_UNAVAILABLE' })
  }

  const first = await respondCommand({
    message: 'resume integration-resume-duplicate',
    projects: projectFixture,
    opState: { keepGoingRuns: {} },
    clock
  })
  assert.match(first.text, /^Resumed/)
  assert.equal(readKeepGoingRun('integration-resume-duplicate').state, 'ACTIVE')

  const second = await respondCommand({
    message: 'resume integration-resume-duplicate',
    projects: projectFixture,
    opState: { keepGoingRuns: {} },
    clock,
    deps: dispatchDeps
  })
  assert.doesNotMatch(
    second.text,
    /^Resumed/,
    'the duplicate delivery must never claim a second successful resume'
  )
  // Lane M red-team finding (real, fixed): assert.ok on an array is
  // vacuously true even for [] -- strengthened to prove the dispatch
  // attempt actually targeted this one real project (never a silently
  // empty or wrong-project target list).
  assert.equal(
    second.dispatchResults?.length,
    1,
    'reclassified as a real dispatch attempt, since there was nothing left to resume'
  )
  assert.equal(second.dispatchResults[0].projectId, 'integration-resume-duplicate')

  // The run's own transition history has exactly one RESUME-to-ACTIVE
  // transition -- the duplicate never appended a second one.
  const run = readKeepGoingRun('integration-resume-duplicate')
  const resumeTransitions = run.transitions.filter(
    (t) => t.to === 'ACTIVE' && t.reason === 'OPERATOR_RESUME'
  )
  assert.equal(
    resumeTransitions.length,
    1,
    'the duplicate call must not append a second OPERATOR_RESUME transition'
  )
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
    Array.from({ length: N }, () =>
      respondCommand({
        message: 'pause lane-e-concurrent-pause',
        projects: projectFixture,
        opState: { keepGoingRuns: {} },
        clock
      })
    )
  )

  const paused = results.filter((r) => r.text.startsWith('Paused'))
  const refused = results.filter((r) => r.live === false)
  assert.equal(
    paused.length,
    1,
    `exactly one of ${N} genuinely concurrent duplicate pause calls must actually succeed`
  )
  assert.equal(
    refused.length,
    N - 1,
    'every other concurrent call must be honestly refused, never a second false "Paused" claim'
  )

  const run = readKeepGoingRun('lane-e-concurrent-pause')
  assert.equal(run.state, 'PAUSED')
  const pauseTransitions = run.transitions.filter((t) => t.to === 'PAUSED')
  assert.equal(
    pauseTransitions.length,
    1,
    `exactly one PAUSED transition despite ${N} genuinely concurrent duplicate calls`
  )
})

// TSF Overnight Control-Plane Burn-In V2, Lane E, RESUME's own genuine-
// concurrency proof (the PAUSE test above's counterpart -- explicitly
// flagged as not yet done). RESUME has a different shape than PAUSE:
// classifyContinueAction's own state read happens OUTSIDE any lock,
// before resumeProjectRun is ever called, so it is possible for every
// one of N concurrent callers to independently read PAUSED (stale or
// not) and all decide RESUME. Safety here does not come from that read
// -- it comes from resumeRun's own real state-machine guard (identical
// mechanism to pauseRun's own PAUSED->PAUSED refusal above), which runs
// INSIDE withKeepGoingRun's synchronous, single-process-serialized
// critical section: only the first caller to actually reach that
// section still finds the run PAUSED; every other caller's own
// resumeRun call throws a real ACTIVE->ACTIVE-class transition error,
// caught by command-responder.mjs's own try/catch around
// resumeProjectRun and turned into an honest "Couldn't resume" refusal
// -- never a crash, never a second false "Resumed" claim. Mutation-
// proof: forcing resumeRun to skip its own transition-legality check
// (treat ACTIVE as resumable) turns this red (multiple real ACTIVE
// transitions recorded instead of one).
test('Lane E: N genuinely concurrent "resume X" chat calls for the same paused project are race-safe -- exactly one real resume, exactly one ACTIVE transition, no crash', async () => {
  await seedPausedRun('lane-e-concurrent-resume')
  const projectFixture = [project('lane-e-concurrent-resume', 'Lane E Concurrent Resume')]
  const dispatchDeps = {
    resolveRepositoryIdentity: async () => ({ ok: false, reason: 'REPOSITORY_UNAVAILABLE' })
  }

  const N = 10
  const results = await Promise.all(
    Array.from({ length: N }, () =>
      respondCommand({
        message: 'resume lane-e-concurrent-resume',
        projects: projectFixture,
        opState: { keepGoingRuns: {} },
        clock,
        deps: dispatchDeps
      })
    )
  )

  const resumed = results.filter((r) => r.text.startsWith('Resumed'))
  assert.equal(
    resumed.length,
    1,
    `exactly one of ${N} genuinely concurrent duplicate resume calls must actually succeed`
  )
  // Every other call must be honestly handled -- either a real refusal
  // (the state-machine guard threw, caught, turned into "Couldn't
  // resume") or correctly reclassified as a dispatch attempt because it
  // read the run as already ACTIVE before ever calling resumeProjectRun
  // -- either way, never a crash and never a second "Resumed" claim.
  for (const r of results) {
    if (!r.text.startsWith('Resumed')) {
      assert.ok(
        /couldn't resume/i.test(r.text) || Array.isArray(r.dispatchResults),
        `every non-winning concurrent call must be an honest refusal or a real dispatch reclassification, never something else: got "${r.text}"`
      )
    }
  }

  const run = readKeepGoingRun('lane-e-concurrent-resume')
  assert.equal(run.state, 'ACTIVE')
  const resumeTransitions = run.transitions.filter(
    (t) => t.to === 'ACTIVE' && t.reason === 'OPERATOR_RESUME'
  )
  assert.equal(
    resumeTransitions.length,
    1,
    `exactly one OPERATOR_RESUME transition despite ${N} genuinely concurrent duplicate calls`
  )
})

// TSF Overnight Control-Plane Burn-In V2, Lane A (state x action x
// surface matrix). Surface dimension collapses to ONE here by
// architectural fact, not omission: PAUSE has no per-surface variation --
// every real caller (Global Command dock, Full Command Mode, and any
// future HTTP client) reaches this exact same respondCommand branch,
// already independently established by CASE-37/App.tsx's own header
// comment ("two separate CommandPanel mounts -- read and write the exact
// same state"). So this is a genuine, exhaustive 6-state x 1-action
// matrix against domain/keep-going.mjs's own real, live RUN_ALLOWED
// table (read directly below, not hand-copied).
//
// Scope, stated precisely (verified by mutation, not assumed): because
// the oracle below and the real execution path both consult the SAME
// live RUN_ALLOWED table, this test cannot catch a change to the
// TABLE'S OWN values (confirmed: narrowing BLOCKED's allowed targets
// left it green, since the oracle silently narrowed with it). What it
// DOES catch, mutation-confirmed, is the execution layer drifting from
// whatever the table currently says -- e.g. transitionRun's own
// RUN_ALLOWED check being bypassed/weakened turns this red immediately.
// That is still real, valuable coverage: it is the exact property a
// "the guard got silently disabled/short-circuited somewhere" regression
// would break.
test('Lane A: state x action(PAUSE) x surface matrix -- "pause X" succeeds iff RUN_ALLOWED[state] permits it, for every real Keep Going run state, never corrupting a refused state', async () => {
  const { RUN_ALLOWED } = await import('../domain/keep-going.mjs')
  const states = Object.keys(RUN_ALLOWED)
  assert.ok(states.length >= 6, `expected a real, non-trivial state set, got ${states.length}`)

  for (const state of states) {
    const projectId = `lane-a-matrix-${state.toLowerCase()}`
    await seedRunInState(projectId, state)
    const expectSuccess = RUN_ALLOWED[state].includes('PAUSED')

    const result = await respondCommand({
      message: `pause ${projectId}`,
      projects: [project(projectId, `Lane A Matrix ${state}`)],
      opState: { keepGoingRuns: {} },
      clock
    })

    if (expectSuccess) {
      assert.match(
        result.text,
        /^Paused/,
        `state ${state}: RUN_ALLOWED permits PAUSED, so "pause X" must really succeed`
      )
      assert.equal(
        readKeepGoingRun(projectId).state,
        'PAUSED',
        `state ${state}: the run must really transition to PAUSED`
      )
    } else {
      assert.doesNotMatch(
        result.text,
        /^Paused/,
        `state ${state}: RUN_ALLOWED forbids PAUSED, so "pause X" must never falsely claim success`
      )
      assert.equal(
        readKeepGoingRun(projectId).state,
        state,
        `state ${state}: a refused pause must never corrupt/change the run's real state`
      )
    }
  }
})

// Lane A's own RESUME counterpart -- explicitly flagged as needing "a
// different oracle shape" than PAUSE's RUN_ALLOWED-driven matrix, since
// classifyContinueAction is a single PAUSED-vs-not ternary with no
// separate policy table to check it against (an exhaustive-states test
// of THAT function alone would be nearly tautological). The real,
// non-trivial property worth proving exhaustively instead: for every
// one of the 6 real states, does "resume X" ever corrupt the run's own
// state -- specifically, does the DISPATCH fallback (which every
// non-PAUSED state reclassifies to) ever silently mutate a run sitting
// in COMPLETE/STALLED/BLOCKED/NEEDS_YOU, states a naive dispatch
// attempt might mistakenly "revive" or touch? Live-verified first (not
// guessed) with a throwaway probe script before writing this: every
// non-PAUSED state honestly falls through to a real dispatch attempt
// that cleanly refuses (TSF_REPOSITORY_NOT_REGISTERED, unrelated to
// the run's own state) and leaves the run's `state` field byte-for-byte
// unchanged -- exercises the real dispatch code path, genuinely
// independent of classifyContinueAction's own trivial branch.
test('Lane A: state x action(RESUME) matrix -- "resume X" only ever really resumes a PAUSED run; every other real state honestly falls through to a dispatch attempt that never corrupts the run\'s own state', async () => {
  const { RUN_ALLOWED } = await import('../domain/keep-going.mjs')
  const states = Object.keys(RUN_ALLOWED)
  const dispatchDeps = {
    resolveRepositoryIdentity: async () => ({ ok: false, reason: 'REPOSITORY_UNAVAILABLE' })
  }

  for (const state of states) {
    const projectId = `lane-a-resume-matrix-${state.toLowerCase()}`
    await seedRunInState(projectId, state)

    const result = await respondCommand({
      message: `resume ${projectId}`,
      projects: [project(projectId, `Lane A Resume Matrix ${state}`)],
      opState: { keepGoingRuns: {} },
      clock,
      deps: dispatchDeps
    })

    if (state === 'PAUSED') {
      assert.match(result.text, /^Resumed/, 'a PAUSED run must really resume')
      assert.equal(
        readKeepGoingRun(projectId).state,
        'ACTIVE',
        'a real PAUSED->ACTIVE transition must actually land'
      )
    } else {
      assert.doesNotMatch(
        result.text,
        /^Resumed/,
        `state ${state}: "resume X" must never falsely claim a resume that cannot have happened`
      )
      assert.equal(
        result.dispatchResults?.length,
        1,
        `state ${state}: must honestly reclassify to a real, single-project dispatch attempt`
      )
      assert.equal(
        result.dispatchResults[0].projectId,
        projectId,
        `state ${state}: the dispatch attempt must target the real project, never a wrong/empty one`
      )
      assert.equal(
        readKeepGoingRun(projectId).state,
        state,
        `state ${state}: the dispatch fallback must never corrupt/change the run's real state`
      )
    }
  }
})

// Lane A's own HOLD dimension -- a genuinely different oracle shape than
// either PAUSE or RESUME: a project execution hold (server/project-
// execution-hold-store.mjs, real caller: command-multi-action-bridge.mjs's
// classifySingleTargetHoldEntries, wired into this same respondCommand
// via command-responder.mjs) is architecturally ORTHOGONAL to the Keep
// Going run's own RUN_ALLOWED state machine -- a hold is a durable,
// independent safety record ("another agent is on this"), never gated by
// what state the run happens to be in (unlike PAUSE/RESUME's real
// RUN_ALLOWED-driven or dispatch-fallback behavior above). So the
// non-trivial property to prove exhaustively here is the mirror image of
// PAUSE's: "hold X" must succeed UNCONDITIONALLY across all 6 real
// states, and -- just as importantly -- must never itself mutate the
// run's own `state` field (findings #16/#17 this same mission both found
// real bugs in hold REACHABILITY/PRECEDENCE vs other actions; this
// exhaustively proves the narrower, still real property that setting a
// hold itself is honest and state-independent, the foundation those
// fixes build on).
test('Lane A: state x action(HOLD) matrix -- "X is being handled by another agent, leave it alone" sets a real, durable hold regardless of run state, and never itself mutates the run\'s own state', async () => {
  const { RUN_ALLOWED } = await import('../domain/keep-going.mjs')
  const states = Object.keys(RUN_ALLOWED)

  for (const state of states) {
    const projectId = `lane-a-hold-matrix-${state.toLowerCase()}`
    await seedRunInState(projectId, state)
    const before = readProjectExecutionHold(projectId)
    assert.equal(
      before,
      null,
      `state ${state}: sanity -- no pre-existing hold for this fresh fixture`
    )

    const result = await respondCommand({
      message: `${projectId} is being handled by another agent right now, leave it alone -- do not touch it.`,
      projects: [project(projectId, `Lane A Hold Matrix ${state}`)],
      opState: { keepGoingRuns: {} },
      clock
    })

    assert.match(
      result.text,
      /Held/,
      `state ${state}: a hold request must really succeed regardless of run state`
    )
    const hold = readProjectExecutionHold(projectId)
    assert.ok(hold, `state ${state}: a real, durable hold must actually have been written`)
    assert.equal(hold.status, 'ACTIVE', `state ${state}: the hold must really be ACTIVE`)
    assert.equal(
      readKeepGoingRun(projectId).state,
      state,
      `state ${state}: setting a hold must never itself corrupt/change the run's real state`
    )
  }
})

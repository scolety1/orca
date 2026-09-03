import assert from 'node:assert/strict'
import test from 'node:test'
import { classifyDecision, classifyIntent, respond } from '../server/chat-responder.mjs'
import { loadRealPilotProjects } from '../server/portfolio-projection.mjs'
import {
  checkpointRun,
  createOvernightRun,
  dispatchWave,
  planWave,
  raiseNeedsYou
} from '../domain/keep-going.mjs'

const clock = () => new Date('2026-08-20T05:00:00.000Z')

// M3: the affirmative "go do real work" phrasings Tim's own north star names
// verbatim ("Fix this," "go ahead," "build that," "do the recommended next
// step") must all be recognized as dispatch-worthy, not fall through to
// GENERAL. "Fix this" was already covered (FIX_REQUEST); this covers the
// rest under the new DISPATCH_REQUEST intent.
test('classifyIntent recognizes every north-star dispatch phrasing', () => {
  assert.equal(classifyIntent('Fix this'), 'FIX_REQUEST')
  assert.equal(classifyIntent('go ahead'), 'DISPATCH_REQUEST')
  assert.equal(classifyIntent('build that'), 'DISPATCH_REQUEST')
  assert.equal(classifyIntent('do the recommended next step'), 'DISPATCH_REQUEST')
})

test('classifyIntent does not confuse ordinary questions with a dispatch request', () => {
  assert.equal(classifyIntent('what should we do next?'), 'NEXT_ACTION')
  assert.equal(classifyIntent('is this actually finished?'), 'FINISHED')
})

// Command's own exact phrasing (spec Phase 7) -- a real gap found live via
// a manual UI pass: this did not match any pattern and fell through to
// GENERAL, so a fleet-wide "what's running?" question wrongly got Command's
// "couldn't tell which project" reply instead of a real status answer.
test('classifyIntent recognizes Command\'s "what\'s running (right now)?" as STATUS', () => {
  assert.equal(classifyIntent("what's running right now?"), 'STATUS')
  assert.equal(classifyIntent('whats running'), 'STATUS')
})

test('DISPATCH_REQUEST classifies as RECOMMEND_AND_PROCEED, same tier as FIX_REQUEST', () => {
  assert.equal(classifyDecision('go ahead', 'DISPATCH_REQUEST'), 'RECOMMEND_AND_PROCEED')
  assert.equal(classifyDecision('build that', 'DISPATCH_REQUEST'), 'RECOMMEND_AND_PROCEED')
})

// The authority gate must win regardless of intent -- a dispatch-shaped
// phrasing that ALSO contains consequential wording must still refuse.
test('a TIM_REQUIRED pattern overrides DISPATCH_REQUEST -- chat must never silently authorize a forbidden action just because it is phrased as "go ahead"', () => {
  assert.equal(
    classifyDecision('go ahead and push this to production', 'DISPATCH_REQUEST'),
    'TIM_REQUIRED'
  )
  assert.equal(
    classifyDecision('go ahead and adopt the candidate', 'DISPATCH_REQUEST'),
    'TIM_REQUIRED'
  )
  assert.equal(classifyDecision('build that and deploy it', 'DISPATCH_REQUEST'), 'TIM_REQUIRED')
})

test('respond() has a real responder for DISPATCH_REQUEST -- it must not crash or fall through to GENERAL', () => {
  const project = loadRealPilotProjects()[0]
  const result = respond(project, 'go ahead')
  assert.equal(result.intent, 'DISPATCH_REQUEST')
  assert.equal(result.decisionClass, 'RECOMMEND_AND_PROCEED')
  assert.match(result.text, new RegExp(project.displayName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
})

test('respond() still refuses TIM_REQUIRED phrasing before ever answering as a dispatch request', () => {
  const project = loadRealPilotProjects()[0]
  const result = respond(project, 'go ahead and merge this to main')
  assert.equal(result.decisionClass, 'TIM_REQUIRED')
  assert.match(result.text, /consequential decision/i)
})

// Real Planner Chat authority false positive (V1 stabilization finding):
// TSF refused an entire read-only readiness-assessment request as
// TIM_REQUIRED merely because Tim's own prompt listed the consequential
// actions he was explicitly ruling OUT (a bare keyword match against the
// whole message, no negation/inquiry awareness). "Tell me whether X would
// be safe" must never classify the same as "do X".
test('a read-only readiness question that explicitly prohibits consequential actions is AUTO_DECIDE, not TIM_REQUIRED', () => {
  const message =
    'Is NWR safe to enter Active Fleet and Work Set? Give me an evidence-backed readiness assessment. ' +
    'Do not modify files, do not implement anything, do not change Work Set, no adoption, ' +
    'no push/merge/deploy, no credentials/money, no destructive actions.'
  assert.equal(classifyDecision(message, classifyIntent(message)), 'AUTO_DECIDE')
})

test('"tell me whether to deploy" (inquiry) and "deploy it" (directive) do not classify identically', () => {
  assert.equal(classifyDecision('tell me whether to deploy', 'GENERAL'), 'AUTO_DECIDE')
  assert.equal(classifyDecision('deploy it', 'GENERAL'), 'TIM_REQUIRED')
})

test('an explicit "should this be deployed?" readiness question is AUTO_DECIDE', () => {
  assert.equal(classifyDecision('Should this be deployed to production?', 'GENERAL'), 'AUTO_DECIDE')
})

test('a genuine consequential directive is still refused even alongside an unrelated prohibited clause', () => {
  // The prohibition ("no credentials") must not accidentally launder a real
  // directive elsewhere in the same message ("push this now").
  const message = 'No credentials needed. Push this now.'
  assert.equal(classifyDecision(message, classifyIntent(message)), 'TIM_REQUIRED')
})

// BUG-08 (bug-ledger.json) real, reproduced regression: a bare "and" (no
// comma/"but"/em-dash) between a negated clause and a genuine, separate
// directive was NOT a clause boundary, so PROHIBITION_MARKERS matching
// anywhere in the whole (unsplit) clause silently laundered the real
// directive through as non-TIM_REQUIRED. Same class of bug the comma/
// "but"/em-dash regressions above already close -- "and" just wasn't
// included.
test('a negation and a genuine directive joined by a bare "and" (no comma) does not launder the directive through', () => {
  const message = 'do not deploy this and push it now'
  assert.equal(classifyDecision(message, classifyIntent(message)), 'TIM_REQUIRED')
})

test('a negation and a chained "go ahead and X" directive joined by "and" is still refused', () => {
  const message = 'please do not deploy and go ahead and merge this'
  assert.equal(classifyDecision(message, classifyIntent(message)), 'TIM_REQUIRED')
})

test('a bare "and" join between two ordinary (non-consequential) actions is unaffected', () => {
  const message = 'test and verify the fix'
  assert.equal(classifyDecision(message, classifyIntent(message)), 'AUTO_DECIDE')
})

test('"and" splitting does not regress a already-negated, single consequential clause', () => {
  assert.equal(classifyDecision('do not merge this', 'GENERAL'), 'AUTO_DECIDE')
  assert.equal(classifyDecision('please do not push to production', 'GENERAL'), 'AUTO_DECIDE')
})

// Independent-verification finding: the "and" clause-split above (BUG-08)
// introduced its own new false-negative regression -- when "and"-splitting
// isolates an informal, subject-less future-tense fragment ("...and will
// deploy after that") as its own clause, that clause starts with a bare
// inquiry-opener word ("will"/"should"/etc.) purely by grammatical
// coincidence, not because anything is actually being asked. The bare-
// opener check now additionally requires the clause's own sentence to
// contain a real "?" (TELL_ME_WHETHER's explicit "tell me...whether" shape
// stays unconditional, since it's unambiguous regardless of punctuation).
test('an "and"-joined future-tense directive fragment starting with a bare opener word is not misread as a question', () => {
  assert.equal(classifyDecision('run the tests and will deploy after that', 'GENERAL'), 'TIM_REQUIRED')
  assert.equal(classifyDecision('looks good and will push this to prod', 'GENERAL'), 'TIM_REQUIRED')
  assert.equal(classifyDecision('tests pass and will deploy it now', 'GENERAL'), 'TIM_REQUIRED')
  assert.equal(classifyDecision('wrap this up and should merge soon', 'GENERAL'), 'TIM_REQUIRED')
})

test('a genuine bare-opener inquiry (no "?" but the sentence is unambiguously a question) still classifies as an inquiry', () => {
  // Regression guard the other direction: BARE_OPENER's sentence-wide "?"
  // gate must not have quietly broken the case it was designed for.
  assert.equal(classifyDecision('tell me whether to deploy', 'GENERAL'), 'AUTO_DECIDE')
  assert.equal(classifyDecision('Should this be deployed to production?', 'GENERAL'), 'AUTO_DECIDE')
})

// Second-independent-verification-pass finding, real and reproduced, found
// while re-checking the "and" fix above but pre-existing/unrelated to it:
// "whether ... or not" and "no matter" are idioms meaning "regardless,"
// never a real negation -- PROHIBITION_MARKERS' bare "not"/"no" match had
// no idiom awareness and silently waved a genuine, unhedged directive
// through as AUTO_DECIDE whenever its only "negation-looking" text was one
// of these two idioms.
test('a "whether ... or not" / "no matter" idiom does not launder a genuine directive as a negation', () => {
  assert.equal(classifyDecision('deploy it whether tim likes it or not', 'GENERAL'), 'TIM_REQUIRED')
  assert.equal(
    classifyDecision('push this to production whether you approve or not', 'GENERAL'),
    'TIM_REQUIRED'
  )
  assert.equal(classifyDecision('deploy this no matter what', 'GENERAL'), 'TIM_REQUIRED')
})

test('a real negation alongside an unrelated "or not"/"no matter" idiom in the same message still reads as a negation where it belongs', () => {
  // The strip is scoped to matching substrings only -- a genuine "do not"
  // elsewhere in the same clause must still count.
  assert.equal(classifyDecision('do not deploy this, no matter what anyone says', 'GENERAL'), 'AUTO_DECIDE')
})

test('a bare imperative consequential request with no hedging is still TIM_REQUIRED', () => {
  assert.equal(classifyDecision('Merge this to main.', 'GENERAL'), 'TIM_REQUIRED')
  assert.equal(classifyDecision('Adopt the candidate.', 'GENERAL'), 'TIM_REQUIRED')
})

// Regression (found while fixing the false-positive above): "can/could/
// would/will YOU ...?" is a standard polite-request form in English, not a
// genuine safety/advisability inquiry, even though it is phrased as a
// question and opens with a modal verb — an early version of the fix
// wrongly let the bare "?" rule reclassify this as AUTO_DECIDE.
test('a polite "can you ...?" request is still TIM_REQUIRED, unlike a genuine "is it safe?" inquiry', () => {
  assert.equal(classifyDecision('can you push this to production?', 'GENERAL'), 'TIM_REQUIRED')
  assert.equal(classifyDecision('Is it safe to push this to production?', 'GENERAL'), 'AUTO_DECIDE')
})

// Independent-review finding (dangerous-direction regression, caught before
// adoption): an inquiry/prohibition earlier in a comma- or "but"/em-dash-
// joined run-on sentence must never exempt a genuine, unrelated directive
// later in the same loose clause. Real examples the reviewer constructed,
// including one that silently authorized a destructive repo delete.
test('a hedge/question/prohibition earlier in a run-on sentence does not launder a real directive later in it', () => {
  assert.equal(
    classifyDecision('I do not think we should wait -- push this to production now.', 'GENERAL'),
    'TIM_REQUIRED'
  )
  assert.equal(
    classifyDecision('This is not optional -- deploy it now.', 'GENERAL'),
    'TIM_REQUIRED'
  )
  assert.equal(
    classifyDecision('Not sure but go ahead and merge this to main.', 'DISPATCH_REQUEST'),
    'TIM_REQUIRED'
  )
  assert.equal(
    classifyDecision('no rush, but please merge this to main whenever you get a chance', 'GENERAL'),
    'TIM_REQUIRED'
  )
  assert.equal(classifyDecision("don't wait, push to production", 'GENERAL'), 'TIM_REQUIRED')
  assert.equal(
    classifyDecision(
      'I know you said not to touch credentials, but please rotate the api key now',
      'GENERAL'
    ),
    'TIM_REQUIRED'
  )
  assert.equal(
    classifyDecision('what is the plan, and also please push this to production', 'GENERAL'),
    'TIM_REQUIRED'
  )
  assert.equal(
    classifyDecision('why did the build fail, also please merge this to main', 'GENERAL'),
    'TIM_REQUIRED'
  )
  assert.equal(
    classifyDecision('how do I check status, and go ahead and delete the repo', 'GENERAL'),
    'TIM_REQUIRED',
    'must never silently authorize a destructive delete'
  )
})

// Broadened destructive-action coverage (spec Phase 12) -- the original
// pattern only caught "delete the repo/repository/branch/production"; a
// Command-driven fleet action could plausibly phrase destruction other
// ways too.
test('classifyDecision recognizes a wider real vocabulary of destructive actions, not just "delete the repo"', () => {
  assert.equal(classifyDecision('go ahead and drop the database', 'GENERAL'), 'TIM_REQUIRED')
  assert.equal(classifyDecision('wipe the data and start over', 'GENERAL'), 'TIM_REQUIRED')
  assert.equal(classifyDecision('destroy the branch, go ahead', 'GENERAL'), 'TIM_REQUIRED')
  assert.equal(classifyDecision('go ahead and force push over main', 'GENERAL'), 'TIM_REQUIRED')
  assert.equal(classifyDecision('do a hard reset and go ahead', 'GENERAL'), 'TIM_REQUIRED')
  assert.equal(classifyDecision('run rm -rf on the build dir', 'GENERAL'), 'TIM_REQUIRED')
})

test('the broadened destructive patterns still respect the same inquiry/prohibition gate as every other TIM_REQUIRED pattern', () => {
  assert.equal(classifyDecision('should I drop the database or keep it?', 'GENERAL'), 'AUTO_DECIDE')
  assert.equal(classifyDecision("don't force push, ever", 'GENERAL'), 'AUTO_DECIDE')
})

// Independent-review finding (dangerous-direction regression, 2nd pass): a
// comma-interrupted "can/could/would/will you ... <verb>" polite request had
// its "you" clause split away from the verb+keyword clause by the run-on-
// sentence fix above, so the verb clause was judged on its own trailing "?"
// alone and misread as a bare inquiry. The polite-request check now looks at
// the whole sentence a clause came from, not just the clause fragment.
test('a comma-interrupted polite "can/would you ...?" request is still TIM_REQUIRED', () => {
  assert.equal(
    classifyDecision('Can you, if you have a moment, push this to production?', 'GENERAL'),
    'TIM_REQUIRED'
  )
  assert.equal(
    classifyDecision('Would you, when convenient, deploy this?', 'GENERAL'),
    'TIM_REQUIRED'
  )
  assert.equal(
    classifyDecision('Would you like coffee? Also, please do not push to production.', 'GENERAL'),
    'AUTO_DECIDE',
    "an earlier sentence's polite marker must not sweep up a later, unrelated prohibition"
  )
})

// M3: "what is it doing?" must answer from the real, live Keep Going run
// once one exists -- not the old mission/candidate/release model, which
// has no relationship to it at all.
function activeRunWithInFlightWave() {
  let run = createOvernightRun(
    {
      id: 'run-1',
      projectId: 'fixture:proj',
      originalGoal: 'Ship it.',
      acceptanceCriteria: ['CRITERION_A'],
      usageMode: 'BALANCED'
    },
    clock
  )
  const plan = planWave(run, [{ id: 't1', scope: ['a.mjs'] }], clock)
  run = dispatchWave(
    run,
    plan,
    [{ workItemId: 't1', scope: ['a.mjs'], taskId: 'task-1', dispatchId: 'ctx-1' }],
    clock,
    run.revision
  )
  return run
}

test('STATUS answers from the live run, not the old mission/candidate model, once a run exists', () => {
  const project = loadRealPilotProjects()[0]
  const run = activeRunWithInFlightWave()
  const result = respond(project, "what's going on with this project?", run)
  assert.equal(result.intent, 'STATUS')
  assert.match(result.text, /Keep Going run/)
  assert.match(result.text, /WORKING/)
  assert.doesNotMatch(
    result.text,
    /mission `/i,
    'must not fall back to the old mission-shaped text'
  )
})

// M4: "recovery summary after restart" -- 'catch me up' already shares
// STATUS's own pattern; this proves the answer now includes a real,
// chronological read of the durable checkpoint trail, not just the
// current one-line state.
test('STATUS ("catch me up") includes a real recent-history trail once more than one checkpoint exists', () => {
  const project = loadRealPilotProjects()[0]
  let run = activeRunWithInFlightWave()
  run = checkpointRun(run, { phase: 'WAVE_DISPATCHED' }, clock)
  run = checkpointRun(run, { phase: 'RUN_PAUSED' }, clock)
  const result = respond(project, 'catch me up', run)
  assert.equal(result.intent, 'STATUS')
  assert.match(result.text, /Recent history:/)
  assert.match(result.text, /WAVE_DISPATCHED -> RUN_PAUSED/)
})

test('STATUS omits the recent-history trail for a freshly started run with nothing yet to recap', () => {
  const project = loadRealPilotProjects()[0]
  const run = activeRunWithInFlightWave()
  const result = respond(project, "what's going on with this project?", run)
  assert.doesNotMatch(result.text, /Recent history:/)
})

test('NEXT_ACTION on a NEEDS_YOU run surfaces the real open question, not a fictional affordance', () => {
  const project = loadRealPilotProjects()[0]
  let run = createOvernightRun(
    {
      id: 'run-1',
      projectId: 'fixture:proj',
      originalGoal: 'Ship it.',
      acceptanceCriteria: ['CRITERION_A'],
      usageMode: 'BALANCED'
    },
    clock
  )
  run = raiseNeedsYou(run, { question: 'Which approach should I take?' }, clock, run.revision)
  const result = respond(project, 'what should we do next?', run)
  assert.equal(result.intent, 'NEXT_ACTION')
  assert.match(result.text, /NEEDS_YOU/)
  assert.match(result.text, /Which approach should I take\?/)
})

test('respond() without a run keeps the exact prior mission-shaped behavior unchanged', () => {
  const project = loadRealPilotProjects()[0]
  const result = respond(project, "what's going on with this project?")
  assert.equal(result.intent, 'STATUS')
  assert.match(result.text, /mission `/)
})

// An independent review finding: an earlier version let ANY existing run
// -- including one long COMPLETE/BLOCKED and since forgotten -- shadow
// every future STATUS/NEXT_ACTION/FINISHED question for that project
// forever (nothing in the codebase ever clears keepGoingRuns[projectId]).
// A run that has genuinely concluded must fall back to the old, richer
// mission/candidate/release model instead, since that model's own
// completion/adoption answer is the more relevant one at that point.
test('a COMPLETE run does not shadow STATUS -- falls back to the old mission-shaped model', () => {
  const project = loadRealPilotProjects()[0]
  let run = createOvernightRun(
    {
      id: 'run-1',
      projectId: 'fixture:proj',
      originalGoal: 'Ship it.',
      acceptanceCriteria: ['CRITERION_A'],
      usageMode: 'BALANCED'
    },
    clock
  )
  run = { ...run, state: 'COMPLETE' }
  const result = respond(project, "what's going on with this project?", run)
  assert.equal(result.intent, 'STATUS')
  assert.match(
    result.text,
    /mission `/,
    'must fall back to the old model, not the stale COMPLETE run'
  )
})

test('a BLOCKED run does not shadow NEXT_ACTION either', () => {
  const project = loadRealPilotProjects()[0]
  let run = createOvernightRun(
    {
      id: 'run-1',
      projectId: 'fixture:proj',
      originalGoal: 'Ship it.',
      acceptanceCriteria: ['CRITERION_A'],
      usageMode: 'BALANCED'
    },
    clock
  )
  run = { ...run, state: 'BLOCKED' }
  const result = respond(project, 'what should we do next?', run)
  assert.equal(result.intent, 'NEXT_ACTION')
  assert.doesNotMatch(result.text, /Keep Going run `/)
})

test('FINISHED on a non-terminal live run honestly answers "not yet", grounded in real state', () => {
  const project = loadRealPilotProjects()[0]
  const run = activeRunWithInFlightWave()
  const result = respond(project, 'is this actually finished?', run)
  assert.equal(result.intent, 'FINISHED')
  assert.match(result.text, /No, not yet/)
  assert.match(result.text, /WORKING/)
})

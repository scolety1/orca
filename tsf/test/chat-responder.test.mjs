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

// Recovered from a stranded uncommitted worktree: QUESTION/FEEDBACK_BUG
// were genuinely missing (fell through to GENERAL's non-answer); ported
// as-is, the underlying chat-responder.mjs base was unchanged here.
test('Planner Chat distinguishes questions, bug feedback, and implementation requests', () => {
  assert.equal(classifyIntent('Why does this sidebar jump?'), 'QUESTION')
  assert.equal(
    classifyIntent('The save button is broken and the sidebar jumps around.'),
    'FEEDBACK_BUG'
  )
  assert.equal(classifyIntent('The sidebar is broken. Fix this.'), 'FIX_REQUEST')
  assert.equal(classifyDecision('The save button is broken.', 'FEEDBACK_BUG'), 'AUTO_DECIDE')
  assert.equal(classifyDecision('Fix this sidebar.', 'FIX_REQUEST'), 'RECOMMEND_AND_PROCEED')
})

// Full Conversational Control Plane Exhaustive Gauntlet V1, Batch 9 (real
// response-truthfulness finding): this test used to assert the response
// text matches /recorded/i -- checking WORDING, never that anything was
// actually persisted. respond() is a pure function with no I/O anywhere
// in its call chain (confirmed: no feedback-store module exists anywhere
// in this codebase), so "Recorded on X" was a real, confirmed false
// claim, not a backed statement. Rewritten to assert the real invariant:
// the response never claims a durable record that doesn't exist, while
// still naming the project and never claiming Tim must hand it off.
test('bug feedback names the project and gives a real next step, never a false "recorded" claim with no backing durable write', () => {
  const project = loadRealPilotProjects()[0]
  const result = respond(project, 'The save button is broken.')
  assert.equal(result.intent, 'FEEDBACK_BUG')
  assert.doesNotMatch(result.text, /\brecorded\b/i, 'no durable feedback store exists anywhere in this codebase -- must never claim one persisted this')
  assert.match(result.text, new RegExp(project.displayName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  assert.match(result.text, /ask me to fix it/i, 'still gives the real, working next step')
  assert.doesNotMatch(result.text, /hand (it|this) (to|off)/i)
})

// Command's own exact phrasing (spec Phase 7) -- a real gap found live via
// a manual UI pass: this did not match any pattern and fell through to
// GENERAL, so a fleet-wide "what's running?" question wrongly got Command's
// "couldn't tell which project" reply instead of a real status answer.
test('classifyIntent recognizes Command\'s "what\'s running (right now)?" as STATUS', () => {
  assert.equal(classifyIntent("what's running right now?"), 'STATUS')
  assert.equal(classifyIntent('whats running'), 'STATUS')
})

// Phase 7 dogfood finding: real, reproduced via respondCommand against a
// live fixture fleet -- Tim's own uncontracted phrasing ("What is running?",
// this phase's own command list, verbatim) fell through to QUESTION and got
// Command's generic "couldn't tell which project" reply instead of the real
// fleet status, for the exact same missing-contraction reason the comment
// above already documents for "what's running". "What finished?" had the
// identical gap: FINISHED's own pattern only covered "is it done"-shaped
// phrasing, never a bare "what finished" question.
test('Phase 7: uncontracted "What is running?"/"What finished?" are recognized (STATUS/FINISHED), not swallowed by QUESTION', () => {
  assert.equal(classifyIntent('What is running?'), 'STATUS')
  assert.equal(classifyIntent('what is going on?'), 'STATUS')
  assert.equal(classifyIntent('What finished?'), 'FINISHED')
  assert.equal(classifyIntent('what is done'), 'FINISHED')
})

// Phase 16: closes the residual gap the test above used to pin as disclosed-
// not-fixed -- "what's finished"/"what is finished" (the predicate-adjective
// FINISHED synonym) previously fell through to GENERAL for the same missing-
// vocabulary reason "what finished" once did.
test('Phase 16: "what\'s finished"/"what is finished" are recognized as FINISHED, not swallowed by GENERAL', () => {
  assert.equal(classifyIntent("what's finished"), 'FINISHED')
  assert.equal(classifyIntent('what is finished'), 'FINISHED')
  assert.equal(classifyIntent('whats finished'), 'FINISHED')
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

// Fuzzing finding (Full Conversational Control Plane Exhaustive Gauntlet
// V1, Batch 5): PROHIBITION_MARKERS never generalized the "-n't"
// contraction family (doesn't/haven't/etc), the same gap found in
// domain/command-adoption-execution.mjs and domain/command-multi-action-
// decomposition.mjs's own negation checks. Lower severity here -- a missed
// negator here only biases toward the SAFE direction (TIM_REQUIRED, never
// a false auto-execute) -- fixed anyway for defense-in-depth.
test("the \"-n't\" contraction family is recognized as a genuine prohibition, not just the hand-picked subset", () => {
  assert.equal(classifyDecision("This doesn't push to production.", classifyIntent("This doesn't push to production.")), 'AUTO_DECIDE')
  assert.equal(classifyDecision('We haven\'t deployed this yet.', classifyIntent('We haven\'t deployed this yet.')), 'AUTO_DECIDE')
})

test('the "-n\'t" contraction generalization does not regress a genuine, unnegated directive', () => {
  assert.equal(classifyDecision('push this now', classifyIntent('push this now')), 'TIM_REQUIRED')
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

// Command architecture round 3, adoption/deployment advisory: "merely
// mentioning deploy, merge, adopt, etc. is not authorization." Verified
// existing behavior, locked in as a regression test -- no new code, this
// codebase's own inquiry/negation handling (isConsequentialDirective's
// BARE_OPENER/TELL_ME_WHETHER logic) already gets this right.
test('a genuine deploy/adopt/update QUESTION is never treated as TIM_REQUIRED authorization -- only a bare directive is', () => {
  for (const question of ['should I deploy WorldForge?', 'is TSF safe to update?', 'can I adopt this candidate?', 'should I push this?']) {
    assert.notEqual(classifyDecision(question, classifyIntent(question)), 'TIM_REQUIRED', `"${question}" must not be treated as authorization`)
  }
  assert.equal(classifyDecision('deploy WorldForge', classifyIntent('deploy WorldForge')), 'TIM_REQUIRED', 'a genuine bare directive must still require Tim')
})

// FIXED (real, live-reproduced -- Full Conversational Control Plane
// Exhaustive Gauntlet V1): "awesome! this is so great!" (and other bare
// acknowledgement/praise) right after an adoption-readiness discussion must
// NEVER be treated as though a consequential decision was made. CORE
// INVARIANT: context may resolve WHAT is being discussed; the CURRENT TURN
// must supply the verb before any action is implied.
test('Phase 4 acknowledgement gauntlet: bare praise/acknowledgement classifies ACKNOWLEDGEMENT, never a consequential intent', () => {
  const cases = [
    'awesome', 'awesome!', 'awesome!!!', 'this is great', 'this is so great', 'great',
    'looks great', 'looks good', 'nice', 'perfect', 'sweet', 'cool', 'love it', 'hell yeah',
    'sick', 'exactly', "that's exactly what I wanted", 'thank you', 'thanks', 'cool thanks',
    '👍', '🔥', 'Landing Page looks awesome', 'Nytheria looks good'
  ]
  for (const message of cases) {
    assert.equal(classifyIntent(message), 'ACKNOWLEDGEMENT', `expected ACKNOWLEDGEMENT for: "${message}"`)
    assert.notEqual(classifyDecision(message, classifyIntent(message)), 'TIM_REQUIRED', `must never require Tim for pure acknowledgement: "${message}"`)
  }
})

// Adversarial-review findings (2nd pass): emoji directly adjacent to a
// word (no punctuation between them) stayed one un-matchable segment and
// fell through to GENERAL -- the exact no-guardrail live-LLM path this fix
// exists to close, for an extremely natural way to type acknowledgement.
// Also: "amazing" was recognized inside a praise-verb phrase but not as a
// bare word, and ":" was not a segment delimiter.
test('Phase 4 acknowledgement gauntlet: emoji-adjacent-to-word, bare "amazing", and colon-delimited segments all classify ACKNOWLEDGEMENT', () => {
  const cases = ['👍 thanks!', 'thanks 👍', '🔥🔥 awesome', 'amazing', 'great: thanks']
  for (const message of cases) {
    assert.equal(classifyIntent(message), 'ACKNOWLEDGEMENT', `expected ACKNOWLEDGEMENT for: "${message}"`)
  }
})

test('Phase 4 acknowledgement gauntlet: explicit-action counterparts are NOT swallowed by acknowledgement -- they still gate correctly', () => {
  const messages = ['awesome, adopt it', 'looks good — merge it', 'perfect, keep going', 'great, deploy it']
  for (const message of messages) {
    assert.notEqual(classifyIntent(message), 'ACKNOWLEDGEMENT', `must not classify as bare acknowledgement: "${message}"`)
  }
  assert.equal(classifyIntent('awesome, adopt it'), 'ADOPTION')
  // The consequential ones must still require Tim regardless of intent id --
  // decisionClass is computed independently via isConsequentialDirective.
  assert.equal(classifyDecision('looks good — merge it', classifyIntent('looks good — merge it')), 'TIM_REQUIRED')
  assert.equal(classifyDecision('great, deploy it', classifyIntent('great, deploy it')), 'TIM_REQUIRED')
})

test('respondAcknowledgement: the response text NEVER claims an action was taken, and grounds in real candidate/mission state', () => {
  const project = loadRealPilotProjects()[0]
  const result = respond(project, 'awesome! this is so great!')
  assert.equal(result.intent, 'ACKNOWLEDGEMENT')
  assert.match(result.text, /no action was taken/i)
  // Truthfully DESCRIBING pre-existing state (this real fixture project
  // genuinely is ADOPTED) is correct and desired -- what must never appear
  // is a first-person CLAIM that the current turn caused an action.
  assert.doesNotMatch(result.text, /\bI(?:'ve| have)?\s+(?:just\s+)?(?:adopted|merged|pushed|deployed|published)\b/i)
})

// The EXACT reported scenario: "Landing Page / candidate / adoption
// discussion. User: 'awesome! this is so great!'" -- a real READY_FOR_
// ADOPTION candidate, then bare enthusiasm. Must explicitly say no action
// was taken and name the real, pending decision, never imply it was made.
test('respondAcknowledgement on a READY_FOR_ADOPTION project: explicitly names the pending decision, never implies it was made', () => {
  const base = loadRealPilotProjects()[0]
  const project = { ...base, displayName: 'Landing Page', candidate: { ...base.candidate, state: 'READY_FOR_ADOPTION' } }
  const result = respond(project, 'awesome! this is so great!')
  assert.equal(result.intent, 'ACKNOWLEDGEMENT')
  assert.match(result.text, /no action was taken/i)
  assert.match(result.text, /READY_FOR_ADOPTION/)
  assert.match(result.text, /adopt it/i)
  assert.doesNotMatch(result.text, /\bI(?:'ve| have)?\s+(?:just\s+)?adopted\b/i)
})

test('respondAcknowledgement is a real, zero-LLM-call grounded answer (deterministic, not dependent on any live provider)', () => {
  const project = loadRealPilotProjects()[0]
  // Called twice with the same input -- a live LLM call could vary; this
  // must be byte-identical, proving it is pure/deterministic.
  const first = respond(project, 'awesome!').text
  const second = respond(project, 'awesome!').text
  assert.equal(first, second)
})

// Adversarial-review finding (BLOCKING sibling fix, real, verified): while
// this file's own PROHIBITION_MARKERS already tolerated curly apostrophes
// for won't/can't, its shared NOT_CONTRACTION_SOURCE vocabulary was still
// missing the archaic forms found in the same review pass as the curly-
// apostrophe gap in the other two negation checks -- fixed there for
// consistency.
test("the archaic \"shan't\" form is recognized as a genuine prohibition", () => {
  assert.equal(classifyDecision("You shan't push this.", classifyIntent("You shan't push this.")), 'AUTO_DECIDE')
})

// Full Control Plane Exhaustive Gauntlet V1, Batch 10 (real response-
// truthfulness finding, same class as the FEEDBACK_BUG fix above): the
// CRITIQUE/FIX_REQUEST response used to say "I've logged this as feedback
// on X" -- respond() is a pure function with no I/O anywhere in its call
// chain, and no feedback-store module exists anywhere in this codebase.
test('CRITIQUE and FIX_REQUEST responses never claim a durable log/record that does not exist', () => {
  const project = loadRealPilotProjects()[0]
  for (const message of ['This looks like garbage honestly.', 'Fix this.']) {
    const result = respond(project, message)
    assert.doesNotMatch(result.text, /\blogged\b/i, `no feedback-store module exists anywhere in this codebase -- must never claim one logged this ("${message}")`)
    assert.doesNotMatch(result.text, /\brecorded\b/i, `must never claim a record exists ("${message}")`)
    assert.match(result.text, new RegExp(project.displayName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  }
})

// TSF Overnight Control-Plane Burn-In V2, Lane G (real, live-confirmed,
// previously undiscovered): the SAME false-claim class the test above
// already locks in for CRITIQUE/FIX_REQUEST ("I've logged this as
// feedback...") existed, unnoticed, in respondDispatchRequest's own text
// ("I've logged this as a request on X") this entire mission -- no
// dispatch-request store exists anywhere in this codebase either, and
// this exact property was simply never tested for DISPATCH_REQUEST
// specifically. Fixed the same way (removed the false claim, kept the
// real working next step); locked in here so this specific responder
// never regresses again.
test('DISPATCH_REQUEST fallback response never claims a durable log/record that does not exist', () => {
  const project = loadRealPilotProjects()[0]
  const result = respond(project, 'Please run the migration script.')
  assert.doesNotMatch(result.text, /\blogged\b/i, 'no dispatch-request store module exists anywhere in this codebase -- must never claim one logged this')
  assert.doesNotMatch(result.text, /\brecorded\b/i, 'must never claim a record exists')
  assert.match(result.text, new RegExp(project.displayName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
})

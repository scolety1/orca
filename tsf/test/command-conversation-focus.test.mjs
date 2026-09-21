import assert from 'node:assert/strict'
import test from 'node:test'
import {
  nextCommandFocus,
  isExplicitSwitchMessage,
  isGoBackMessage,
  RECENT_PROJECT_STACK_CAP
} from '../domain/command-conversation-focus.mjs'

const clock = () => new Date('2026-09-19T00:00:00.000Z')

test('nextCommandFocus: first focus-setting turn ("Let\'s work on NWR") sets focus from null', () => {
  const next = nextCommandFocus(
    null,
    { turnTargetProjectIds: ['nwr'], decisionClass: 'AUTO_DECIDE', isExplicitSwitch: true },
    clock
  )
  assert.equal(next.focusProjectId, 'nwr')
  assert.deepEqual(next.recentProjectStack, [])
})

test('nextCommandFocus: dispatch-worthy message naming a project sets focus AND is a real turn target ("Research waiver mechanics...")', () => {
  const next = nextCommandFocus(
    { focusProjectId: null, recentProjectStack: [], updatedAt: clock().toISOString() },
    { turnTargetProjectIds: ['nwr'], decisionClass: 'RECOMMEND_AND_PROCEED' },
    clock
  )
  assert.equal(next.focusProjectId, 'nwr')
})

test('isExplicitSwitchMessage: a natural spoken correction ("No, I meant X") is recognized -- real dogfood-round-1 finding', () => {
  assert.equal(isExplicitSwitchMessage('No, I meant VOICE-ALPHA.'), true)
  assert.equal(isExplicitSwitchMessage('I meant the other one.'), true)
})

// REAL DOGFOOD FINDING (round 1, P1, Codex-confirmed): a deliberative
// question ("Should I switch to B?") previously matched the same as a real
// directive, silently moving focus in response to the owner merely asking.
test('isExplicitSwitchMessage / isGoBackMessage: a deliberative question is never treated as a genuine directive', () => {
  assert.equal(isExplicitSwitchMessage('Should I switch to TSF?'), false)
  assert.equal(isExplicitSwitchMessage('Could we focus on TSF instead?'), false)
  assert.equal(isGoBackMessage('Should I go back to NWR?'), false)
  // The un-guarded phrasing still works -- this isn't a blanket "?" ban.
  assert.equal(isExplicitSwitchMessage('Switch to TSF.'), true)
})

// REAL DOGFOOD FINDING (post-mission, P0, same bug class already fixed in
// server/command-run-action-bridge.mjs's classifyRunActionVerb): a musing
// STATEMENT never phrased as a question ("Maybe we should switch to X")
// evaded DELIBERATIVE_QUESTION_PATTERN (which requires a trailing "?") and
// silently moved focus exactly like a real directive.
test('isExplicitSwitchMessage / isGoBackMessage: a musing statement (no question mark) is never treated as a genuine directive', () => {
  assert.equal(isExplicitSwitchMessage('Maybe we should switch to NWR'), false)
  assert.equal(isExplicitSwitchMessage('I wonder if we should focus on TSF instead'), false)
  assert.equal(
    isExplicitSwitchMessage('I guess we could talk about the landing page for now'),
    false
  )
  assert.equal(isGoBackMessage('Maybe we should go back to the previous one'), false)
  assert.equal(isGoBackMessage('I wonder if we should go back'), false)
  // The un-guarded phrasings still work.
  assert.equal(isExplicitSwitchMessage('Switch to NWR'), true)
  assert.equal(isGoBackMessage('Go back'), true)
})

// DIRECTIVE SEMANTICS CLOSURE V1, round 2 (real Codex adversarial-review
// finding): the round-1 fix above only caught a musing opener at message
// START -- mid-sentence hedges, named-project (not pronoun) questions,
// contraction/"no need to"/"refuse to" negation, reported speech, and a
// retraction all still moved real Command focus.
test('isExplicitSwitchMessage: mid-sentence hedges, named-subject questions, broader negation, reported speech, and retraction are never treated as a genuine directive', () => {
  for (const m of [
    'We may want to switch to NWR',
    'It seems like we should focus on NWR',
    'My hunch is we should talk about NWR',
    'As for NWR I think we should switch to it',
    "If it were up to me we'd switch to NWR",
    'We should probably discuss NWR',
    'should NWR be the project we focus on',
    'could NWR be what we focus on',
    'would NWR make sense to switch to',
    'do the notes say switch to NWR',
    'has NWR become the project we should focus on',
    "shouldn't we switch to NWR",
    'no need to switch to NWR',
    'I refuse to switch to NWR',
    'Claude suggested we switch to NWR',
    'The report recommends we focus on NWR',
    'The plan calls for us to discuss NWR',
    'The assistant advised me to switch to NWR',
    'Switch to NWR -- cancel that',
    'Switch to NWR -- forget it',
    'Switch to NWR -- disregard that',
    'Switch to NWR -- strike that',
    'Switch to NWR -- I take that back'
  ]) {
    assert.equal(isExplicitSwitchMessage(m), false, m)
  }
  // The real trigger phrasings must still work.
  assert.equal(isExplicitSwitchMessage('Switch to NWR'), true)
  assert.equal(isExplicitSwitchMessage("Let's work on NWR"), true)
})

// DIRECTIVE SEMANTICS CLOSURE V1, round 3 (real Codex adversarial-review
// finding): "can"/"will" were missing from NAMED_SUBJECT_QUESTION_PATTERN's
// modal list.
test('isExplicitSwitchMessage: "can"/"will" named-subject questions are never treated as a genuine directive', () => {
  assert.equal(isExplicitSwitchMessage('Can NWR be the project we focus on'), false)
  assert.equal(isExplicitSwitchMessage('Will NWR be the project we focus on'), false)
  assert.equal(isExplicitSwitchMessage('Switch to NWR'), true)
})

// REAL DOGFOOD FINDING (round 1, P1, Codex-confirmed): an explicit
// prohibition ("Do not talk about B") previously matched the same as a
// real directive, silently moving focus onto the very project the owner
// said NOT to move to.
test('isExplicitSwitchMessage: "discuss" is recognized as an explicit switch synonym -- real dogfood-round-1 finding', () => {
  assert.equal(isExplicitSwitchMessage("Let's discuss TSF now."), true)
})

test('isExplicitSwitchMessage / isGoBackMessage: an explicit prohibition is never treated as a genuine directive', () => {
  assert.equal(isExplicitSwitchMessage('Do not talk about TSF right now.'), false)
  assert.equal(isExplicitSwitchMessage("Don't switch to TSF."), false)
  assert.equal(isGoBackMessage('Never go back to that project.'), false)
})

test('nextCommandFocus: a correction phrasing moves focus given a real single exact target, same as an explicit switch', () => {
  const next = nextCommandFocus(
    { focusProjectId: null, recentProjectStack: [], updatedAt: clock().toISOString() },
    { turnTargetProjectIds: ['voice-alpha'], decisionClass: 'AUTO_DECIDE', isExplicitSwitch: true },
    clock
  )
  assert.equal(next.focusProjectId, 'voice-alpha')
})

test('nextCommandFocus: explicit switch moves focus and pushes the old focus onto the stack ("switch to TSF")', () => {
  const next = nextCommandFocus(
    { focusProjectId: 'nwr', recentProjectStack: [], updatedAt: clock().toISOString() },
    { turnTargetProjectIds: ['tsf'], decisionClass: 'AUTO_DECIDE', isExplicitSwitch: true },
    clock
  )
  assert.equal(next.focusProjectId, 'tsf')
  assert.deepEqual(next.recentProjectStack, ['nwr'])
})

test('nextCommandFocus: AUTO_DECIDE status question naming a project does NOT move focus ("How is NWR doing?" while focus is TSF)', () => {
  const next = nextCommandFocus(
    { focusProjectId: 'tsf', recentProjectStack: ['nwr'], updatedAt: clock().toISOString() },
    { turnTargetProjectIds: ['nwr'], decisionClass: 'AUTO_DECIDE', isExplicitSwitch: false },
    clock
  )
  assert.equal(next.focusProjectId, 'tsf')
  assert.deepEqual(next.recentProjectStack, ['nwr'])
})

test('nextCommandFocus: "go back to NWR" explicitly returns to that project and pushes the old focus', () => {
  const next = nextCommandFocus(
    { focusProjectId: 'tsf', recentProjectStack: ['nwr'], updatedAt: clock().toISOString() },
    { turnTargetProjectIds: ['nwr'], decisionClass: 'AUTO_DECIDE', isGoBack: true },
    clock
  )
  assert.equal(next.focusProjectId, 'nwr')
  assert.deepEqual(next.recentProjectStack, ['tsf'])
})

test('nextCommandFocus: bare "go back" (no target) pops the most recent stack entry and re-pushes the old focus', () => {
  const next = nextCommandFocus(
    {
      focusProjectId: 'tsf',
      recentProjectStack: ['nwr', 'other'],
      updatedAt: clock().toISOString()
    },
    { turnTargetProjectIds: [], decisionClass: 'AUTO_DECIDE', isGoBack: true },
    clock
  )
  assert.equal(next.focusProjectId, 'nwr')
  assert.deepEqual(next.recentProjectStack, ['tsf', 'other'])
})

test('nextCommandFocus: "go back" with an empty stack is an honest no-op, never fabricates a target', () => {
  const before = {
    focusProjectId: 'tsf',
    recentProjectStack: [],
    updatedAt: '2026-09-18T00:00:00.000Z'
  }
  const next = nextCommandFocus(
    before,
    { turnTargetProjectIds: [], decisionClass: 'AUTO_DECIDE', isGoBack: true },
    clock
  )
  assert.equal(next.focusProjectId, 'tsf')
  assert.deepEqual(next.recentProjectStack, [])
})

test('nextCommandFocus: no turn targets at all leaves focus and stack completely unchanged (ordinary continuation)', () => {
  const before = {
    focusProjectId: 'tsf',
    recentProjectStack: ['nwr'],
    updatedAt: '2026-09-18T00:00:00.000Z'
  }
  const next = nextCommandFocus(
    before,
    { turnTargetProjectIds: [], decisionClass: 'RECOMMEND_AND_PROCEED' },
    clock
  )
  assert.equal(next.focusProjectId, 'tsf')
  assert.deepEqual(next.recentProjectStack, ['nwr'])
})

test('nextCommandFocus: multiple exact turn targets never guess a focus switch out of ambiguity', () => {
  const before = {
    focusProjectId: 'tsf',
    recentProjectStack: [],
    updatedAt: '2026-09-18T00:00:00.000Z'
  }
  const next = nextCommandFocus(
    before,
    { turnTargetProjectIds: ['nwr', 'other'], decisionClass: 'RECOMMEND_AND_PROCEED' },
    clock
  )
  assert.equal(next.focusProjectId, 'tsf')
})

test('nextCommandFocus: dispatch-worthy message naming the ALREADY-focused project leaves the stack untouched (no self-push)', () => {
  const before = {
    focusProjectId: 'nwr',
    recentProjectStack: ['other'],
    updatedAt: '2026-09-18T00:00:00.000Z'
  }
  const next = nextCommandFocus(
    before,
    { turnTargetProjectIds: ['nwr'], decisionClass: 'RECOMMEND_AND_PROCEED' },
    clock
  )
  assert.equal(next.focusProjectId, 'nwr')
  assert.deepEqual(next.recentProjectStack, ['other'])
})

test('nextCommandFocus: recentProjectStack never exceeds its cap and never duplicates a project id', () => {
  let focus = { focusProjectId: 'p0', recentProjectStack: [], updatedAt: clock().toISOString() }
  for (let i = 1; i <= RECENT_PROJECT_STACK_CAP + 3; i++) {
    focus = nextCommandFocus(
      focus,
      { turnTargetProjectIds: [`p${i}`], decisionClass: 'AUTO_DECIDE', isExplicitSwitch: true },
      clock
    )
  }
  assert.ok(focus.recentProjectStack.length <= RECENT_PROJECT_STACK_CAP)
  assert.equal(new Set(focus.recentProjectStack).size, focus.recentProjectStack.length)
})

test("the mission's own full worked-example sequence, chained end to end", () => {
  let focus = null

  // "Let's work on Niners War Room." -> focus = NWR
  focus = nextCommandFocus(
    focus,
    { turnTargetProjectIds: ['nwr'], decisionClass: 'AUTO_DECIDE', isExplicitSwitch: true },
    clock
  )
  assert.equal(focus.focusProjectId, 'nwr')

  // "Research waiver mechanics using these formulas..." -> target/focus = NWR (already focused, no-op)
  focus = nextCommandFocus(
    focus,
    { turnTargetProjectIds: ['nwr'], decisionClass: 'RECOMMEND_AND_PROCEED' },
    clock
  )
  assert.equal(focus.focusProjectId, 'nwr')

  // "Okay, switch to Thousand Sunny Fleet." -> focus = TSF
  focus = nextCommandFocus(
    focus,
    { turnTargetProjectIds: ['tsf'], decisionClass: 'AUTO_DECIDE', isExplicitSwitch: true },
    clock
  )
  assert.equal(focus.focusProjectId, 'tsf')
  assert.deepEqual(focus.recentProjectStack, ['nwr'])

  // "How is NWR doing?" -> answer NWR status, but focus remains TSF
  focus = nextCommandFocus(
    focus,
    { turnTargetProjectIds: ['nwr'], decisionClass: 'AUTO_DECIDE' },
    clock
  )
  assert.equal(focus.focusProjectId, 'tsf')

  // "Go back to NWR." -> focus = NWR
  focus = nextCommandFocus(
    focus,
    { turnTargetProjectIds: ['nwr'], decisionClass: 'AUTO_DECIDE', isGoBack: true },
    clock
  )
  assert.equal(focus.focusProjectId, 'nwr')
  assert.deepEqual(focus.recentProjectStack, ['tsf'])
})

test("isExplicitSwitchMessage matches the mission's own example phrasings", () => {
  assert.equal(isExplicitSwitchMessage("Let's work on Niners War Room."), true)
  assert.equal(isExplicitSwitchMessage('Okay, switch to Thousand Sunny Fleet.'), true)
  assert.equal(isExplicitSwitchMessage('Okay, switch over to Thousand Sunny Fleet.'), true)
  assert.equal(isExplicitSwitchMessage('How is NWR doing?'), false)
})

test('isGoBackMessage matches "go back" and "go back to X", nothing else', () => {
  assert.equal(isGoBackMessage('Go back to NWR.'), true)
  assert.equal(isGoBackMessage('go back'), true)
  assert.equal(isGoBackMessage('How is NWR doing?'), false)
})

// DIRECTIVE SEMANTICS CLOSURE V1, round 3 (P0, real Codex adversarial-
// review finding): SUBJECT_INVERSION_QUESTION_OPENER's "could/would/can/
// will YOU" branch had no polite-request carve-out -- "Could you switch
// to NWR, please" was wrongly refused. A genuine information request
// using the same "could you" opener must stay guarded.
test('isExplicitSwitchMessage: a polite "could/can you switch" request moves focus; a "could you tell me whether" information request does not', () => {
  assert.equal(isExplicitSwitchMessage('Could you switch to NWR, please'), true)
  assert.equal(isExplicitSwitchMessage('Can you switch to NWR'), true)
  assert.equal(isExplicitSwitchMessage('Could you tell me whether we should switch to NWR'), false)
})

// DIRECTIVE SEMANTICS CLOSURE V1, P1 closure (real Codex adversarial-
// review finding): "Have NWR become the project we focus on next." is a
// real causative-imperative directive (matches "Have X do Y" -- English's
// own imperative-mood construction, like "Have him call me"), but was
// wrongly refused: NAMED_SUBJECT_QUESTION_PATTERN's "have" modal treated
// it identically to a genuine question. Every subject this pattern sees
// is a project name (always grammatically singular) -- "HAS NWR
// become...?" correctly agrees with a singular subject as a real
// question; "HAVE NWR become..." does NOT (a real subject-verb-agreement
// violation as a question, only valid as an imperative), so "have" alone
// was removed from the modal list. "Make NWR the project we're focused
// on."/"Set TSF as the current project." are two more real causative-
// imperative trigger shapes added to EXPLICIT_SWITCH_PATTERN itself
// (never a bare "make"/"set" keyword -- each requires its own full
// "make X the project/focus"/"set X as the (current) project" shape, so
// unrelated text like "make sure to check NWR" is unaffected).
test('isExplicitSwitchMessage: a causative-imperative direct request moves focus; the same shape as a question/musing/reported/retracted/punctuation-free form does not', () => {
  // DIRECT -- must move focus.
  assert.equal(isExplicitSwitchMessage('Have NWR become the project we focus on next.'), true)
  assert.equal(isExplicitSwitchMessage("Make NWR the project we're focused on."), true)
  assert.equal(isExplicitSwitchMessage('Set TSF as the current project.'), true)
  // QUESTION -- must not.
  assert.equal(isExplicitSwitchMessage('Can NWR become the project we focus on next?'), false)
  assert.equal(isExplicitSwitchMessage('Should NWR become our focus?'), false)
  assert.equal(isExplicitSwitchMessage('Has NWR become the project we focus on next?'), false)
  // MUSING -- must not.
  assert.equal(isExplicitSwitchMessage('I wonder if NWR should become the focus.'), false)
  assert.equal(isExplicitSwitchMessage('Maybe NWR should be the focus.'), false)
  // REPORTED -- must not.
  assert.equal(isExplicitSwitchMessage('Tim said NWR should become the focus.'), false)
  // RETRACTED -- must not.
  assert.equal(isExplicitSwitchMessage('Make NWR the focus -- never mind.'), false)
  // Punctuation-free speech transcript -- direct still fires, question still doesn't.
  assert.equal(isExplicitSwitchMessage('have nwr become the project we focus on next'), true)
  assert.equal(isExplicitSwitchMessage('should nwr become our focus'), false)
  // Unrelated "make"/"set"/"have" phrasings must never false-positive.
  assert.equal(isExplicitSwitchMessage('Make sure to check NWR before you leave.'), false)
  assert.equal(isExplicitSwitchMessage('Set up the NWR environment first.'), false)
  assert.equal(isExplicitSwitchMessage('Have you checked NWR yet?'), false)
})

// DIRECTIVE SEMANTICS CLOSURE V1, P1 closure round 2 (real Codex
// adversarial-review finding): the round-1 attempt at the causative-
// imperative fix above (a) removed "have" outright from
// NAMED_SUBJECT_QUESTION_PATTERN, wrongly assuming every subject is a
// singular project name (a genuinely plural/generic subject like "the
// project leads" makes "have" a real question opener too), and (b) added
// "make X the project/focus"/"set X as the (current) project" as
// UNANCHORED trigger phrases, which then fired mid-sentence inside real
// questions, musings, reported/historical speech, and retractions using
// vocabulary not yet in RETRACTION_MARKER_PATTERN. Restoring "have" (with
// a narrow, message-start positive exception -- no "?" ANYWHERE in the
// message, not just non-trailing, see round 3 below -- for the
// unambiguous "have X become/be THE project/focus" shape) and anchoring
// the two new trigger phrases to the message START closes all of these
// without reopening the original P1.
test('isExplicitSwitchMessage / isGoBackMessage: a "have" question with a plural or generic (non-project-name) subject is never treated as a genuine directive', () => {
  assert.equal(
    isExplicitSwitchMessage('Have the project leads become ready to switch to NWR?'),
    false
  )
  assert.equal(isGoBackMessage('Have the project leads become ready to go back?'), false)
  // P1: a plural-sounding project name in the one genuinely ambiguous
  // shape -- the trailing "?" is the only signal available, and this
  // file's own established discipline treats a literal "?" as real
  // evidence once combined with a structural match.
  assert.equal(isExplicitSwitchMessage('Have API Docs become the project we focus on next?'), false)
  // Combined with the new "make"/"set" triggers embedded mid-sentence.
  assert.equal(
    isExplicitSwitchMessage('Have the project leads become willing to make NWR the focus?'),
    false
  )
  assert.equal(
    isExplicitSwitchMessage(
      'Have the steering committee become ready to set NWR as the current project?'
    ),
    false
  )
})

test('isExplicitSwitchMessage: "make X the focus"/"set X as the project" only fires when it LEADS the message -- a question, musing, reported/historical statement, or retraction using it mid-sentence is never treated as a genuine directive', () => {
  for (const m of [
    'Would Alice make NWR the focus?',
    'Has Alice set NWR as the current project?',
    'One idea is to make NWR the focus.',
    'I can set NWR as the current project.',
    'Alice said to make NWR the focus.',
    'Yesterday, the tool set NWR as the current project.',
    'Make NWR the focus -- wait, no.',
    'Set NWR as the current project -- actually, leave it unchanged.'
  ]) {
    assert.equal(isExplicitSwitchMessage(m), false, m)
  }
  // The real, message-leading trigger phrasings must still work.
  assert.equal(isExplicitSwitchMessage("Make NWR the project we're focused on."), true)
  assert.equal(isExplicitSwitchMessage('Set TSF as the current project.'), true)
})

// Disclosed, not fixed (deliberate scope boundary): a message-start "make
// X the project/focus"/"set X as the project" whose REST of the sentence
// clarifies a DIFFERENT sense of "focus"/"project" entirely (a document's
// own structure, a data-fixture field) still reads as a directive here.
// Distinguishing this from the genuine-directive case would require real
// semantic understanding of what "focus"/"project" refers to, not a
// bounded pattern -- out of scope for this closure, same as the prior
// round's disclosed whole-message-scope residual.
test('isExplicitSwitchMessage: DISCLOSED residual -- a message-leading "make/set" trigger whose rest of sentence is about an unrelated sense of "focus"/"project" still reads as a directive', () => {
  assert.equal(
    isExplicitSwitchMessage('Make NWR the focus of the report, not the Command conversation.'),
    true
  )
  assert.equal(
    isExplicitSwitchMessage('Set NWR as the current project field in the test fixture.'),
    true
  )
})

// DIRECTIVE SEMANTICS CLOSURE V1, P1 closure round 3 (real Codex
// adversarial-review finding): round 2's own "have" exception design was
// itself flawed in two ways this fixes: (1) CAUSATIVE_IMPERATIVE_PATTERN
// was wired ONLY as a guard exception, never as an actual trigger -- "Have
// NWR become the current project." (no separate "focus on" substring to
// coincidentally match EXPLICIT_SWITCH_PATTERN) wrongly stayed refused;
// (2) the "no trailing ?" check only looked at the very last character, so
// a real question ending "?!" or with no punctuation at all slipped past
// it. Checking for "?" ANYWHERE in the message (not just at the end)
// closes the "?!" gap; the fully punctuation-free case remains a
// disclosed, accepted residual -- surface-identical to the genuine
// causative imperative without punctuation, an irreducible ambiguity for
// a bounded pattern, not a bug.
test('isExplicitSwitchMessage: a causative-imperative "have" directive fires even without the coincidental "focus on" substring, and a "?" anywhere in the message (not just at the end) still guards a real question', () => {
  // DIRECT -- the pattern is now a real trigger, not just a guard
  // exception, so these fire even with no separate switch-trigger word.
  assert.equal(isExplicitSwitchMessage('Have NWR become the current project.'), true)
  assert.equal(isExplicitSwitchMessage('Have NWR be the focus.'), true)
  // QUESTION -- "?!" and mid-message "?" are still real question evidence,
  // not just a "?" at the literal last character.
  assert.equal(isExplicitSwitchMessage('Have API Docs become the project we focus on yet?!'), false)
  assert.equal(
    isExplicitSwitchMessage('Have API Docs become the project we focus on before we go back?!'),
    false
  )
  assert.equal(
    isGoBackMessage('Have API Docs become the project we focus on before we go back?!'),
    false
  )
})

// Disclosed, not fixed: without ANY punctuation, a "have"-led question
// about a plural/generic-sounding subject and the genuine causative
// imperative are surface-identical -- no bounded pattern can tell them
// apart from word order alone. Same P1-severity ambiguity the first
// closure round found, now precisely scoped instead of papered over by a
// fragile end-of-string check.
test('isExplicitSwitchMessage: DISCLOSED residual -- a fully punctuation-free "have" question about a plural/generic-sounding subject is indistinguishable from a causative imperative', () => {
  assert.equal(isExplicitSwitchMessage('Have API Docs become the project we focus on yet'), true)
})

// DIRECTIVE SEMANTICS CLOSURE V1, P1 closure round 3 (real Codex
// adversarial-review finding): CAUSATIVE_TRIGGER_PATTERN's literal
// message-start anchor was too rigid -- "Please make NWR the focus.",
// "Okay, make NWR the focus." both wrongly failed to match. A bounded,
// optional polite/filler lead-in closes this without reopening any of
// round 2's fixed false positives (a QUESTION/MUSING opener like "Would
// Alice..."/"One idea is to..." still isn't one of these specific
// lead-ins).
test('isExplicitSwitchMessage: a bounded polite/filler lead-in ("please", "okay,") before "make X the focus"/"set X as the project" still moves focus', () => {
  assert.equal(isExplicitSwitchMessage('Please make NWR the focus.'), true)
  assert.equal(isExplicitSwitchMessage('Please set NWR as the current project.'), true)
  assert.equal(isExplicitSwitchMessage('Okay, make NWR the focus.'), true)
  // A genuine question/musing opener is still never treated as a lead-in.
  assert.equal(isExplicitSwitchMessage('Would Alice make NWR the focus?'), false)
  assert.equal(isExplicitSwitchMessage('One idea is to make NWR the focus.'), false)
})

// Disclosed, not fixed: DELIBERATIVE_QUESTION_PATTERN has no polite-
// request carve-out at all (unlike SUBJECT_INVERSION_QUESTION_OPENER,
// which POLITE_SWITCH_REQUEST_PATTERN already excepts) -- a PRE-EXISTING
// gap that identically affects the original "switch" trigger, not
// something this closure introduced or is scoped to fix.
test('isExplicitSwitchMessage: DISCLOSED residual (pre-existing, not caused by this closure) -- a polite "could you <verb> X?" WITH a literal "?" is guarded as a deliberative question for every trigger verb, old and new alike', () => {
  assert.equal(isExplicitSwitchMessage('Could you make NWR the focus?'), false)
  assert.equal(isExplicitSwitchMessage('Could you switch to NWR?'), false)
})

// DIRECTIVE SEMANTICS CLOSURE V1, P1 closure round 3 (real Codex
// adversarial-review finding): the round-2 "wait, no" retraction addition
// overmatched -- a bare `\b` after "no" is satisfied just as well by a
// following "longer"/"more" as by a sentence end, so "Please wait no
// longer." and "We can wait no more." (ordinary, non-retraction
// sentences) both wrongly read as retractions, suppressing real actions
// (PAUSE, a paid-research grant) across every consumer of the shared
// RETRACTION_MARKER_PATTERN. A negative lookahead excludes exactly the
// two continuations that turn "wait no" into an ordinary "don't keep
// waiting" statement. "actually, no" is also added as one more real
// retraction phrasing (same category as "wait, no").
test('isExplicitSwitchMessage: "wait no longer"/"wait no more" are never treated as a retraction, but "wait, no"/"actually, no" still are', () => {
  assert.equal(isExplicitSwitchMessage('Please wait no longer, switch to NWR.'), true)
  assert.equal(isExplicitSwitchMessage('Switch to NWR -- wait, no.'), false)
  assert.equal(isExplicitSwitchMessage('Set NWR as the current project -- actually, no.'), false)
  assert.equal(isExplicitSwitchMessage('Make NWR the focus. Actually, no.'), false)
})

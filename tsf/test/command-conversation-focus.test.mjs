import assert from 'node:assert/strict'
import test from 'node:test'
import {
  nextCommandFocus,
  isExplicitSwitchMessage,
  isGoBackMessage,
  correctedSwitchTarget,
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

// DIRECTIVE SEMANTICS CLOSURE V1, P1 closure round 6 (real Codex
// adversarial-review finding): previously disclosed as an accepted,
// unfixable residual -- a message-start "make X the project/focus"/"set
// X as the project" whose REST of the sentence clarifies a DIFFERENT
// sense of "focus"/"project" entirely. Round 6's structural fix
// (requiring "the project/focus" to actually end the message, or be
// immediately followed only by a bounded "we're focused on"/"we focus on
// next" completion) resolves this as a welcome side effect: "of the
// report, not the Command conversation"/"field in the test fixture" are
// neither the message end nor one of the bounded completions, so these
// now correctly do NOT move focus.
test('isExplicitSwitchMessage: a message-leading "make/set" trigger whose rest of sentence is about an unrelated sense of "focus"/"project" is correctly NOT treated as a directive', () => {
  assert.equal(
    isExplicitSwitchMessage('Make NWR the focus of the report, not the Command conversation.'),
    false
  )
  assert.equal(
    isExplicitSwitchMessage('Set NWR as the current project field in the test fixture.'),
    false
  )
  // The genuine directive shape (message ends at "the project/focus", or
  // continues only with the bounded "we're focused on" completion) is
  // completely unaffected.
  assert.equal(isExplicitSwitchMessage("Make NWR the project we're focused on."), true)
  assert.equal(isExplicitSwitchMessage('Set TSF as the current project.'), true)
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

// DIRECTIVE SEMANTICS CLOSURE V1, P1 closure round 6 (real Codex
// adversarial-review finding): previously disclosed as an accepted
// residual -- without ANY punctuation, a "have"-led question about a
// plural/generic-sounding subject and the genuine causative imperative
// are surface-identical, so this used to default to `true` (a directive).
// Round 6's structural completion requirement changes the default: "we
// focus on YET" isn't one of the bounded completions ("we're focused
// on"/"we focus on next"), so this now correctly defaults to `false` --
// the safer direction per this codebase's own stated false-negative-over-
// false-positive bias, resolving the ambiguity safely instead of merely
// disclosing it.
test('isExplicitSwitchMessage: a fully punctuation-free "have" question about a plural/generic-sounding subject safely defaults to NOT a directive', () => {
  assert.equal(isExplicitSwitchMessage('Have API Docs become the project we focus on yet'), false)
  // The genuine punctuation-free DIRECT form (round-1 required example)
  // is completely unaffected -- "next", not "yet", is one of the bounded
  // completions.
  assert.equal(isExplicitSwitchMessage('have nwr become the project we focus on next'), true)
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

// DIRECTIVE SEMANTICS CLOSURE V1, P1 closure round 4 (real Codex
// adversarial-review finding): round 3's subject-capture span (`\S+`)
// matched ANY non-whitespace run, including a word ending in punctuation
// like "NWR;" -- letting the pattern cross a real clause boundary and
// read "Please make sure to check NWR; the project is stable." as "make
// [sure to check NWR;] the project", a false positive neither the
// original unanchored trigger nor any prior round exercised. Restricting
// each subject word to real word characters (no embedded clause-ending
// punctuation) stops the span at the semicolon the same way a real
// project name never would.
test('isExplicitSwitchMessage: the subject span between "make"/"set"/"have" and "the project/focus" never crosses a real clause boundary', () => {
  assert.equal(
    isExplicitSwitchMessage('Please make sure to check NWR; the project is stable.'),
    false
  )
  // The real trigger phrasings, including multi-word project names, are
  // completely unaffected.
  assert.equal(isExplicitSwitchMessage('Please make NWR the focus.'), true)
  assert.equal(isExplicitSwitchMessage("Make NWR the project we're focused on."), true)
})

// DIRECTIVE SEMANTICS CLOSURE V1, P1 closure round 4 (real Codex
// adversarial-review finding): round 3 added bare "make"/"set" to
// POLITE_SWITCH_REQUEST_PATTERN's verb list to except "Could you make NWR
// the focus?" from the SUBJECT_INVERSION_QUESTION_OPENER guard -- but
// unlike switch/focus/work/talk/discuss, "make"/"set" are common general-
// purpose verbs, so the bare-verb match excepted the guard for ANY
// "could/can/would/will you make/set ...", not just the genuine causative
// trigger shape: "Could you set a reminder to focus on NWR tomorrow" and
// "Will you make sure we go back after lunch" both wrongly moved
// focus/went back. Reverted; the guard is now excepted via
// CAUSATIVE_TRIGGER_PATTERN itself (which already requires the FULL
// "make X the project/focus"/"set X as the project" shape), so an
// unrelated "make sure .../set a reminder ..." can never wrongly except
// the guard.
test('isExplicitSwitchMessage / isGoBackMessage: a polite "could/would/will you make/set ..." request only bypasses the question guard for the genuine causative-switch shape, never an unrelated use of "make"/"set"', () => {
  assert.equal(isExplicitSwitchMessage('Could you set a reminder to focus on NWR tomorrow'), false)
  assert.equal(isGoBackMessage('Will you make sure we go back after lunch'), false)
})

// DIRECTIVE SEMANTICS CLOSURE V1, P1 closure round 6 (real Codex
// adversarial-review finding): previously disclosed as an accepted
// residual, same category as the make/set one above -- "Have NWR be the
// focus of the quarterly report." leads with the causative-imperative
// trigger shape, but the REST of the sentence names a different sense of
// "focus" (the report's own, not Command's). Round 6's structural
// completion requirement resolves this the same way: "of the quarterly
// report" isn't the message end or a bounded completion, so this now
// correctly does NOT move focus.
test('isExplicitSwitchMessage: "have" leading the message with an unrelated sense of "focus"/"project" later in the sentence is correctly NOT treated as a directive', () => {
  assert.equal(isExplicitSwitchMessage('Have NWR be the focus of the quarterly report.'), false)
  // The genuine directive shape is completely unaffected.
  assert.equal(isExplicitSwitchMessage('Have NWR be the focus.'), true)
})

// DIRECTIVE SEMANTICS CLOSURE V1, P1 closure round 4 (real Codex
// adversarial-review finding): round 3's negative-lookahead blocklist
// approach for "wait, no"/"actually, no" could never be complete -- there
// is an unbounded set of words that can follow "no" without it being a
// retraction ("further", "one", "problem", ...), and the lookahead was
// also only ever applied to "wait, no", never to "actually, no" (so
// "Actually, no more waiting" still wrongly retracted). Replaced with a
// structural rule instead of a word list: a genuine retraction is
// followed by a pause (punctuation or the end of the message), while a
// continuing clause is followed directly by more words after just a
// space -- applied identically to both phrasings.
test('isExplicitSwitchMessage / isGoBackMessage: "wait no further"/"wait, no one..."/"actually, no more..." are never treated as a retraction -- the real action after them still executes', () => {
  assert.equal(isExplicitSwitchMessage('Wait no further; switch to NWR now.'), true)
  assert.equal(isGoBackMessage('Wait no further; go back to NWR now.'), true)
  assert.equal(isExplicitSwitchMessage('Wait, no one else is coming—switch to NWR now.'), true)
  assert.equal(isExplicitSwitchMessage('Actually, no more waiting—switch to NWR now.'), true)
  // The real retraction phrasings (followed by a pause or the end of the
  // message) are still recognized.
  assert.equal(isExplicitSwitchMessage('Switch to NWR -- wait, no.'), false)
  assert.equal(isExplicitSwitchMessage('Switch to NWR -- wait, no'), false)
  assert.equal(isExplicitSwitchMessage('Set NWR as the current project -- actually, no.'), false)
})

// DIRECTIVE SEMANTICS CLOSURE V1, P1 closure round 5 (real Codex
// adversarial-review finding): round 4's punctuation-immediately-after-
// "no" rule was too strict -- "Wait, no -- reconsider." (a SPACE before
// the dash, the conventional way to type this) and "Switch to NWR (wait,
// no)" (a closing paren) both wrongly failed to match as retractions. Two
// separate rules for two separate typing conventions fix this: with a
// space before it, any punctuation (including a single "-") is a real
// pause; with no space, a single "-" stays excluded (ambiguous with a
// hyphenated word like "no-one") but a double-dash, em dash, or ellipsis
// is not.
test('isExplicitSwitchMessage / isGoBackMessage: a retraction with a SPACE before its closing punctuation, or a parenthetical/ellipsis form, is still recognized', () => {
  assert.equal(
    isExplicitSwitchMessage('Switch to NWR -- wait, no -- actually let us stay on TSF.'),
    false
  )
  assert.equal(isGoBackMessage('Go back -- wait, no -- keep the current focus.'), false)
  assert.equal(isExplicitSwitchMessage('Switch to NWR (wait, no)'), false)
})

// DIRECTIVE SEMANTICS CLOSURE V1, P1 closure round 5 (real Codex
// adversarial-review finding): a hyphenated continuation word directly
// after "no" with no space ("no-one", "no-good") must NOT be read as a
// retraction -- the single "-" there is a hyphenated compound word, not a
// pause, and the real action after it must still execute.
test('isExplicitSwitchMessage: "no-one"/similar hyphenated continuations right after "wait"/"actually, no" are never treated as a retraction', () => {
  assert.equal(isExplicitSwitchMessage('Wait no-one else is coming; switch to NWR now.'), true)
  assert.equal(isExplicitSwitchMessage('Actually, no-one objected; switch to NWR now.'), true)
})

// DIRECTIVE SEMANTICS CLOSURE V1, P1 closure round 5 (real Codex
// adversarial-review finding): round 4's subject-span word-class fix
// (`[A-Za-z0-9'-]+`) stopped the span from crossing a semicolon, but a
// real Codex review found it was nowhere near enough -- a bare "--"
// still counts as one "word" (both chars are in the allowed class), a
// newline is ordinary whitespace, and the extremely common "make
// sure ..."/"make absolutely sure ..." idiom can still consume 2-3
// filler words before coincidentally reaching an unrelated later "the
// project"/"the focus": "Could you make sure to archive the project
// notes for NWR", "Will you make sure NWR keeps the focus on quality",
// "Please make sure to check NWR\nThe project is stable.", "Please make
// sure to check NWR-- the project is stable.", "Please make absolutely
// sure -- the project is stable." all wrongly fired. Chasing each
// specific punctuation/idiom shape individually was never going to
// converge -- the real, structural fix is shrinking the subject span
// itself: neither required DIRECT example, nor any existing test, needs
// more than a 2-word project name with this specific "make X the.../set
// X as..." trigger shape, and 2 words is never enough room for a "make
// sure to archive ..." idiom (always 3+ filler words) to reach a
// coincidental "the project/focus" at all.
test('isExplicitSwitchMessage / isGoBackMessage: the common "make/be sure ..." idiom, a clause-crossing dash/newline, and any other 3+-word filler span between "make"/"set" and "the project/focus" never fires', () => {
  for (const m of [
    'Could you make sure to archive the project notes for NWR',
    'Will you make sure NWR keeps the focus on quality',
    'Please make sure to check NWR\nThe project is stable.',
    'Please make sure to check NWR-- the project is stable.',
    'Please make absolutely sure -- the project is stable.'
  ]) {
    assert.equal(isExplicitSwitchMessage(m), false, m)
  }
  // A genuine 1-2-word project name is completely unaffected.
  assert.equal(isExplicitSwitchMessage("Make NWR the project we're focused on."), true)
  assert.equal(isExplicitSwitchMessage('Have API Docs become the project we focus on next.'), true)
})

// DIRECTIVE SEMANTICS CLOSURE V1, P1 closure round 5 (real Codex
// adversarial-review finding): the subject-word class was ASCII-only
// (`[A-Za-z0-9'-]`), but a real project's display name is an arbitrary
// folder basename with no ASCII restriction (server/onboarding.mjs) --
// "Make Café the focus.", "Make O'Brien the project." (curly apostrophe),
// and "Make TSF_ORCA the focus." (underscore) all wrongly failed to
// match a real, unambiguous directive. Now Unicode-aware (`\p{L}`/`\p{N}`
// plus "_" and both straight/curly apostrophes).
test('isExplicitSwitchMessage: a project name with a non-ASCII letter, a curly apostrophe, or an underscore is recognized the same as any other name', () => {
  assert.equal(isExplicitSwitchMessage('Make Café the focus.'), true)
  assert.equal(isExplicitSwitchMessage("Make O'Brien the project."), true)
  assert.equal(isExplicitSwitchMessage('Make O’Brien the project.'), true)
  assert.equal(isExplicitSwitchMessage('Make TSF_ORCA the focus.'), true)
})

// DIRECTIVE SEMANTICS CLOSURE V1, P1 closure round 6 (real Codex
// adversarial-review finding): round 5's word-count cap still wasn't
// enough -- even a SINGLE filler word ("sure") sits directly before "the
// project" in ordinary English ("make sure the project notes..."), so no
// word count can ever exclude it; "absolutely sure" is exactly 2 words;
// "set NWR aside" captures "aside" as the 2nd subject word before "as the
// project" continues an unrelated later clause. Chasing individual
// filler words was never going to converge. The real, convergent fix
// constrains the OTHER side: requiring the message to actually END at
// (or just after) "the project/focus", not merely pass through it on the
// way to an unrelated later clause.
test('isExplicitSwitchMessage: the common "make/be sure"/"set X aside" idioms -- where a SINGLE filler word already sits directly before "the project/focus" -- never fire, because the message continues with unrelated content afterward', () => {
  for (const m of [
    'Make absolutely sure the project notes for NWR are archived.',
    'Could you make sure the project notes for NWR are archived.',
    'Set NWR aside as the project continues.',
    'Make absolutely sure the project notes for NWR are archived -- wait, no – ignore that.'
  ]) {
    assert.equal(isExplicitSwitchMessage(m), false, m)
  }
})

// DIRECTIVE SEMANTICS CLOSURE V1, P1 closure round 6 (real Codex
// adversarial-review finding): a bare "--" still counted as one "word" of
// the subject span (both chars are in the allowed class), letting the
// trigger reach an unrelated "the project" via a 1-word "notes--" span.
// The round-6 trailing-completion requirement closes this as a side
// effect, without needing yet another character-class carve-out.
test('isExplicitSwitchMessage: a subject word ending in an attached double-dash still cannot bridge to an unrelated later clause', () => {
  assert.equal(isExplicitSwitchMessage('Make notes-- the project NWR needs them.'), false)
})

// DIRECTIVE SEMANTICS CLOSURE V1, P1 closure round 6 (real Codex
// adversarial-review finding): the Unicode word class omitted combining
// marks (Unicode category Mn) -- a name typed with a decomposed accent
// ("e" + a separate combining acute accent, rather than the single
// precomposed "é" character) or written in a script that uses combining
// marks for consonant clusters (Tamil) both wrongly failed to match. Also
// fixed: a project name that itself STARTS with a hyphen (an unusual but
// real folder basename per server/onboarding.mjs) -- "-NWR" -- now
// matches too, via a bounded exception that still requires an
// alphanumeric character to immediately follow the leading hyphen (so a
// bare "-"/"--" still can never count as a word on its own).
test('isExplicitSwitchMessage: a project name using combining-mark accents, a non-Latin script, or a leading hyphen is recognized the same as any other name', () => {
  assert.equal(isExplicitSwitchMessage('Make Café the focus.'), true)
  assert.equal(isExplicitSwitchMessage('Make தமிழ் the focus.'), true)
  assert.equal(isExplicitSwitchMessage('Make -NWR the focus.'), true)
})

// DIRECTIVE SEMANTICS CLOSURE V1, P1 closure round 6 (real Codex
// adversarial-review finding): round 5's retraction punctuation set was
// an incomplete allowlist -- an en dash ("–", U+2013, distinct from the
// em dash "—" already covered) was missing, so a spaced en-dash
// retraction still wrongly failed to retract. (The opening-parenthesis
// case this round also added was later reverted -- see round 8's test
// below.)
test('isExplicitSwitchMessage / isGoBackMessage: an en-dash-separated retraction is still recognized', () => {
  assert.equal(isExplicitSwitchMessage('Switch to NWR -- wait, no – keep TSF.'), false)
  assert.equal(isGoBackMessage('Go back -- actually, no – stay here.'), false)
})

// DIRECTIVE SEMANTICS CLOSURE V1, P1 closure round 7 (real Codex
// adversarial-review finding): round 6's `we'?re` in the trailing-
// completion pattern only permitted the ASCII apostrophe, not the curly
// one (U+2019) this file already accepts everywhere else -- "Make NWR
// the project we're focused on." (typed with a curly apostrophe, as most
// real keyboards/autocorrect produce) wrongly failed to match a
// realistic variant of the required DIRECT example.
test('isExplicitSwitchMessage: the "we\'re focused on"/"we\'re focusing on" trailing completion works with a curly apostrophe too', () => {
  assert.equal(isExplicitSwitchMessage('Make NWR the project we’re focused on.'), true)
  assert.equal(
    isExplicitSwitchMessage('Have API Docs become the project we’re focusing on next.'),
    true
  )
})

// DIRECTIVE SEMANTICS CLOSURE V1, P1 closure round 7 (now superseded, see
// round 8 below): round 6's unconditional unspaced en dash reopened the
// exact "no-one"-style hyphenated-compound-word collision the ASCII-
// hyphen exclusion was designed to prevent, just spelled with an en dash
// instead ("Wait, no–one objected..."). The unspaced en dash was
// removed; a spaced en dash (nobody hyphenates a compound word with a
// space before it) remains a real pause.
//
// Round 7 also tried an end-anchored fix for round 6's unconditional
// opening-paren addition. Round 8 (below) found that fix itself unsafe
// and removed "(" from this pattern entirely -- see that test.
test('isExplicitSwitchMessage / isGoBackMessage: an unspaced en-dash-hyphenated word right after "no" is never mistaken for a retraction', () => {
  assert.equal(isExplicitSwitchMessage('Wait, no–one objected; switch to NWR.'), true)
})

// DIRECTIVE SEMANTICS CLOSURE V1, P1 closure round 8 (real Codex
// adversarial-review finding): round 7's end-anchored "no (ASIDE)"
// parenthetical rule was unsafe in BOTH directions at once -- too loose
// (trailing content after the parenthetical, or a nested parenthetical,
// both still wrongly retracted: "wait, no (keep it here), thanks."
// executed the retracted command anyway) AND too tight in the wrong way
// (an ordinary, unrelated sentence with a negative answer and an aside
// near the message end -- "Switch to NWR. The answer is actually no
// (per policy)." -- wrongly retracted the EARLIER real instruction,
// since a parenthetical aside anywhere near the end is structurally
// indistinguishable from a genuine parenthetical retraction). This is
// the same unconvergent-chase pattern already abandoned for the "make
// sure" idiom collision in command-conversation-focus.mjs -- English
// uses "(...)" for far too many unrelated purposes near "no" to ever
// safely recognize it as a retraction shape. "(" is removed entirely; a
// genuine "no (SHORT ASIDE)" retraction (never one of the mission's own
// required examples) is now a disclosed, accepted false negative -- the
// safe direction this codebase's guards are already biased toward.
test('isExplicitSwitchMessage / isGoBackMessage: a parenthetical near "no" never triggers a retraction, in either direction -- an ordinary sentence with a parenthetical aside is never wrongly retracted, and trailing content or nesting after a parenthetical never lets a real retraction wrongly execute', () => {
  // Previously wrongly retracted an UNRELATED earlier instruction.
  assert.equal(
    isExplicitSwitchMessage('Switch to NWR. The answer is actually no (per policy).'),
    true
  )
  assert.equal(isGoBackMessage('Go back. The answer is actually no (per policy).'), true)
  // Previously wrongly let a real retraction's OWN instruction execute
  // anyway (trailing content, nesting).
  assert.equal(isExplicitSwitchMessage('Switch to NWR -- wait, no (keep it here), thanks.'), true)
  assert.equal(isGoBackMessage('Go back -- wait, no (stay here), thanks.'), true)
  assert.equal(isExplicitSwitchMessage('Switch to NWR -- wait, no (reconsider (seriously)).'), true)
  // Disclosed residual: a parenthetical retraction with nothing after it
  // no longer retracts either (the accepted, safe false-negative trade).
  assert.equal(isExplicitSwitchMessage('Switch to NWR -- wait, no (reconsider).'), true)
})

// Disclosed, not fixed (confirmed pre-existing, not caused by any P1-
// closure round): EXPLICIT_SWITCH_PATTERN's own long-standing "focus on"
// trigger substring is unanchored and has never had a trailing-content
// restriction -- a message using ONLY the ORIGINAL, untouched "switch
// to"/"talk about" triggers has this identical exposure ("Switch to NWR
// because we focus on next week, not now." also wrongly reads as a
// directive), so this is not something introduced by, or in scope for,
// this file's causative-imperative work.
test('isExplicitSwitchMessage: DISCLOSED residual (pre-existing, not caused by this closure) -- a trailing "not now"/"not X" qualifier after a "focus on" substring is never guarded, for the original trigger set or the new one alike', () => {
  assert.equal(
    isExplicitSwitchMessage('Make NWR the project we focus on next week, not now.'),
    true
  )
  assert.equal(
    isExplicitSwitchMessage('Switch to NWR because we focus on next week, not now.'),
    true
  )
})

// TSF OWNER DOGFOOD / CRITIQUE LOOP V1 (real dogfood finding, disposable-
// state rant scenario): "actually" -- an extremely common, natural way to
// lead into a spoken self-correction/afterthought directive -- was
// missing from CAUSATIVE_TRIGGER_PATTERN's bounded lead-in list, so
// "actually make NWR the focus" failed to match the trigger at ALL, not
// just the guard. CAUSATIVE_IMPERATIVE_PATTERN ("have X become/be the
// project/focus") never had lead-in support at all -- "Please have NWR
// become the current project." had this exact gap too. Both now share
// the same bounded lead-in list.
test('isExplicitSwitchMessage: "actually" is a recognized lead-in filler before "make X the.../set X as.../have X become..." the same way "please"/"okay" already are', () => {
  assert.equal(isExplicitSwitchMessage('actually make NWR the focus'), true)
  assert.equal(isExplicitSwitchMessage('actually set TSF as the current project'), true)
  assert.equal(isExplicitSwitchMessage('actually have NWR become the current project'), true)
  assert.equal(isExplicitSwitchMessage('Please have NWR become the current project.'), true)
  // "Actually, could you make NWR the focus?" hits the same pre-existing,
  // already-disclosed DELIBERATIVE_QUESTION_PATTERN gap (no polite carve-
  // out at all, applies identically to every trigger verb old and new) --
  // not something this lead-in addition caused or is in scope to fix.
  assert.equal(isExplicitSwitchMessage('Actually, could you make NWR the focus?'), false)
  // A genuine musing/question still isn't fooled by the wider lead-in.
  assert.equal(isExplicitSwitchMessage('Actually, I wonder if NWR should become the focus.'), false)
})

// TSF OWNER DOGFOOD / CRITIQUE LOOP V1 (real dogfood finding, disposable-
// state rant scenario): "switch to Alpha -- no wait, I meant Beta" is one
// of the most natural real spoken self-corrections there is. "no wait"
// is ALSO a real retraction marker, and the message-wide
// RETRACTION_MARKER_PATTERN guard ran first and unconditionally,
// silently defeating the dedicated "I meant X" correction mechanism this
// file already has for exactly this shape. "I meant X" is a POSITIVE
// completion of intent, not an abandonment.
test('isExplicitSwitchMessage: "no wait, I meant X" is a genuine self-correction, never fully suppressed by the retraction guard', () => {
  assert.equal(isExplicitSwitchMessage('switch to NWR -- no wait, I meant TSF'), true)
  // A genuine full retraction with no correction still retracts.
  assert.equal(isExplicitSwitchMessage('switch to NWR -- no wait, never mind'), false)
})

// TSF OWNER DOGFOOD / CRITIQUE LOOP V1 (real dogfood finding): naming
// BOTH the wrong and the corrected project in one message produces two
// exact turn-target matches, which the caller's own "never guess a
// switch out of ambiguity" rule (correctly!) refuses to pick between on
// its own -- correctedSwitchTarget narrows that to the one project
// actually named after "I meant", and ONLY when that's unambiguous.
test('correctedSwitchTarget: narrows a multi-exact-match list to the project named after "I meant", and only when unambiguous', () => {
  const alpha = { project: { id: 'alpha' }, matchedPhrase: 'Alpha', matchedOn: 'displayName' }
  const beta = { project: { id: 'beta' }, matchedPhrase: 'Beta', matchedOn: 'displayName' }

  assert.equal(
    correctedSwitchTarget('switch to Alpha -- no wait, I meant Beta', [alpha, beta]),
    'beta'
  )
  // No "I meant" present at all -- never guesses.
  assert.equal(correctedSwitchTarget('talk about Alpha and Beta', [alpha, beta]), null)
  // "I meant" naming the one exact match already found -- safe to
  // confirm (not invent); the real caller only reaches this helper with
  // 0 or 2+ exact matches in practice (a single match short-circuits
  // earlier), but the helper itself has no reason to refuse this case.
  assert.equal(correctedSwitchTarget('I meant Alpha', [alpha]), 'alpha')
  // Neither matched phrase actually appears after "I meant" -- genuinely
  // inconclusive, must not guess.
  assert.equal(
    correctedSwitchTarget('Alpha and Beta are both relevant here, I meant to say that', [
      alpha,
      beta
    ]),
    null
  )
})

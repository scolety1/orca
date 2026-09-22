// Sibling to test/command-conversation-focus.test.mjs -- new, small file
// rather than growing that one further (it's already at this repo's
// generic .mjs line budget; .test.mjs gets no exemption, a disclosed
// pre-existing gap in .oxlintrc.json). Covers TSF OWNER DOGFOOD /
// CRITIQUE LOOP V1 round 4's real Codex adversarial-review findings
// against the "I meant X" self-correction feature in
// domain/command-conversation-focus.mjs.
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  correctedTurnTargetIds,
  correctedSwitchTarget,
  verifiedCorrectionTarget,
  isExplicitSwitchMessage
} from '../domain/command-conversation-focus.mjs'

// TSF OWNER DOGFOOD / CRITIQUE LOOP V1 round 4 (real Codex adversarial-
// review finding, the most serious of the round): round 3's `.corrected`
// override (server/command-turn-target-correction.mjs) ORed
// correctedSwitchTarget's own result directly over isExplicitSwitchMessage
// -- which bypassed EVERY guard, not just retraction. "I said I meant
// Beta." is REPORTED SPEECH, not a directive; "Did I say switch to Alpha
// -- no wait, I meant Beta?" is a genuine QUESTION. verifiedCorrectionTarget
// is the one place either consumer's correction can come from now, and it
// refuses whenever any OTHER guard (question/reported-speech/negation/
// hedge) fires -- a verified correction only ever excepts the ONE guard
// (retraction) it exists to except.
test('verifiedCorrectionTarget: never resolves when the message is guarded by anything OTHER than retraction (reported speech, a genuine question, etc.)', () => {
  const home = { project: { id: 'home' }, matchedPhrase: 'Home', matchedOn: 'displayName' }
  const beta = { project: { id: 'beta' }, matchedPhrase: 'Beta', matchedOn: 'displayName' }
  assert.equal(verifiedCorrectionTarget('I said I meant Beta.', [home, beta]), null)
  assert.equal(
    verifiedCorrectionTarget('Did I say switch to Alpha -- no wait, I meant Beta?', [home, beta]),
    null
  )
  // The genuine, unguarded correction shape still resolves.
  assert.equal(
    verifiedCorrectionTarget('switch to Alpha -- no wait, I meant Beta', [home, beta]),
    'beta'
  )
})

// TSF OWNER DOGFOOD / CRITIQUE LOOP V1 round 4 (real Codex adversarial-
// review finding): the "or/and <second candidate>" ambiguity check
// required the second candidate IMMEDIATELY after "or"/"and" with zero
// words in between, so a small, natural amount of filler ("the ...
// project", "maybe", "also") silently dropped the second candidate and
// wrongly resolved to the first alone. Up to 2 filler words are now
// allowed between the conjunction and the second real candidate name --
// without reopening round 2's own "unrelated later mention" fix, which
// needs 3+ intervening words and stays correctly excluded.
test('correctedSwitchTarget: "or"/"and" ambiguity detection tolerates a small amount of filler before the second real candidate', () => {
  const alpha = { project: { id: 'alpha' }, matchedPhrase: 'Alpha', matchedOn: 'displayName' }
  const beta = { project: { id: 'beta' }, matchedPhrase: 'Beta', matchedOn: 'displayName' }
  const gamma = { project: { id: 'gamma' }, matchedPhrase: 'Gamma', matchedOn: 'displayName' }
  assert.equal(
    correctedSwitchTarget('switch to Alpha -- no wait, I meant Beta or the Gamma project', [
      alpha,
      beta,
      gamma
    ]),
    null
  )
  assert.equal(correctedSwitchTarget('I meant Beta or maybe Gamma', [alpha, beta, gamma]), null)
  assert.equal(correctedSwitchTarget('I meant Beta and also Gamma', [alpha, beta, gamma]), null)
  // Round 2's own fix (an unrelated LATER mention, 3+ words away) must
  // still not be reopened.
  assert.equal(
    correctedSwitchTarget('switch to Alpha -- no wait, I meant Beta, and compare it with Gamma', [
      alpha,
      beta,
      gamma
    ]),
    'beta'
  )
})

// TSF OWNER DOGFOOD / CRITIQUE LOOP V1 round 4 (real Codex adversarial-
// review finding): the disfluency strip had no word boundary after
// "well"/"uh"/"um", so it chopped the front off an unrelated real name --
// "I meant Wellness" lost "Well" and failed to match "wellness" at all (a
// real false negative), while "I meant Wellspring" (only "Spring" a real
// candidate) lost "Well" and wrongly matched "Spring" (an unsafe false
// positive). "well"/"uh"/"um" are now only stripped as a whole word.
test('correctedSwitchTarget: "well"/"uh"/"um" are only stripped as whole-word disfluencies, never as a prefix of a real name', () => {
  const spring = { project: { id: 'spring' }, matchedPhrase: 'Spring', matchedOn: 'displayName' }
  const wellness = {
    project: { id: 'wellness' },
    matchedPhrase: 'Wellness',
    matchedOn: 'displayName'
  }
  assert.equal(
    correctedSwitchTarget('switch to Spring -- no wait, I meant Wellness', [spring, wellness]),
    'wellness'
  )
  assert.equal(
    correctedSwitchTarget('switch to Spring -- no wait, I meant Wellspring', [spring]),
    null
  )
})

// TSF OWNER DOGFOOD / CRITIQUE LOOP V1 round 4 (real Codex adversarial-
// review finding): the match boundary excluded only letters/digits/
// underscore, not the hyphen/apostrophe/combining-mark characters this
// file's own CAUSATIVE_SUBJECT_WORD already treats as name-continuing --
// "I meant Alpha-Two" (only "Alpha" a real candidate) wrongly matched
// "Alpha" as if it were the WHOLE name, ignoring the "-Two" that makes it
// a different, unresolved name.
test('correctedSwitchTarget: a partial compound name never matches a shorter real candidate it merely starts with', () => {
  const alpha = { project: { id: 'alpha' }, matchedPhrase: 'Alpha', matchedOn: 'displayName' }
  const alphaTwo = {
    project: { id: 'alpha-two' },
    matchedPhrase: 'Alpha-Two',
    matchedOn: 'displayName'
  }
  assert.equal(
    correctedSwitchTarget('switch to Alpha -- no wait, I meant Alpha-Two', [alpha]),
    null
  )
  assert.equal(
    correctedSwitchTarget('switch to Alpha -- no wait, I meant Alpha-Two', [alpha, alphaTwo]),
    'alpha-two'
  )
})

// TSF OWNER DOGFOOD / CRITIQUE LOOP V1 round 4 (real Codex adversarial-
// review finding): two real projects can share the exact same display
// name (no uniqueness invariant enforces otherwise) -- resolving to
// whichever one happened to sort first was an arbitrary, silent guess
// between two real, different destinations. Now treated as ambiguity.
test('correctedSwitchTarget: two different real projects sharing the same matched name are genuinely ambiguous, never an arbitrary pick', () => {
  const alpha = { project: { id: 'alpha' }, matchedPhrase: 'Alpha', matchedOn: 'displayName' }
  const atlasA = { project: { id: 'atlas-a' }, matchedPhrase: 'Atlas', matchedOn: 'displayName' }
  const atlasB = { project: { id: 'atlas-b' }, matchedPhrase: 'Atlas', matchedOn: 'displayName' }
  assert.equal(
    correctedSwitchTarget('switch to Alpha -- no wait, I meant Atlas', [alpha, atlasA, atlasB]),
    null
  )
})

// TSF OWNER DOGFOOD / CRITIQUE LOOP V1 round 5 (real Codex adversarial-
// review findings). Covers: "and/or" recognized as a conjunction; "--"
// treated as punctuation (not a name-continuing hyphen) so it correctly
// terminates a match; the literal-first two-pass match so "I meant Well"/
// "I meant Well-known" resolve directly instead of always stripping
// "well" as a disfluency first; and the guard-scoping fix (this session's
// own regression, caught by the pre-existing disclosed-residual test at
// command-conversation-focus.test.mjs) confirming the relaxed causative-
// imperative guard exception used by verifiedCorrectionTarget stays
// scoped to the correction path only, never leaking into
// isExplicitSwitchMessage's own general guard.
test('correctedSwitchTarget: round 5 findings -- and/or conjunction, double-hyphen punctuation, literal "Well" preferred over disfluency-stripping', () => {
  const alpha = { project: { id: 'alpha' }, matchedPhrase: 'Alpha', matchedOn: 'displayName' }
  const beta = { project: { id: 'beta' }, matchedPhrase: 'Beta', matchedOn: 'displayName' }
  const gamma = { project: { id: 'gamma' }, matchedPhrase: 'Gamma', matchedOn: 'displayName' }
  const well = { project: { id: 'well' }, matchedPhrase: 'Well', matchedOn: 'displayName' }
  assert.equal(
    correctedSwitchTarget('switch to Alpha -- no wait, I meant Beta and/or Gamma', [
      alpha,
      beta,
      gamma
    ]),
    null
  )
  assert.equal(
    correctedSwitchTarget("switch to Beta -- no wait, I meant Alpha--that's the one", [
      beta,
      alpha
    ]),
    'alpha'
  )
  assert.equal(
    correctedSwitchTarget('switch to Alpha -- no wait, I meant Well', [alpha, well]),
    'well'
  )
})

// TSF OWNER DOGFOOD / CRITIQUE LOOP V1 round 5 (real Codex adversarial-
// review finding, Finding 3): the causative-imperative guard exception
// (NAMED_SUBJECT_QUESTION_PATTERN's own carve-out) requires
// CAUSATIVE_IMPERATIVE_PATTERN's trailing-continuation to reach message-
// end -- which a real "-- no wait, I meant X" suffix always breaks, so
// "Have Alpha become the focus -- no wait, I meant Beta" wrongly stayed
// refused. verifiedCorrectionTarget now passes a SHAPE-only variant of
// that pattern (no trailing-continuation requirement) for its own guard
// check -- scoped there only, so the disclosed P1-closure residual this
// would otherwise reopen (a fully punctuation-free "have" question about
// a plural/generic subject) stays refused via isExplicitSwitchMessage's
// own unrelated, still-conservative default.
test('verifiedCorrectionTarget: a causative-imperative correction resolves even though the "-- no wait, I meant X" suffix breaks the trailing-continuation requirement', () => {
  const alpha = { project: { id: 'alpha' }, matchedPhrase: 'Alpha', matchedOn: 'displayName' }
  const beta = { project: { id: 'beta' }, matchedPhrase: 'Beta', matchedOn: 'displayName' }
  assert.equal(
    verifiedCorrectionTarget('Have Alpha become the focus -- no wait, I meant Beta', [alpha, beta]),
    'beta'
  )
  // The relaxation must stay scoped to the correction path -- it must
  // never leak into isExplicitSwitchMessage's own general guard.
  assert.equal(isExplicitSwitchMessage('Have API Docs become the project we focus on yet'), false)
})

// TSF OWNER DOGFOOD / CRITIQUE LOOP V1 round 5 follow-up (real Codex
// adversarial-review findings against round 5's own fix, Findings 1/2):
// trusting CAUSATIVE_IMPERATIVE_SHAPE_PATTERN's match alone (with no
// check on what follows it) ignored ALL trailing content, not just a
// correction suffix -- "Have Alpha be the focus OF THE QUARTERLY REPORT
// -- no wait, I meant Beta" (an instruction about a report's subject,
// not Command focus) and the disclosed punctuation-free-question
// residual PLUS an unrelated correction both wrongly resolved.
// verifiedCorrectionTarget now only trusts the shape match when a
// retraction marker begins IMMEDIATELY after it (nothing but whitespace/
// punctuation in between) -- an intervening clause, even one that
// contains a retraction marker further along, correctly stays refused.
test('verifiedCorrectionTarget: a causative-imperative shape match is only trusted when a retraction marker begins IMMEDIATELY after it, never when unrelated content intervenes', () => {
  const alpha = { project: { id: 'alpha' }, matchedPhrase: 'Alpha', matchedOn: 'displayName' }
  const beta = { project: { id: 'beta' }, matchedPhrase: 'Beta', matchedOn: 'displayName' }
  const apiDocs = {
    project: { id: 'api-docs' },
    matchedPhrase: 'API Docs',
    matchedOn: 'displayName'
  }
  const releaseNotes = {
    project: { id: 'release-notes' },
    matchedPhrase: 'Release Notes',
    matchedOn: 'displayName'
  }
  assert.equal(
    verifiedCorrectionTarget(
      'Have Alpha be the focus of the quarterly report -- no wait, I meant Beta',
      [alpha, beta]
    ),
    null
  )
  assert.equal(
    verifiedCorrectionTarget('Have Alpha become the project owner -- no wait, I meant Beta', [
      alpha,
      beta
    ]),
    null
  )
  assert.equal(
    verifiedCorrectionTarget(
      'Have API Docs become the project we focus on yet -- no wait, I meant Release Notes',
      [apiDocs, releaseNotes]
    ),
    null
  )
  // The genuine, immediately-adjacent correction shape still resolves.
  assert.equal(
    verifiedCorrectionTarget('Have Alpha become the focus -- no wait, I meant Beta', [alpha, beta]),
    'beta'
  )
})

// TSF OWNER DOGFOOD / CRITIQUE LOOP V1 round 5 follow-up (real Codex
// adversarial-review finding, Finding 3, pre-existing): the
// SUBJECT_INVERSION_QUESTION_OPENER guard's own polite-request exemption
// covered POLITE_SWITCH_REQUEST_PATTERN's verb list and
// CAUSATIVE_TRIGGER_PATTERN (make/set), but never the "have" causative
// pattern -- "Could you have Alpha become the focus -- no wait, I meant
// Beta" tripped this guard before ever reaching the causative-imperative
// exception, and stayed wrongly refused.
test('verifiedCorrectionTarget: a polite "Could/Can/Would/Will you have..." causative correction resolves, without reopening the "tell me whether" information-request guard', () => {
  const alpha = { project: { id: 'alpha' }, matchedPhrase: 'Alpha', matchedOn: 'displayName' }
  const beta = { project: { id: 'beta' }, matchedPhrase: 'Beta', matchedOn: 'displayName' }
  assert.equal(
    verifiedCorrectionTarget('Could you have Alpha become the focus -- no wait, I meant Beta', [
      alpha,
      beta
    ]),
    'beta'
  )
  assert.equal(
    verifiedCorrectionTarget('Would you have Alpha become the focus -- no wait, I meant Beta', [
      alpha,
      beta
    ]),
    'beta'
  )
  assert.equal(isExplicitSwitchMessage('Could you tell me whether we should switch to NWR'), false)
})

// TSF OWNER DOGFOOD / CRITIQUE LOOP V1 round 5 follow-up (real Codex
// adversarial-review findings, Findings 4 and 6): "and/or" with internal
// whitespace ("and/ or", "and /or") wasn't recognized as the same
// conjunction token, silently dropping the ambiguity; and only a SINGLE
// leading disfluency was ever stripped, so two stacked, equally common
// fillers ("well, uh, Beta") left an unmatchable remainder behind.
test('correctedSwitchTarget: "and/or" tolerates internal whitespace, and any number of stacked disfluencies are stripped', () => {
  const alpha = { project: { id: 'alpha' }, matchedPhrase: 'Alpha', matchedOn: 'displayName' }
  const beta = { project: { id: 'beta' }, matchedPhrase: 'Beta', matchedOn: 'displayName' }
  const releaseNotes = {
    project: { id: 'release-notes' },
    matchedPhrase: 'Release Notes',
    matchedOn: 'displayName'
  }
  assert.equal(
    correctedSwitchTarget('switch to Alpha -- no wait, I meant Beta and/ or Release Notes', [
      alpha,
      beta,
      releaseNotes
    ]),
    null
  )
  assert.equal(
    correctedSwitchTarget('switch to Alpha -- no wait, I meant Beta and /or Release Notes', [
      alpha,
      beta,
      releaseNotes
    ]),
    null
  )
  assert.equal(
    correctedSwitchTarget('switch to Alpha -- no wait, I meant well, uh, Beta', [alpha, beta]),
    'beta'
  )
})

// TSF OWNER DOGFOOD / CRITIQUE LOOP V1 round 6 (real Codex adversarial-
// review finding, P0): NEGATION_GUARD_PATTERN had no causativeException
// exemption at all -- "never" is both part of its own vocabulary AND
// part of RETRACTION_MARKER_PATTERN's "never mind" retraction phrase, so
// a genuine, immediately-adjacent "never mind, I meant X" correction
// still tripped this separate, unconditional guard branch.
test('verifiedCorrectionTarget: "never mind, I meant X" resolves -- NEGATION_GUARD_PATTERN no longer blocks a genuine adjacent correction', () => {
  const alpha = { project: { id: 'alpha' }, matchedPhrase: 'Alpha', matchedOn: 'displayName' }
  const beta = { project: { id: 'beta' }, matchedPhrase: 'Beta', matchedOn: 'displayName' }
  assert.equal(
    verifiedCorrectionTarget('Have Alpha become the focus -- never mind, I meant Beta', [
      alpha,
      beta
    ]),
    'beta'
  )
  // An unrelated negation with no causative-correction shape at all is
  // completely unaffected.
  assert.equal(isExplicitSwitchMessage("Don't switch to NWR"), false)
})

// TSF OWNER DOGFOOD / CRITIQUE LOOP V1 round 6 (real Codex adversarial-
// review finding, P0): the leading-punctuation strip in
// hasSafeCausativeImperativeCorrectionShape only covered ASCII
// punctuation, so an em dash/en dash/ellipsis right after the causative
// shape never reached the immediate-retraction check at all.
test('verifiedCorrectionTarget: an em dash, en dash, or ellipsis directly after the causative shape is recognized the same as "--"', () => {
  const alpha = { project: { id: 'alpha' }, matchedPhrase: 'Alpha', matchedOn: 'displayName' }
  const beta = { project: { id: 'beta' }, matchedPhrase: 'Beta', matchedOn: 'displayName' }
  assert.equal(
    verifiedCorrectionTarget('Have Alpha become the focus—no wait, I meant Beta', [alpha, beta]),
    'beta'
  )
  assert.equal(
    verifiedCorrectionTarget('Have Alpha become the focus–no wait, I meant Beta', [alpha, beta]),
    'beta'
  )
  assert.equal(
    verifiedCorrectionTarget('Have Alpha become the focus…no wait, I meant Beta', [alpha, beta]),
    'beta'
  )
})

// TSF OWNER DOGFOOD / CRITIQUE LOOP V1 round 6 (real Codex adversarial-
// review finding, P1, a regression in round 5's own multi-disfluency
// fix): unconditionally stripping ALL repeating leading fillers in one
// pass could strip the real corrected name too, when that name is
// itself one of the recognized filler words ("uh, Well" stripped BOTH
// "uh" and "well", leaving nothing to match). Trying each strip depth in
// increasing order and taking the first real match fixes this without
// reopening the original multi-disfluency case.
test('correctedSwitchTarget: a stacked disfluency never strips a literal filler-named real candidate it precedes', () => {
  const alpha = { project: { id: 'alpha' }, matchedPhrase: 'Alpha', matchedOn: 'displayName' }
  const well = { project: { id: 'well' }, matchedPhrase: 'Well', matchedOn: 'displayName' }
  const wellKnown = {
    project: { id: 'well-known' },
    matchedPhrase: 'Well-known',
    matchedOn: 'displayName'
  }
  assert.equal(
    correctedSwitchTarget('switch to Alpha -- no wait, I meant uh, um, Well', [alpha, well]),
    'well'
  )
  assert.equal(
    correctedSwitchTarget('switch to Alpha -- no wait, I meant uh, Well-known', [alpha, wellKnown]),
    'well-known'
  )
})

// TSF OWNER DOGFOOD / CRITIQUE LOOP V1 round 6 (real Codex adversarial-
// review finding, P1): an immediately-adjacent retraction was trusted
// even when it was itself a FULL retraction ("leave it unchanged")
// followed by an entirely separate sentence containing an unrelated "I
// meant X" -- correctedSwitchTarget's own last-"I meant"-in-the-message
// search then picked up that unrelated later correction across the
// sentence boundary. hasSafeCausativeImperativeCorrectionShape now also
// requires "I meant" to occur before the first real sentence boundary
// after the retraction marker.
test('verifiedCorrectionTarget: a full retraction followed by an unrelated "I meant X" in a LATER sentence never resolves', () => {
  const alpha = { project: { id: 'alpha' }, matchedPhrase: 'Alpha', matchedOn: 'displayName' }
  const beta = { project: { id: 'beta' }, matchedPhrase: 'Beta', matchedOn: 'displayName' }
  assert.equal(
    verifiedCorrectionTarget(
      'Have Alpha become the focus -- no wait, leave it unchanged. In the report, I meant Beta.',
      [alpha, beta]
    ),
    null
  )
  // The genuine, same-clause correction shape is unaffected.
  assert.equal(
    verifiedCorrectionTarget('Have Alpha become the focus -- no wait, I meant Beta', [alpha, beta]),
    'beta'
  )
})

// TSF OWNER DOGFOOD / CRITIQUE LOOP V1 round 7 (real Codex adversarial-
// review finding, P0): round 6's NEGATION_GUARD_PATTERN exemption was a
// blanket "skip the whole guard whenever causativeException is true" --
// safe for SUBJECT_INVERSION_QUESTION_OPENER/NAMED_SUBJECT_QUESTION_PATTERN
// (both anchored to how the message OPENS), but NEGATION_GUARD_PATTERN
// searches the WHOLE, unanchored message, so it also hid a completely
// independent, later negation. isGuardedByNonRetraction now strips only
// the matched RETRACTION_MARKER_PATTERN text itself before testing for
// negation, so "never" inside "never mind" never reaches the test, while
// an unrelated "don't switch yet" elsewhere in the same message still
// does.
test('verifiedCorrectionTarget: an independent negation elsewhere in the message still refuses, even alongside a genuine adjacent correction', () => {
  const alpha = { project: { id: 'alpha' }, matchedPhrase: 'Alpha', matchedOn: 'displayName' }
  const beta = { project: { id: 'beta' }, matchedPhrase: 'Beta', matchedOn: 'displayName' }
  assert.equal(
    verifiedCorrectionTarget(
      "Have Alpha become the focus -- no wait, I meant Beta, but don't switch yet.",
      [alpha, beta]
    ),
    null
  )
  assert.equal(
    verifiedCorrectionTarget(
      "Have Alpha become the focus -- never mind, I meant Beta, but don't switch yet.",
      [alpha, beta]
    ),
    null
  )
  // The genuine correction, with no extra negation, is unaffected.
  assert.equal(
    verifiedCorrectionTarget('Have Alpha become the focus -- never mind, I meant Beta', [
      alpha,
      beta
    ]),
    'beta'
  )
})

// TSF OWNER DOGFOOD / CRITIQUE LOOP V1 round 7 (real Codex adversarial-
// review finding, P1): hasSafeCausativeImperativeCorrectionShape
// validated only the FIRST "I meant" after the retraction against the
// sentence boundary, while correctedSwitchTarget always resolves against
// the LAST "I meant" anywhere in its own search window -- "-- no wait, I
// meant Gamma. In the report, I meant Beta." validated the safe, FIRST
// occurrence (Gamma), while the actual resolved target was the LATER,
// unrelated "I meant Beta" the boundary check never examined. Now finds
// the LAST occurrence too, mirroring correctedSwitchTarget exactly.
test('verifiedCorrectionTarget: the sentence-boundary safety check validates the SAME "I meant" occurrence that actually gets resolved', () => {
  const alpha = { project: { id: 'alpha' }, matchedPhrase: 'Alpha', matchedOn: 'displayName' }
  const beta = { project: { id: 'beta' }, matchedPhrase: 'Beta', matchedOn: 'displayName' }
  const gamma = { project: { id: 'gamma' }, matchedPhrase: 'Gamma', matchedOn: 'displayName' }
  assert.equal(
    verifiedCorrectionTarget(
      'Have Alpha become the focus -- no wait, I meant Gamma. In the report, I meant Beta.',
      [alpha, beta, gamma]
    ),
    null
  )
})

// TSF OWNER DOGFOOD / CRITIQUE LOOP V1 round 7 (real Codex adversarial-
// review finding, P1, refined by round 8): the sentence-boundary regex
// treated ANY ". "/"! "/"? " as a real sentence end, so a short
// abbreviation period ("the v. 2 notes, I meant Beta.") was wrongly
// treated as a sentence boundary and refused a genuine correction -- a
// false negative. A real sentence boundary is now distinguished from an
// abbreviation period by whether a DIGIT immediately follows the
// punctuation+whitespace ("v. 2" is not a boundary; "unchanged. In" is)
// -- round 8's own review found the original "uppercase letter" version
// of this heuristic too narrow (see the test below).
test('verifiedCorrectionTarget: an abbreviation-style period is never mistaken for a real sentence boundary', () => {
  const alpha = { project: { id: 'alpha' }, matchedPhrase: 'Alpha', matchedOn: 'displayName' }
  const beta = { project: { id: 'beta' }, matchedPhrase: 'Beta', matchedOn: 'displayName' }
  assert.equal(
    verifiedCorrectionTarget(
      'Have Alpha become the focus -- no wait, after checking the v. 2 notes, I meant Beta.',
      [alpha, beta]
    ),
    'beta'
  )
  // A real sentence boundary (followed by a capital letter) still refuses.
  assert.equal(
    verifiedCorrectionTarget(
      'Have Alpha become the focus -- no wait, leave it unchanged. In the report, I meant Beta.',
      [alpha, beta]
    ),
    null
  )
})

// TSF OWNER DOGFOOD / CRITIQUE LOOP V1 round 8 (real Codex adversarial-
// review finding, P0): a correction that resolved cleanly could still be
// abandoned by a LATER retraction with nothing to redeem it --
// "switch to Alpha -- no wait, I meant Beta. Never mind." wrongly
// resolved to Beta, ignoring the trailing "Never mind." correctedSwitchTarget
// now refuses whenever ANY retraction marker follows the resolved name
// anywhere later in the message -- reproduced with all 12
// RETRACTION_MARKER_PATTERN vocabulary words placed directly after the
// target. This lives in correctedSwitchTarget itself (not the causative-
// shape-specific guard function) since the plain "switch to X" shape
// never goes through that function at all.
test('correctedSwitchTarget: a trailing retraction anywhere after the resolved target invalidates the correction', () => {
  const alpha = { project: { id: 'alpha' }, matchedPhrase: 'Alpha', matchedOn: 'displayName' }
  const beta = { project: { id: 'beta' }, matchedPhrase: 'Beta', matchedOn: 'displayName' }
  const gamma = { project: { id: 'gamma' }, matchedPhrase: 'Gamma', matchedOn: 'displayName' }
  for (const marker of [
    'never mind',
    'scratch that',
    'forget it',
    'disregard that',
    'strike that',
    'take that back',
    'no wait',
    'wait no',
    'actually no',
    'cancel that',
    'leave it unchanged',
    'keep it unchanged'
  ]) {
    assert.equal(
      correctedSwitchTarget(`switch to Alpha -- no wait, I meant Beta. ${marker}.`, [alpha, beta]),
      null,
      `trailing "${marker}" should invalidate the correction`
    )
  }
  // The genuine, no-trailing-retraction correction (including round 2's
  // own "unrelated later mention" fix, which has no retraction marker at
  // all) is unaffected.
  assert.equal(
    correctedSwitchTarget('switch to Alpha -- no wait, I meant Beta', [alpha, beta]),
    'beta'
  )
  assert.equal(
    correctedSwitchTarget('switch to Alpha -- no wait, I meant Beta, and compare it with Gamma', [
      alpha,
      beta,
      gamma
    ]),
    'beta'
  )
})

// TSF OWNER DOGFOOD / CRITIQUE LOOP V1 round 8 (real Codex adversarial-
// review finding, P0): round 7's "uppercase letter after the
// punctuation" heuristic for a real sentence boundary was too narrow --
// a genuine new, unrelated sentence can continue in lowercase too
// (informal writing, a spoken transcript, a quote mark, a bullet), and
// each of these wrongly resolved under round 7's own heuristic.
test('verifiedCorrectionTarget: a real sentence boundary is recognized even when what follows is lowercase, quoted, or a bulleted line', () => {
  const alpha = { project: { id: 'alpha' }, matchedPhrase: 'Alpha', matchedOn: 'displayName' }
  const beta = { project: { id: 'beta' }, matchedPhrase: 'Beta', matchedOn: 'displayName' }
  assert.equal(
    verifiedCorrectionTarget(
      'Have Alpha become the focus -- no wait. in the report, I meant Beta.',
      [alpha, beta]
    ),
    null
  )
  assert.equal(
    verifiedCorrectionTarget(
      'Have Alpha become the focus -- no wait. "In the report, I meant Beta."',
      [alpha, beta]
    ),
    null
  )
  assert.equal(
    verifiedCorrectionTarget(
      'Have Alpha become the focus -- no wait.\n- In the report, I meant Beta.',
      [alpha, beta]
    ),
    null
  )
  assert.equal(
    verifiedCorrectionTarget(
      'Have Alpha become the focus -- no wait! then in the report I meant Beta.',
      [alpha, beta]
    ),
    null
  )
})

// TSF OWNER DOGFOOD / CRITIQUE LOOP V1 round 8 (real Codex adversarial-
// review finding, P0): round 7's whole "sentence boundary" model assumed
// a genuine correction always stays within one clause -- but a real
// correction can legitimately chain through a SECOND retraction across a
// real sentence boundary: the owner retracts a full retraction ("keep it
// unchanged") with ANOTHER retraction ("Actually, no"), then corrects.
// hasSafeCausativeImperativeCorrectionShape now trusts a real sentence
// boundary before "I meant" only when a fresh retraction marker sits
// directly before it (any retraction marker, not necessarily the one
// right after the shape) -- otherwise (the round 6/7 unrelated-later-
// prose case) it still correctly refuses.
test('verifiedCorrectionTarget: a genuine correction chained through a second retraction across a real sentence boundary resolves', () => {
  const alpha = { project: { id: 'alpha' }, matchedPhrase: 'Alpha', matchedOn: 'displayName' }
  const beta = { project: { id: 'beta' }, matchedPhrase: 'Beta', matchedOn: 'displayName' }
  assert.equal(
    verifiedCorrectionTarget(
      'Have Alpha become the focus -- no wait, keep it unchanged. Actually, no -- I meant Beta.',
      [alpha, beta]
    ),
    'beta'
  )
})

const round10Alpha = {
  project: { id: 'alpha' },
  matchedPhrase: 'Alpha',
  matchedOn: 'displayName'
}
const round10Beta = {
  project: { id: 'beta' },
  matchedPhrase: 'Beta',
  matchedOn: 'displayName'
}
const round10Matches = [round10Alpha, round10Beta]

function assertRound10Correction(message, expected) {
  assert.equal(verifiedCorrectionTarget(message, round10Matches), expected)
  assert.deepEqual(correctedTurnTargetIds(message, round10Matches), expected ? [expected] : [])
}

test('round 10: abbreviations inside one correction clause are not sentence boundaries', () => {
  for (const message of [
    'Have Alpha become the focus -- no wait, after the 3 p.m. review, I meant Beta.',
    'Have Alpha become the focus -- no wait, after Mr. Smith reviewed it, I meant Beta.',
    'Have Alpha become the focus -- no wait, after Dr. Lee reviewed it, I meant Beta.',
    'Have Alpha become the focus -- no wait, after Acme Inc. staff reviewed it, I meant Beta.'
  ]) {
    assertRound10Correction(message, 'beta')
  }
})

test('round 10: a digit-start sentence after a period, exclamation, or question mark is unrelated prose', () => {
  for (const punctuation of ['.', '!', '?']) {
    assertRound10Correction(
      `Have Alpha become the focus -- no wait${punctuation} 2 items in the report use the wrong name; I meant Beta there.`,
      null
    )
  }
})

test('round 10: bounded disfluencies may bridge a fresh retraction to I meant', () => {
  for (const message of [
    'Have Alpha become the focus -- no wait, keep it unchanged. Actually, no -- um, I meant Beta.',
    'Have Alpha become the focus -- no wait, keep it unchanged. Never mind -- well, uh, I meant Beta.'
  ]) {
    assertRound10Correction(message, 'beta')
  }
})

test('round 10: a punctuation-free newline starts unrelated later prose', () => {
  assertRound10Correction(
    'Have Alpha become the focus -- no wait\nIn the report, I meant Beta as the codename.',
    null
  )
})

test('round 10: marker-shaped vocabulary in a completed prose sentence is not a fresh retraction', () => {
  for (const message of [
    'Have Alpha become the focus -- no wait, keep it unchanged. The answer is actually no. I meant Beta in the report.',
    'Have Alpha become the focus -- no wait, keep it unchanged. The requirement is to leave it unchanged. I meant Beta in the report.'
  ]) {
    assertRound10Correction(message, null)
  }
})

test('round 10: sentence punctuation before a closing quote remains a boundary', () => {
  assertRound10Correction(
    'Have Alpha become the focus -- no wait, the status note ends "unchanged." In the report, I meant Beta.',
    null
  )
})

test('round 10: repeated horizontal whitespace cannot backtrack around numeric abbreviations', () => {
  for (const message of [
    'Have Alpha become the focus -- no wait, after checking the v.  2 notes, I meant Beta.',
    'Have Alpha become the focus -- no wait, after checking no.\t\t2 notes, I meant Beta.'
  ]) {
    assertRound10Correction(message, 'beta')
  }
})

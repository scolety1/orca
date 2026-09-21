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
  correctedSwitchTarget,
  verifiedCorrectionTarget
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

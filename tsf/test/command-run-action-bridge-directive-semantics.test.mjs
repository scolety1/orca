// DIRECTIVE SEMANTICS CLOSURE V1, round 2: real Codex adversarial-review
// findings against classifyRunActionVerb -- split out to keep
// command-run-action-bridge.test.mjs under the repo's max-lines cap (same
// convention command-run-action-bridge-needs-you-revision.test.mjs and
// command-quantified-run-action.test.mjs already established).
import assert from 'node:assert/strict'
import test from 'node:test'
import { classifyRunActionVerb } from '../server/command-run-action-bridge.mjs'

// A retraction marker reached a real PAUSE via this classifier -- unlike
// domain/command-act-model.mjs's own retraction handling (commit
// 322a633cb8), which command-responder.mjs's single-project path never
// reaches (it calls classifyRunActionVerb directly). Both the same-clause
// shape ("--" is not a clause boundary) and the separate-later-clause
// shape (split on ",") are covered by a single message-wide check.
test('classifyRunActionVerb: a retraction marker anywhere in the message suppresses the classification', () => {
  for (const message of [
    'Pause NWR -- never mind',
    'Pause NWR, never mind.',
    'Pause NWR, scratch that.',
    'Pause NWR -- actually, never mind.',
    'Pause NWR -- forget it',
    'Pause NWR -- disregard that',
    'Pause NWR -- strike that',
    'Pause NWR -- I take that back',
    'pause NWR no wait resume it'
  ]) {
    assert.equal(classifyRunActionVerb(message), null, message)
  }
})

// Reported speech ("Claude suggested we pause it") reached a real PAUSE:
// the pronoun branch only checked QUESTION_OPENER/DELIBERATIVE_STATEMENT_OPENER
// (both anchored to clause START), never a mid-clause reported-speech
// subject.
test('classifyRunActionVerb: reported speech anywhere in the message suppresses the classification', () => {
  for (const message of [
    'Regarding NWR Claude suggested we pause it',
    'The report recommends you pause it for NWR'
  ]) {
    assert.equal(classifyRunActionVerb(message), null, message)
  }
})

test('classifyRunActionVerb: ordinary directives are completely unaffected by the new guard', () => {
  assert.equal(classifyRunActionVerb('Pause NWR.'), 'PAUSE')
  assert.equal(classifyRunActionVerb('pause it'), 'PAUSE')
  assert.equal(classifyRunActionVerb('Resume NWR.'), 'RESUME')
  assert.equal(classifyRunActionVerb('please pause it'), 'PAUSE')
})

// DIRECTIVE SEMANTICS CLOSURE V1, round 3 (real Codex adversarial-review
// finding): QUESTION_OPENER's subject alternation only covered pronouns
// -- a real agent/system noun standing in for the pronoun subject
// ("Can the system pause it for NWR") still classified as PAUSE/RESUME.
test('classifyRunActionVerb: a named-subject ("the <noun>") question is never a directive', () => {
  assert.equal(classifyRunActionVerb('Can the system pause it for NWR'), null)
  assert.equal(classifyRunActionVerb('Should the runner resume it for NWR'), null)
  assert.equal(classifyRunActionVerb('Would the scheduler retry it for NWR'), null)
  // The BUG-08 danger case (a verb, not "the <noun>", immediately after
  // the modal) must never be affected by this broadening.
  assert.equal(classifyRunActionVerb('run the tests and will pause it after that'), 'PAUSE')
})

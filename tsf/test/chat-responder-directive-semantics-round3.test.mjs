// DIRECTIVE SEMANTICS CLOSURE V1, round 3: real Codex adversarial-review
// findings against the round-2 closure diff (commit 9e9ceab385).
// test/chat-responder.test.mjs is already at this repo's max-lines budget,
// so this small, narrowly-scoped sibling file holds the new coverage
// instead of growing it further.
import assert from 'node:assert/strict'
import test from 'node:test'
import { isGenuineDirective } from '../server/chat-responder.mjs'

// TELL_ME_WHETHER's verb list was missing confirm/verify/find out -- all
// three fell through to POLITE_REQUEST_MARKER's own unconditional
// "can/could/would/will you" -> true, reaching a real mutation.
for (const message of [
  'Could you confirm if we should pause niners-war-room',
  'Can you verify whether we should pause niners-war-room',
  'Will you find out if we should pause niners-war-room'
]) {
  test(`isGenuineDirective round 3: a broader information-request verb is never a directive -- "${message}"`, () => {
    assert.equal(isGenuineDirective(message, message), false)
  })
}

// REPORTED_SPEECH_MARKER's subject/verb lists were missing common
// manager/tim/team subjects and asked-to/told-to verb shapes.
for (const message of [
  'My manager asked me to pause niners-war-room',
  'Tim told me to pause niners-war-room',
  'The team asked me to pause niners-war-room'
]) {
  test(`isGenuineDirective round 3: a broader reported-speech shape is never a directive -- "${message}"`, () => {
    assert.equal(isGenuineDirective(message, message), false)
  })
}

// Controls: the real trigger phrasings, and the round-1/round-2 fixes,
// must be completely unaffected by the round-3 vocabulary broadening.
test('isGenuineDirective round 3: real directives and prior fixes are unaffected', () => {
  assert.equal(isGenuineDirective('Pause niners-war-room.', 'Pause niners-war-room.'), true)
  assert.equal(
    isGenuineDirective('Can you pause niners-war-room?', 'Can you pause niners-war-room?'),
    true
  )
  assert.equal(
    isGenuineDirective(
      'Could you tell me whether I should pause niners-war-room',
      'Could you tell me whether I should pause niners-war-room'
    ),
    false
  )
  assert.equal(
    isGenuineDirective('deploy it if the tests pass', 'deploy it if the tests pass'),
    true
  )
})

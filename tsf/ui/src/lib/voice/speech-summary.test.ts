import assert from 'node:assert/strict'
import test from 'node:test'
import { summarizeForSpeech } from './speech-summary.ts'

test('returns short text unchanged (below the cap)', () => {
  assert.equal(summarizeForSpeech('TSF is waiting.'), 'TSF is waiting.')
})

test('strips markdown emphasis characters', () => {
  assert.equal(summarizeForSpeech('**TSF** is `waiting`.'), 'TSF is waiting.')
})

test('keeps leading sentences up to the cap, dropping the rest', () => {
  const text = `First sentence is short. Second sentence is also short. ${'X'.repeat(300)}.`
  const result = summarizeForSpeech(text, 60)
  assert.ok(result.length <= 60)
  assert.equal(result, 'First sentence is short. Second sentence is also short.')
})

// REAL CODEX ADVERSARIAL-REVIEW FINDING (P1, fixed): the cap was not
// actually enforced when the FIRST sentence alone already exceeded
// maxLength -- the overflow check only ever broke when `result` was
// already non-empty, so a single long sentence was returned in full.
test('a single sentence longer than the cap is truncated, not returned in full', () => {
  const oneLongSentence = 'A'.repeat(500)
  const result = summarizeForSpeech(oneLongSentence, 200)
  assert.equal(result.length, 200)
})

test('the default cap (200) is enforced for a single long sentence with no explicit maxLength', () => {
  const oneLongSentence = 'B'.repeat(500)
  const result = summarizeForSpeech(oneLongSentence)
  assert.equal(result.length, 200)
})

// REAL DOGFOOD FINDING (post-mission, P1): a real Command response is
// often a bullet list with no terminal sentence punctuation per line --
// pervasive across server/command-*-bridge.mjs's own response text (e.g.
// "3 thing(s) need you:\n- **NWR** -- Execution hold\n- **TSF** -- ...").
// Splitting only on .!? treated the whole list as one unsplittable
// "sentence" once it exceeded maxLength, degrading to a raw
// character-count truncation that cut off mid-word/mid-item with no
// signal more content existed.
test('a newline-separated bullet list caps at a complete item boundary, never mid-item', () => {
  const text =
    '3 thing(s) need you:\n' +
    '- **Niners War Room** -- Execution hold, waiting on your decision\n' +
    '- **TSF Orca** -- Waiting on resources to free up before continuing\n' +
    '- **Landing Page Revamp** -- Needs a real design decision from you'
  const result = summarizeForSpeech(text)
  assert.ok(result.length <= 200)
  assert.ok(result.includes('Niners War Room -- Execution hold, waiting on your decision'))
  assert.ok(result.includes('TSF Orca -- Waiting on resources to free up before continuing'))
  assert.ok(
    !result.includes('Landing Page'),
    'the third item should be dropped whole, never truncated mid-item'
  )
})

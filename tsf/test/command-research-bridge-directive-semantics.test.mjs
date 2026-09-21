// DIRECTIVE SEMANTICS CLOSURE V1: a musing statement that happens to
// contain parsePaidGrant's required authorizing verb ("I wonder if we
// should USE Exa up to $20") still classified as a real spend grant even
// after the earlier authorizing-verb fix (612fe6b284). Kept in its own
// small file rather than test/command-research-bridge.test.mjs, which is
// pre-existing, disclosed technical debt already well over this repo's
// max-lines budget (a lint-staged ordering quirk: oxlint's max-lines check
// runs before oxfmt --write, which can expand a file's line count well
// past what was checked -- not something this narrow closure pass fixes).
import assert from 'node:assert/strict'
import test from 'node:test'
import { classifyResearchIntent } from '../server/command-research-bridge.mjs'

test('classifyResearchIntent: a musing statement containing the authorizing verb is never RESEARCH_PAID_GRANT', () => {
  assert.notEqual(
    classifyResearchIntent('I wonder if we should use Exa up to $20'),
    'RESEARCH_PAID_GRANT'
  )
  assert.notEqual(
    classifyResearchIntent('Maybe we should use Exa up to $20'),
    'RESEARCH_PAID_GRANT'
  )
  // The real, intended trigger phrasing must still work.
  assert.equal(classifyResearchIntent('Use Exa up to $20'), 'RESEARCH_PAID_GRANT')
})

// DIRECTIVE SEMANTICS CLOSURE V1, round 2 (real Codex adversarial-review
// finding): the fix above was still insufficient -- a genuine question or
// reported-speech sentence naming a provider and a dollar amount still
// granted real spend, since there is no later directive check once
// RESEARCH_PAID_GRANT fires. Fixed by requiring
// isGenuineDirective(message, message) plus two narrow, file-local
// supplements (a message-start modal question, and "we/i may" as an
// additional discussion opener not in the shared DELIBERATIVE_STATEMENT_
// OPENER vocabulary).
test('classifyResearchIntent: a question or reported-speech sentence naming a provider and an amount is never RESEARCH_PAID_GRANT', () => {
  for (const message of [
    'Would Exa use a $50 budget efficiently',
    'Should our team use Exa if it costs $50',
    'We may use Exa but what does the $50 price include',
    'The plan recommends we use Parallel for the $50 trial',
    'Please explain whether to use Exa at $50',
    'Do you recommend I use Parallel for $50',
    'Can Exa use a $50 budget for this'
  ]) {
    assert.notEqual(classifyResearchIntent(message), 'RESEARCH_PAID_GRANT', message)
  }
  // The real, intended trigger phrasings -- including the polite-request
  // variant, which must not be caught by the new message-start-modal
  // check -- still work.
  assert.equal(classifyResearchIntent('Use Exa for this research up to $50'), 'RESEARCH_PAID_GRANT')
  assert.equal(classifyResearchIntent('Can you use Exa up to $20'), 'RESEARCH_PAID_GRANT')
})

// DIRECTIVE SEMANTICS CLOSURE V1, round 3 (real Codex adversarial-review
// finding): two more real gaps survived round 2. (1) No retraction check
// existed at all -- a grant retracted in the same message still granted.
// (2) MESSAGE_START_MODAL_QUESTION only excluded an immediately-following
// "you", so a real, legitimate polite request with a different subject
// ("the team", "our research agent") was wrongly refused as a question.
test('classifyResearchIntent: a retracted grant is never RESEARCH_PAID_GRANT', () => {
  assert.notEqual(classifyResearchIntent('Use Exa up to $50, scratch that.'), 'RESEARCH_PAID_GRANT')
  assert.notEqual(
    classifyResearchIntent('Use Parallel up to $20 -- never mind.'),
    'RESEARCH_PAID_GRANT'
  )
})

test('classifyResearchIntent: a polite request with a non-"you" subject still grants', () => {
  assert.equal(
    classifyResearchIntent('Could the team please use Exa up to $50'),
    'RESEARCH_PAID_GRANT'
  )
  assert.equal(
    classifyResearchIntent('Would our research agent please use Parallel up to $25'),
    'RESEARCH_PAID_GRANT'
  )
  // The "please" carve-out must never reopen the genuine-question cases
  // round 2 already closed.
  for (const message of [
    'Would Exa use a $50 budget efficiently',
    'Should our team use Exa if it costs $50',
    'Can Exa use a $50 budget for this'
  ]) {
    assert.notEqual(classifyResearchIntent(message), 'RESEARCH_PAID_GRANT', message)
  }
})

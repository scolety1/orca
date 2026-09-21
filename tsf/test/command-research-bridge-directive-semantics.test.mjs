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

// Real-network finding: a synthesized requestedFields name ("League Year")
// vs a real page's own column header ("Year") is common, honest naming
// variance, not a reason to lose the column entirely. Proves the
// word-subset-widening fix, and that it stays a purely structural rule --
// never a semantic/synonym guess.
import assert from 'node:assert/strict'
import test from 'node:test'
import { extractObservationsFromWebTable } from '../domain/web-table-observation-extraction.mjs'

const headers = ['Year', 'Maximum team salary']
const rows = [
  ['2018', '$177.2 million'],
  ['2019', '$188.2 million'],
  ['2020', '$198.2 million']
]

function extract(requestedFieldNames, entityId) {
  return extractObservationsFromWebTable(
    { headers, rows },
    { requestedFieldNames, targetEntity: { entityId, name: null }, temporalScope: null, sourceRef: 'https://example.com/cap', publisher: null, retrievedAt: '2026-09-06T00:00:00.000Z' }
  )
}

test('exact normalized header match still works unchanged', () => {
  const result = extract(['Year'], '2018')
  assert.equal(result.matched, true)
  assert.equal(result.proposedClaims.length, 1)
  assert.equal(result.proposedClaims[0].proposedValue, '2018')
})

test('word-subset widening: a requested field name that CONTAINS the real header ("League Year" contains "Year") matches', () => {
  const result = extract(['League Year'], '2019')
  assert.equal(result.matched, true)
  assert.equal(result.proposedClaims.length, 1)
  assert.equal(result.proposedClaims[0].fieldName, 'League Year')
  assert.equal(result.proposedClaims[0].proposedValue, '2019')
})

// REAL, ADVERSARIALLY-FOUND BUG (REAL FREE-PATH RESEARCH EXECUTION V1 live
// proving run): an earlier version of this widening used plain character-
// substring containment, which let "Percent Change from Prior Year"
// spuriously match the "Year" column purely because "year" is a
// coincidental substring of "prioryear" once spaces are stripped -- a
// genuine FABRICATED CLAIM (the real page has no percent-change data at
// all), not mere imprecision. This is the regression test for that exact
// failure mode.
test('a single common word buried in an otherwise unrelated, much longer phrase must NEVER match -- the exact false-claim bug found live', () => {
  const result = extract(['Percent Change from Prior Year'], '2018')
  assert.equal(result.matched, true, 'the entity row was found')
  assert.equal(result.proposedClaims.length, 0, '"Percent Change from Prior Year" must not match "Year" merely because both happen to contain the word "year"')
})

test('a genuine, honest limitation: substantially different phrasing with no meaningful word overlap stays unmatched, never guessed', () => {
  const result = extract(['Salary Cap Amount'], '2018')
  assert.equal(result.matched, true, 'the entity row was found')
  assert.equal(result.proposedClaims.length, 0, '"Salary Cap Amount" shares no full word-subset relationship with "Maximum team salary" -- correctly left unmatched, not fuzzy-guessed')
})

test('a genuine, honest limitation: a single shared word diluted across a longer real header also stays unmatched (ratio guard)', () => {
  const result = extract(['Salary'], '2020')
  assert.equal(result.matched, true)
  assert.equal(result.proposedClaims.length, 0, '"Salary" is only 1 of 3 words in "Maximum team salary" (ratio 1/3 < 0.5) -- too diluted a match to trust, correctly rejected')
})

test('entity matching is unaffected by field-matching changes: an unknown entity still reports matched:false', () => {
  const result = extract(['Year'], '1899')
  assert.equal(result.matched, false)
  assert.equal(result.proposedClaims.length, 0)
})

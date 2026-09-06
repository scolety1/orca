// Exact-match tier only (100% safe, purely structural). Bounded semantic
// reconciliation lives in field-source-reconciliation.mjs; its output is
// consumed here only via caller-supplied FieldBindings (additionalBindings).
import assert from 'node:assert/strict'
import test from 'node:test'
import { extractObservationsFromWebTable, matchExactColumnIndex } from '../domain/web-table-observation-extraction.mjs'
import { buildFieldBinding } from '../domain/field-binding.mjs'

const headers = ['Year', 'Maximum team salary', 'Team Record', 'Record High Team Attendance']
const rows = [
  ['2018', '$177.2 million', '13-3', '73,548'],
  ['2019', '$188.2 million', '12-4', '74,102'],
  ['2020', '$198.2 million', '11-5', '0 (no fans)']
]

function extract(requestedFieldNames, entityId, additionalBindings = []) {
  return extractObservationsFromWebTable(
    { headers, rows },
    { requestedFieldNames, targetEntity: { entityId, name: null }, temporalScope: null, sourceRef: 'https://example.com/cap', publisher: null, retrievedAt: '2026-09-06T00:00:00.000Z', additionalBindings }
  )
}

test('exact normalized header match resolves the field', () => {
  const result = extract(['Year'], '2018')
  assert.equal(result.matched, true)
  assert.equal(result.proposedClaims.length, 1)
  assert.equal(result.proposedClaims[0].proposedValue, '2018')
})

test('an unrelated numeric column never matches purely by being adjacent/numeric -- exact header only', () => {
  const result = extract(['Salary Cap'], '2018')
  assert.equal(result.matched, true, 'the entity row was found')
  assert.equal(result.proposedClaims.length, 0, 'no exact header equals "Salary Cap" -- must stay unresolved, not guess "Maximum team salary" or any other column')
  assert.deepEqual(result.unresolvedFieldNames, ['Salary Cap'])
})

test('a misleading near-match on shared words never matches without an exact header -- regression for the live-found "Team Record" / "Record High Team Attendance" false-claim class', () => {
  const result = extract(['Team Record'], '2018')
  assert.equal(result.matched, true)
  // "Team Record" IS itself an exact header here, so it correctly resolves --
  // the adversarial case is the OTHER direction: a near-miss phrasing must not.
  assert.equal(result.proposedClaims[0].proposedValue, '13-3')
  const nearMiss = extract(['Attendance Record'], '2018')
  assert.equal(nearMiss.proposedClaims.length, 0, '"Attendance Record" must not fuzzy-match "Record High Team Attendance" or "Team Record"')
})

test('multiple plausible headers: only the field named exactly resolves, its sibling stays unresolved', () => {
  const result = extract(['Team Record', 'Record High Team Attendance'], '2019')
  assert.equal(result.proposedClaims.length, 2)
  assert.equal(result.proposedClaims.find((c) => c.fieldName === 'Team Record').proposedValue, '12-4')
  assert.equal(result.proposedClaims.find((c) => c.fieldName === 'Record High Team Attendance').proposedValue, '74,102')
})

test('Salary Cap <-> Maximum team salary: unresolved by exact match alone, resolves once a bounded-semantic FieldBinding is supplied', () => {
  const withoutBinding = extract(['Salary Cap'], '2020')
  assert.equal(withoutBinding.proposedClaims.length, 0)
  const binding = buildFieldBinding({
    canonicalField: 'Salary Cap',
    rawHeader: 'Maximum team salary',
    sourceIdentity: 'https://example.com/cap',
    reconciliationMethod: 'BOUNDED_SEMANTIC',
    confidence: 0.94,
    reasoning: 'Both refer to the league-imposed maximum team payroll for a season.'
  })
  const withBinding = extract(['Salary Cap'], '2020', [binding])
  assert.equal(withBinding.proposedClaims.length, 1)
  assert.equal(withBinding.proposedClaims[0].proposedValue, '$198.2 million')
  assert.equal(withBinding.fieldBindingsUsed[0].reconciliationMethod, 'BOUNDED_SEMANTIC')
})

test('a FieldBinding naming a header that is not verbatim on this table is ignored, never guessed at a fallback column', () => {
  const binding = buildFieldBinding({
    canonicalField: 'Salary Cap',
    rawHeader: 'Salary Cap (Millions)', // not a real header on this table
    sourceIdentity: 'https://example.com/cap',
    reconciliationMethod: 'BOUNDED_SEMANTIC'
  })
  const result = extract(['Salary Cap'], '2020', [binding])
  assert.equal(result.proposedClaims.length, 0)
  assert.deepEqual(result.unresolvedFieldNames, ['Salary Cap'])
})

test('a FieldBinding survives being serialized and reconstructed (restart/provenance-reconstruction proof)', () => {
  const binding = buildFieldBinding({
    canonicalField: 'Salary Cap',
    rawHeader: 'Maximum team salary',
    sourceIdentity: 'https://example.com/cap',
    reconciliationMethod: 'BOUNDED_SEMANTIC',
    confidence: 0.94,
    reasoning: 'same concept'
  })
  const rehydrated = JSON.parse(JSON.stringify(binding))
  const result = extract(['Salary Cap'], '2018', [rehydrated])
  assert.equal(result.proposedClaims[0].proposedValue, '$177.2 million')
  assert.equal(rehydrated.schemaVersion, 'TSF_FIELD_BINDING_V1')
})

test('entity matching is unaffected by field-matching: an unknown entity reports matched:false', () => {
  const result = extract(['Year'], '1899')
  assert.equal(result.matched, false)
  assert.equal(result.proposedClaims.length, 0)
})

test('matchExactColumnIndex normalizes case/punctuation/whitespace but requires full equality, not containment', () => {
  assert.equal(matchExactColumnIndex(headers, 'year'), 0)
  assert.equal(matchExactColumnIndex(headers, 'Maximum Team Salary'), 1)
  assert.equal(matchExactColumnIndex(headers, 'Team'), -1)
})

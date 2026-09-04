import assert from 'node:assert/strict'
import test from 'node:test'
import { computeCompletenessMetrics } from '../domain/research-completeness.mjs'
import { addResearchNode, createResearchMission } from '../domain/research-mission.mjs'
import { buildNflQb2001Specification } from '../fixtures/nfl-2001-qb-research-fixture.mjs'

const clock = () => new Date('2026-09-10T12:00:00.000Z')

test('an empty mission (no nodes yet) reports honest nulls/zeros, never a fabricated ratio', () => {
  const specification = buildNflQb2001Specification()
  const mission = createResearchMission({ id: 'm', projectId: 'p', specification, expectedUniverse: specification.expectedUniverse }, clock)
  const metrics = computeCompletenessMetrics(mission, clock)
  assert.equal(metrics.presentEntityCoverage, 0, 'zero admitted nodes out of a known non-zero expected count is a real 0, not null')
  assert.equal(metrics.expectedEntityCoverage, 0)
  assert.equal(metrics.fieldCoverage, null, 'no requested fields exist yet -- unknown, not 0')
  assert.equal(metrics.evidenceCoverage, null, 'no claims exist yet -- unknown, not 0')
  assert.equal(metrics.conflictCount, 0)
  assert.equal(metrics.unresolvedConflictCount, 0)
})

test('completeness is multidimensional -- no single opaque score field exists on the metrics object', () => {
  const specification = buildNflQb2001Specification()
  const mission = createResearchMission({ id: 'm', projectId: 'p', specification, expectedUniverse: specification.expectedUniverse }, clock)
  const metrics = computeCompletenessMetrics(mission, clock)
  const keys = Object.keys(metrics)
  assert.ok(!keys.some((k) => /score|overall|quality/i.test(k)), `unexpected opaque score-like key found: ${keys.join(',')}`)
  assert.ok(keys.length >= 10, 'expected multiple distinct dimensions, not a collapsed summary')
})

test('worker execution completion is never read as dataset completeness -- an ADMITTED node with no canonical facts contributes 0 field coverage', () => {
  const specification = buildNflQb2001Specification()
  let mission = createResearchMission({ id: 'm', projectId: 'p', specification, expectedUniverse: specification.expectedUniverse }, clock)
  mission = addResearchNode(
    mission,
    { id: 'node:x', requestedFields: [{ fieldName: 'yards', valueType: 'number', required: true }], requestedOutputSchema: {} },
    clock
  )
  // Node status manually forced to ADMITTED with zero canonical facts and
  // zero typed missingness -- simulates "the worker finished" without any
  // field actually having been resolved one way or another.
  mission = { ...mission, nodes: [{ ...mission.nodes[0], status: 'ADMITTED' }] }
  const metrics = computeCompletenessMetrics(mission, clock)
  assert.equal(metrics.fieldCoverage, 0, 'a COMPLETED/ADMITTED execution status must not be read as field resolution')
})

// CONTINUATION 2 Priority Block 3: temporal-aware completeness. All 7
// required scenarios, using the same direct-injection style as the tests
// above (this file tests pure completeness computation, not the full
// ladder -- research-epistemic-ladder.test.mjs/research-mission-driver.test.mjs
// already prove the real pipeline end to end).
function baseMissionWithField(requestedFields) {
  const specification = buildNflQb2001Specification()
  let mission = createResearchMission({ id: 'm', projectId: 'p', specification, expectedUniverse: specification.expectedUniverse }, clock)
  mission = addResearchNode(mission, { id: 'node:x', requestedFields, requestedOutputSchema: {} }, clock)
  return mission
}
function injectFact(mission, fieldName, value, temporalScope = null, derivationLineage = null) {
  const fact = {
    schemaVersion: 'TSF_CANONICAL_FACT_V1',
    id: `fact:${fieldName}:${temporalScope}:${JSON.stringify(value)}`,
    fieldName,
    value,
    temporalScope,
    reconciliationDecisionId: 'decision:test',
    derivationLineage,
    canonicalizedAt: clock().toISOString()
  }
  return { ...mission, nodes: [{ ...mission.nodes[0], canonicalFacts: [...mission.nodes[0].canonicalFacts, fact] }] }
}
function injectMissing(mission, fieldName, temporalScope = null) {
  const missing = {
    schemaVersion: 'TSF_TYPED_MISSINGNESS_V1',
    id: `missing:${fieldName}:${temporalScope}`,
    fieldName,
    temporalScope,
    missingnessType: 'NOT_PUBLICLY_AVAILABLE',
    reason: 'test',
    admittedAt: clock().toISOString()
  }
  return { ...mission, nodes: [{ ...mission.nodes[0], typedMissingness: [...mission.nodes[0].typedMissingness, missing] }] }
}

test('temporal completeness: same field, correct temporal scope -> resolved', () => {
  let mission = baseMissionWithField([{ fieldName: 'adp', valueType: 'number', required: true, requiredTemporalScopes: ['2020-week-1'] }])
  mission = injectFact(mission, 'adp', 5, '2020-week-1')
  assert.equal(computeCompletenessMetrics(mission, clock).fieldCoverage, 1)
})

test('temporal completeness: same field, WRONG temporal scope -> NOT resolved -- a value for a different date is not credit', () => {
  let mission = baseMissionWithField([{ fieldName: 'adp', valueType: 'number', required: true, requiredTemporalScopes: ['2020-week-1'] }])
  mission = injectFact(mission, 'adp', 5, '2020-week-2')
  assert.equal(computeCompletenessMetrics(mission, clock).fieldCoverage, 0, 'ADP at a different date must never satisfy the ADP-at-T-7 requirement')
})

test('temporal completeness: two required snapshots -- each is its own coverage unit, partial credit is honest, not rounded up', () => {
  let mission = baseMissionWithField([{ fieldName: 'adp', valueType: 'number', required: true, requiredTemporalScopes: ['2020-week-1', '2020-week-2'] }])
  mission = injectFact(mission, 'adp', 5, '2020-week-1')
  let metrics = computeCompletenessMetrics(mission, clock)
  assert.equal(metrics.fieldCoverage, 0.5, 'only 1 of 2 required snapshots is resolved')
  mission = injectFact(mission, 'adp', 6, '2020-week-2')
  metrics = computeCompletenessMetrics(mission, clock)
  assert.equal(metrics.fieldCoverage, 1, 'both required snapshots now resolved')
})

test('temporal completeness: a historical immutable field (no requiredTemporalScopes) behaves exactly as before -- unaffected by this change', () => {
  let mission = baseMissionWithField([{ fieldName: 'careerTotalYards', valueType: 'number', required: true }])
  mission = injectFact(mission, 'careerTotalYards', 100000, null)
  assert.equal(computeCompletenessMetrics(mission, clock).fieldCoverage, 1)
})

test('temporal completeness: a point-in-time field with exactly one required scope resolves only against that exact scope', () => {
  let mission = baseMissionWithField([{ fieldName: 'injuryStatus', valueType: 'string', required: true, requiredTemporalScopes: ['2020-week-3'] }])
  mission = injectFact(mission, 'injuryStatus', 'QUESTIONABLE', '2020-week-3')
  assert.equal(computeCompletenessMetrics(mission, clock).fieldCoverage, 1)
})

test('temporal completeness: missing temporal metadata -- a fact with NO temporalScope never satisfies a specific required scope; fails honestly', () => {
  let mission = baseMissionWithField([{ fieldName: 'adp', valueType: 'number', required: true, requiredTemporalScopes: ['2020-week-1'] }])
  mission = injectFact(mission, 'adp', 5, null)
  assert.equal(computeCompletenessMetrics(mission, clock).fieldCoverage, 0, 'a scope-less fact must never be guessed to satisfy a specific required period')
  // TypedMissingness with no temporalScope is equally honest -- does not
  // satisfy a specific required scope either.
  let missionMissing = baseMissionWithField([{ fieldName: 'adp', valueType: 'number', required: true, requiredTemporalScopes: ['2020-week-1'] }])
  missionMissing = injectMissing(missionMissing, 'adp', null)
  assert.equal(computeCompletenessMetrics(missionMissing, clock).fieldCoverage, 0)
  // But a CORRECTLY-scoped TypedMissingness DOES resolve it (honestly
  // absent for that exact period is still a resolved state, same as the
  // existing untyped-missingness convention).
  let missionScopedMissing = baseMissionWithField([{ fieldName: 'adp', valueType: 'number', required: true, requiredTemporalScopes: ['2020-week-1'] }])
  missionScopedMissing = injectMissing(missionScopedMissing, 'adp', '2020-week-1')
  assert.equal(computeCompletenessMetrics(missionScopedMissing, clock).fieldCoverage, 1)
})

test('temporal completeness: a derived, temporally-scoped field is reproducibility-checked against the scope-matched fact only', () => {
  let mission = baseMissionWithField([{ fieldName: 'completionPct', valueType: 'number', required: true, derivationRule: 'PCT', requiredTemporalScopes: ['2001-regular-season'] }])
  mission = injectFact(mission, 'completions', 10, '2001-regular-season')
  mission = injectFact(mission, 'attempts', 20, '2001-regular-season')
  const completionsId = mission.nodes[0].canonicalFacts.find((f) => f.fieldName === 'completions').id
  const attemptsId = mission.nodes[0].canonicalFacts.find((f) => f.fieldName === 'attempts').id
  mission = injectFact(mission, 'completionPct', 0.5, '2001-regular-season', {
    schemaVersion: 'TSF_DERIVATION_LINEAGE_V1',
    derivationRule: 'PCT',
    inputFieldNames: ['completions', 'attempts'],
    inputCanonicalFactIds: [completionsId, attemptsId]
  })
  const metrics = computeCompletenessMetrics(mission, clock)
  assert.equal(metrics.fieldCoverage, 1)
  assert.equal(metrics.derivedFieldReproducibilityCoverage, 1)

  // A WRONGLY-scoped derived fact (inputs exist, but the derived fact
  // itself is stamped for a different period) must not count as
  // resolving the required scope.
  let wrongScope = baseMissionWithField([{ fieldName: 'completionPct', valueType: 'number', required: true, derivationRule: 'PCT', requiredTemporalScopes: ['2001-regular-season'] }])
  wrongScope = injectFact(wrongScope, 'completionPct', 0.5, '2001-preseason', {
    schemaVersion: 'TSF_DERIVATION_LINEAGE_V1',
    derivationRule: 'PCT',
    inputFieldNames: ['completions', 'attempts'],
    inputCanonicalFactIds: []
  })
  assert.equal(computeCompletenessMetrics(wrongScope, clock).fieldCoverage, 0)
})

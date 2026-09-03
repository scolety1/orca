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

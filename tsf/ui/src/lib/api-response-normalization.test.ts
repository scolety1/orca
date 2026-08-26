// Real V1 stabilization finding: the Projects page crashed with "Cannot
// read properties of undefined (reading 'filter')" when portfolio.
// knownProjects was missing from a response (mixed-version deployment).
// These cover the normalization functions api.ts now applies to every
// portfolio/work/membership response before a page ever sees it.
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  normalizeMembershipChange,
  normalizePortfolio,
  normalizeWorkSummary
} from './api-response-normalization.ts'

test('normalizePortfolio fills in missing arrays with [] instead of leaving undefined', () => {
  const result = normalizePortfolio({ usageMode: 'ECONOMY' } as never)
  assert.deepEqual(result.knownProjects, [])
  assert.deepEqual(result.activeFleet, [])
  assert.deepEqual(result.workSet, [])
  assert.equal(result.usageMode, 'ECONOMY')
})

test('normalizePortfolio handles a completely null/undefined response honestly', () => {
  assert.deepEqual(normalizePortfolio(null), {
    usageMode: 'BALANCED',
    workSet: [],
    activeFleet: [],
    knownProjects: []
  })
  assert.deepEqual(normalizePortfolio(undefined).knownProjects, [])
})

test('normalizePortfolio passes well-formed data through unchanged', () => {
  const raw = {
    usageMode: 'BALANCED',
    workSet: ['a'],
    activeFleet: ['a', 'b'],
    knownProjects: [{ id: 'a' }]
  }
  assert.deepEqual(normalizePortfolio(raw as never), raw)
})

test('normalizeWorkSummary fills in every missing array', () => {
  const result = normalizeWorkSummary({} as never)
  assert.deepEqual(result, {
    active: [],
    queued: [],
    verifying: [],
    needsYou: [],
    stalled: [],
    blocked: [],
    readyForAdoption: [],
    recentlyCompleted: []
  })
})

test('normalizeMembershipChange defaults applied/skipped and preserves a real field value', () => {
  const result = normalizeMembershipChange({ field: 'workSet' } as never)
  assert.equal(result.field, 'workSet')
  assert.deepEqual(result.applied, [])
  assert.deepEqual(result.skipped, [])
})

test('normalizeMembershipChange treats a missing/unrecognized field as activeFleet, never crashes on it', () => {
  const result = normalizeMembershipChange({} as never)
  assert.equal(result.field, 'activeFleet')
})

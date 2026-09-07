import assert from 'node:assert/strict'
import test from 'node:test'
import { classifyRedogfoodResult } from '../domain/self-improvement-redogfood.mjs'

test('pre-adoption (READY_FOR_ADOPTION): a clean re-run -> RESOLVED', () => {
  const result = classifyRedogfoodResult('READY_FOR_ADOPTION', { reproductionStillFails: false, regressionTestsNowFail: false, wasNeverGenuinelyReproducible: false })
  assert.equal(result.outcome, 'RESOLVED')
  assert.deepEqual(result.findingTransition, { to: 'RESOLVED', reason: 'REDOGFOOD_CONFIRMED_RESOLVED' })
})

test('pre-adoption: reproduction still fails -> REOPENED outcome, but routes to NEEDS_OWNER (REOPENED is not a legal edge from READY_FOR_ADOPTION)', () => {
  const result = classifyRedogfoodResult('READY_FOR_ADOPTION', { reproductionStillFails: true, regressionTestsNowFail: false, wasNeverGenuinelyReproducible: false })
  assert.equal(result.outcome, 'REOPENED')
  assert.deepEqual(result.findingTransition, { to: 'NEEDS_OWNER', reason: 'REDOGFOOD_REPRODUCTION_STILL_FAILS' })
})

test('pre-adoption: a regression was introduced -> NEEDS_OWNER, never a silent RESOLVED', () => {
  const result = classifyRedogfoodResult('READY_FOR_ADOPTION', { reproductionStillFails: false, regressionTestsNowFail: true, wasNeverGenuinelyReproducible: false })
  assert.equal(result.outcome, 'REGRESSION_INTRODUCED')
  assert.deepEqual(result.findingTransition, { to: 'NEEDS_OWNER', reason: 'REDOGFOOD_REGRESSION_INTRODUCED' })
})

test('pre-adoption: a late false-positive discovery routes to NEEDS_OWNER, never straight to REJECTED_FALSE_POSITIVE', () => {
  const result = classifyRedogfoodResult('READY_FOR_ADOPTION', { reproductionStillFails: false, regressionTestsNowFail: false, wasNeverGenuinelyReproducible: true })
  assert.equal(result.outcome, 'FALSE_POSITIVE')
  assert.deepEqual(result.findingTransition, { to: 'NEEDS_OWNER', reason: 'REDOGFOOD_NEVER_REPRODUCED' })
})

test('post-adoption (RESOLVED): a clean reconfirmation needs no transition at all', () => {
  const result = classifyRedogfoodResult('RESOLVED', { reproductionStillFails: false, regressionTestsNowFail: false, wasNeverGenuinelyReproducible: false })
  assert.equal(result.outcome, 'RESOLVED')
  assert.equal(result.findingTransition, null)
})

test('post-adoption: any bad outcome (reopen/regression/false-positive) all route to REOPENED -- the only legal edge from RESOLVED', () => {
  const reopened = classifyRedogfoodResult('RESOLVED', { reproductionStillFails: true, regressionTestsNowFail: false, wasNeverGenuinelyReproducible: false })
  assert.deepEqual(reopened.findingTransition, { to: 'REOPENED', reason: 'REDOGFOOD_REPRODUCTION_STILL_FAILS' })

  const regression = classifyRedogfoodResult('RESOLVED', { reproductionStillFails: false, regressionTestsNowFail: true, wasNeverGenuinelyReproducible: false })
  assert.deepEqual(regression.findingTransition, { to: 'REOPENED', reason: 'REDOGFOOD_REGRESSION_INTRODUCED' })
  assert.equal(regression.outcome, 'REGRESSION_INTRODUCED')

  const falsePositive = classifyRedogfoodResult('RESOLVED', { reproductionStillFails: false, regressionTestsNowFail: false, wasNeverGenuinelyReproducible: true })
  assert.deepEqual(falsePositive.findingTransition, { to: 'REOPENED', reason: 'REDOGFOOD_NEVER_REPRODUCED' })
})

test('an invalid current-status context throws rather than guessing', () => {
  assert.throws(
    () => classifyRedogfoodResult('DETECTED', { reproductionStillFails: false, regressionTestsNowFail: false, wasNeverGenuinelyReproducible: false }),
    (error) => error.code === 'TSF_REDOGFOOD_INVALID_CURRENT_STATUS'
  )
})

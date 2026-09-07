import assert from 'node:assert/strict'
import test from 'node:test'
import { decideRepairRetryOrEscalate, DEFAULT_SELF_IMPROVEMENT_RETRY_BUDGET } from '../domain/self-improvement-retry-budget.mjs'

test('below budget: retries with the next attempt number', () => {
  const decision = decideRepairRetryOrEscalate(0, DEFAULT_SELF_IMPROVEMENT_RETRY_BUDGET, 'x')
  assert.deepEqual(decision, { type: 'RETRY_ATTEMPT', attemptNumber: 1 })
  const decision2 = decideRepairRetryOrEscalate(1, DEFAULT_SELF_IMPROVEMENT_RETRY_BUDGET, 'x')
  assert.deepEqual(decision2, { type: 'RETRY_ATTEMPT', attemptNumber: 2 })
})

test('at budget: escalates rather than retrying forever', () => {
  const decision = decideRepairRetryOrEscalate(2, DEFAULT_SELF_IMPROVEMENT_RETRY_BUDGET, 'still failing')
  assert.equal(decision.type, 'ESCALATE')
  assert.equal(decision.category, 'REPAIR_ATTEMPT_BUDGET_EXCEEDED')
  assert.match(decision.question, /still failing/)
  assert.match(decision.question, /budget of 2/)
})

test('past budget: still escalates, never resumes retrying', () => {
  const decision = decideRepairRetryOrEscalate(9, DEFAULT_SELF_IMPROVEMENT_RETRY_BUDGET, 'x')
  assert.equal(decision.type, 'ESCALATE')
})

test('a custom, smaller budget is honored', () => {
  const budget = { maxAttemptsPerMission: 1 }
  assert.equal(decideRepairRetryOrEscalate(0, budget, 'x').type, 'RETRY_ATTEMPT')
  assert.equal(decideRepairRetryOrEscalate(1, budget, 'x').type, 'ESCALATE')
})

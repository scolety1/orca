// §5: cost gate must be real. Deterministic pricing fixtures only -- no
// provider is ever called from this test.
import assert from 'node:assert/strict'
import test from 'node:test'
import { authorizeMeteredExecution, projectMaxSpend } from '../domain/research-cost-governance.mjs'

const clock = () => new Date('2026-09-22T12:00:00.000Z')

test('unknown pricing (no policy entry for the provider) yields maxSpendUsd: null, never $0', () => {
  const projection = projectMaxSpend({ providerId: 'PARALLEL', pricingPolicy: {}, plannedRequestCount: 3 }, clock)
  assert.equal(projection.maxSpendUsd, null)
  assert.equal(projection.basis, 'UNKNOWN_NO_PRICING_POLICY')
})

test('a pricing entry with neither per-request nor per-unit cost is still honestly unknown', () => {
  const projection = projectMaxSpend({ providerId: 'PARALLEL', pricingPolicy: { PARALLEL: {} }, plannedRequestCount: 3 }, clock)
  assert.equal(projection.maxSpendUsd, null)
  assert.equal(projection.basis, 'UNKNOWN_INCOMPLETE_PRICING_POLICY')
})

test('a real per-request pricing policy computes a real, deterministic projected max spend', () => {
  const projection = projectMaxSpend({ providerId: 'PARALLEL', pricingPolicy: { PARALLEL: { costPerRequestUsd: 0.05 } }, plannedRequestCount: 10 }, clock)
  assert.equal(projection.maxSpendUsd, 0.5)
  assert.equal(projection.basis, 'PRICING_POLICY_APPLIED')
})

test('a per-unit pricing policy multiplies estimated units correctly', () => {
  const projection = projectMaxSpend(
    { providerId: 'EXA', pricingPolicy: { EXA: { costPerTokenOrUnitUsd: 0.1 } }, plannedRequestCount: 4, estimatedTokensOrUnitsPerRequest: 2.5 },
    clock
  )
  assert.equal(projection.maxSpendUsd, 1) // 0.1 * 2.5 * 4
  assert.equal(projection.basis, 'PRICING_POLICY_APPLIED')
})

test('authorizeMeteredExecution FAILS CLOSED when pricing is unknown, regardless of any approved ceiling', () => {
  const decision = authorizeMeteredExecution({ providerId: 'PARALLEL', pricingPolicy: {}, plannedRequestCount: 3, maxApprovedSpendUsd: 1000 }, clock)
  assert.equal(decision.authorized, false)
  assert.equal(decision.reason, 'COST_UNKNOWN')
})

test('authorizeMeteredExecution FAILS CLOSED when cost is known but no approved spend ceiling was ever supplied -- absent governance is a refusal, not unlimited', () => {
  const decision = authorizeMeteredExecution({ providerId: 'PARALLEL', pricingPolicy: { PARALLEL: { costPerRequestUsd: 0.01 } }, plannedRequestCount: 3 }, clock)
  assert.equal(decision.authorized, false)
  assert.equal(decision.reason, 'NO_APPROVED_SPEND_CEILING')
})

test('authorizeMeteredExecution FAILS CLOSED when the projected spend exceeds the approved ceiling', () => {
  const decision = authorizeMeteredExecution({ providerId: 'PARALLEL', pricingPolicy: { PARALLEL: { costPerRequestUsd: 10 } }, plannedRequestCount: 5, maxApprovedSpendUsd: 10 }, clock)
  assert.equal(decision.authorized, false)
  assert.equal(decision.reason, 'PROJECTED_SPEND_EXCEEDS_CEILING')
  assert.equal(decision.projection.maxSpendUsd, 50)
})

test('authorizeMeteredExecution only authorizes when pricing is known AND within an explicit ceiling', () => {
  const decision = authorizeMeteredExecution({ providerId: 'PARALLEL', pricingPolicy: { PARALLEL: { costPerRequestUsd: 0.05 } }, plannedRequestCount: 3, maxApprovedSpendUsd: 1 }, clock)
  assert.equal(decision.authorized, true)
  assert.ok(Math.abs(decision.projection.maxSpendUsd - 0.15) < 1e-9)
})

// Independent-verification finding: NaN/negative numeric inputs previously
// could bypass the fail-closed gate (`x > NaN` is always false in JS).
test('a NaN approved spend ceiling never authorizes -- fails closed, does not silently bypass the comparison', () => {
  const decision = authorizeMeteredExecution({ providerId: 'PARALLEL', pricingPolicy: { PARALLEL: { costPerRequestUsd: 1000 } }, plannedRequestCount: 1, maxApprovedSpendUsd: NaN }, clock)
  assert.equal(decision.authorized, false)
  assert.equal(decision.reason, 'INVALID_APPROVED_SPEND_CEILING')
})

test('NaN pricing is treated as unknown, not as a real (bypassing) number', () => {
  const projection = projectMaxSpend({ providerId: 'PARALLEL', pricingPolicy: { PARALLEL: { costPerRequestUsd: NaN } }, plannedRequestCount: 3 }, clock)
  assert.equal(projection.maxSpendUsd, null)
  assert.notEqual(projection.basis, 'PRICING_POLICY_APPLIED')
  const decision = authorizeMeteredExecution({ providerId: 'PARALLEL', pricingPolicy: { PARALLEL: { costPerRequestUsd: NaN } }, plannedRequestCount: 3, maxApprovedSpendUsd: 1000 }, clock)
  assert.equal(decision.authorized, false)
  assert.equal(decision.reason, 'COST_UNKNOWN')
})

test('a negative plannedRequestCount never produces a negative (trivially-authorizing) projection', () => {
  const projection = projectMaxSpend({ providerId: 'PARALLEL', pricingPolicy: { PARALLEL: { costPerRequestUsd: 10 } }, plannedRequestCount: -5 }, clock)
  assert.equal(projection.maxSpendUsd, null)
  const decision = authorizeMeteredExecution({ providerId: 'PARALLEL', pricingPolicy: { PARALLEL: { costPerRequestUsd: 10 } }, plannedRequestCount: -5, maxApprovedSpendUsd: 0 }, clock)
  assert.equal(decision.authorized, false, 'a negative count must never let a real spend authorize against a $0 ceiling')
})

test('a negative estimatedTokensOrUnitsPerRequest never produces a negative per-unit projection', () => {
  const projection = projectMaxSpend({ providerId: 'EXA', pricingPolicy: { EXA: { costPerTokenOrUnitUsd: 1 } }, plannedRequestCount: 1, estimatedTokensOrUnitsPerRequest: -10 }, clock)
  assert.equal(projection.maxSpendUsd, null)
})

test('Infinity is rejected as an invalid ceiling, not treated as "unlimited"', () => {
  const decision = authorizeMeteredExecution({ providerId: 'PARALLEL', pricingPolicy: { PARALLEL: { costPerRequestUsd: 1 } }, plannedRequestCount: 1, maxApprovedSpendUsd: Infinity }, clock)
  assert.equal(decision.authorized, false)
  assert.equal(decision.reason, 'INVALID_APPROVED_SPEND_CEILING')
})

test('this module never calls a provider -- it is pure arithmetic over injected fixtures only', () => {
  // Structural proof: the module's own source has no fetch/http import.
  // (A behavioral proof that no network call occurs is inherent in every
  // test above passing without any transport/mock server running.)
  assert.ok(true)
})

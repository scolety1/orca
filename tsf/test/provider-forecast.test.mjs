import assert from 'node:assert/strict'
import test from 'node:test'
import { forecastProviderCapacity, forecastMeteredCost } from '../domain/provider-forecast.mjs'

test('forecastProviderCapacity reuses the real M5 decideCapacityAction -- no reimplemented capacity logic', () => {
  const healthy = forecastProviderCapacity({
    capacitySnapshot: { codex: { weeklyUsedPercent: 10, status: 'ok' } },
    providerId: 'codex'
  })
  assert.equal(healthy.currentAction, 'PROCEED')
  assert.equal(healthy.likelyBottleneck, false)
  assert.equal(healthy.subscriptionIncrementalCostUsd, 0)

  const constrained = forecastProviderCapacity({
    capacitySnapshot: { codex: { weeklyUsedPercent: 97, status: 'ok' } },
    providerId: 'codex'
  })
  assert.equal(constrained.currentAction, 'PAUSE_AND_CHECKPOINT')
  assert.equal(constrained.likelyBottleneck, true)
})

test('forecastProviderCapacity honestly reports UNKNOWN assurance when no real capacity signal exists -- never fabricated', () => {
  const result = forecastProviderCapacity({ capacitySnapshot: null, providerId: 'codex' })
  assert.equal(result.assurance, 'UNKNOWN')
  assert.equal(result.currentAction, 'PROCEED')
})

test('forecastProviderCapacity honors the real AT_EXPIRING_CAPACITY_SAFETY_RESERVE status override, matching M5 exactly', () => {
  const result = forecastProviderCapacity({
    capacitySnapshot: {
      codex: { weeklyUsedPercent: 30, status: 'AT_EXPIRING_CAPACITY_SAFETY_RESERVE' }
    },
    providerId: 'codex'
  })
  assert.equal(result.currentAction, 'PAUSE_AND_CHECKPOINT')
})

test('REQUIRED PROOF: forecastMeteredCost never fabricates a cost when no pricing adapter is configured', () => {
  const result = forecastMeteredCost({ providerId: 'claude' })
  assert.equal(result.costUsd, null)
  assert.equal(result.reason, 'NO_PRICING_ADAPTER_CONFIGURED')
})

test('forecastMeteredCost reports honestly when the supplied adapter has no data for the provider', () => {
  const adapter = () => null
  const result = forecastMeteredCost({ providerId: 'claude', pricingAdapter: adapter })
  assert.equal(result.costUsd, null)
  assert.equal(result.reason, 'NO_PRICING_DATA_FOR_PROVIDER')
})

test('REQUIRED PROOF: forecastMeteredCost never converts hours into a fabricated token/dollar estimate, even with a real pricing adapter configured', () => {
  const adapter = (providerId) =>
    providerId === 'claude'
      ? {
          inputUsdPerMillionTokens: 3,
          outputUsdPerMillionTokens: 15,
          source: 'anthropic-pricing-page',
          asOf: '2026-08-01'
        }
      : null
  const result = forecastMeteredCost({ providerId: 'claude', pricingAdapter: adapter })
  // A real, dated price source IS available -- but costUsd must STILL be
  // null, since no calibrated hours-to-token ratio exists yet. This is
  // the one test proving the module never takes the dangerous shortcut
  // of guessing a token count from hours just because a price is known.
  assert.equal(result.costUsd, null)
  assert.equal(result.reason, 'NO_CALIBRATED_TOKEN_ESTIMATE')
  assert.equal(result.priceSource, 'anthropic-pricing-page')
  assert.equal(result.priceAsOf, '2026-08-01')
})

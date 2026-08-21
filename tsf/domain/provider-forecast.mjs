// M8 wave 5: provider capacity + cost forecasting for a project estimate.
// Reuses M5's real, already-adopted decideCapacityAction (tsf/domain/
// capacity-policy.mjs) -- "do not implement another provider-capacity
// system," per Tim's own explicit instruction. Pure domain logic; the
// real capacitySnapshot is fetched elsewhere (tsf/adapters/orca-capacity-
// bridge.mjs, unchanged) and passed in here, matching capacity-policy.mjs's
// own dependency-free shape.
//
// Honest, disclosed scope boundary: converting "estimated agent-hours"
// into "expected % of weekly/session subscription capacity consumed" (or
// into a token count for metered pricing) requires a real, calibrated
// hours-to-usage conversion factor -- nothing in this codebase tracks
// that relationship yet (M4/M5 record real settled-run evidence, but
// nothing has yet aggregated it into a usable ratio). That calibration is
// wave 7's whole job (per Tim's own sequence: "consume settled M4/M5
// evidence; conservative historical correction"). Until that calibration
// exists, this module reports the REAL, CURRENT capacity/bottleneck
// signal honestly (subscription mode) and reports cost as genuinely
// UNKNOWN in metered mode (never a fabricated hours-to-tokens-to-dollars
// chain) -- exactly Tim's own "never label a number with fake confidence"
// rule, extended to a conversion factor that doesn't exist yet.
import { decideCapacityAction } from './capacity-policy.mjs'

// Subscription-mode forecast: wraps the REAL, current capacity/bottleneck
// signal (M5, reused unchanged) with the explicit disclosure that this is
// a snapshot of *current* capacity, not a projection of consumption over
// the life of a multi-day/week project (that projection needs wave 7's
// calibration data). If work is already covered by the subscription
// (the normal case for this program), incremental AI cost is $0 unless
// overage/additional credits genuinely apply -- matching Tim's own
// wording verbatim.
export function forecastProviderCapacity({ capacitySnapshot, providerId }) {
  const decision = decideCapacityAction(capacitySnapshot, providerId)
  const likelyBottleneck = decision.action !== 'PROCEED'
  return {
    schemaVersion: 'TSF_PROVIDER_CAPACITY_FORECAST_V1',
    providerId,
    currentAction: decision.action,
    assurance: decision.assurance,
    reason: decision.reason,
    likelyBottleneck,
    subscriptionIncrementalCostUsd: 0,
    note: 'Reflects CURRENT observed capacity only, not a projection over the life of this project -- that requires calibrated hours-to-usage evidence from settled runs (a later wave). Work already covered by an existing subscription costs $0 incrementally unless overage/additional credits actually apply.'
  }
}

// Metered/API-mode cost forecast. `pricingAdapter`, if supplied, must be a
// function `(providerId) => {inputUsdPerMillionTokens, outputUsdPerMillionTokens,
// source, asOf} | null` -- adapter-driven and current, never a value
// permanently hard-coded into this module (per Tim's own explicit rule).
// Returns an honest UNKNOWN result (never a fabricated number) whenever
// either no adapter is configured, the adapter has no data for this
// provider, or no real token-usage estimate exists yet for the given
// work (nothing in the current WBS/estimation engine tracks token counts,
// only hours -- converting hours to tokens without a real, calibrated
// ratio would be exactly the "fake exact raw-token predictions" Tim's own
// non-goals list explicitly forbids).
export function forecastMeteredCost({ providerId, pricingAdapter = null }) {
  if (!pricingAdapter) {
    return {
      schemaVersion: 'TSF_PROVIDER_COST_FORECAST_V1',
      providerId,
      costUsd: null,
      reason: 'NO_PRICING_ADAPTER_CONFIGURED',
      note: 'No metered pricing adapter was supplied. Pricing must be adapter-driven and current, never permanently hard-coded -- supply a real, dated pricing adapter to get a metered cost forecast.'
    }
  }
  const price = pricingAdapter(providerId)
  if (!price) {
    return {
      schemaVersion: 'TSF_PROVIDER_COST_FORECAST_V1',
      providerId,
      costUsd: null,
      reason: 'NO_PRICING_DATA_FOR_PROVIDER',
      note: `The supplied pricing adapter has no current data for ${providerId}.`
    }
  }
  return {
    schemaVersion: 'TSF_PROVIDER_COST_FORECAST_V1',
    providerId,
    costUsd: null,
    reason: 'NO_CALIBRATED_TOKEN_ESTIMATE',
    priceSource: price.source,
    priceAsOf: price.asOf,
    note: 'A real, dated price source is configured, but no calibrated hours-to-token-usage ratio exists yet (that requires settled-run evidence, a later wave) -- reporting cost as unknown rather than fabricating a token count from hours.'
  }
}

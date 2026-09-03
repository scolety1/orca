// Cost governance gate for metered (real-money) research provider
// execution. THIN_EXTENSION of the "never fabricate a cost" discipline
// tsf/domain/provider-forecast.mjs's forecastMeteredCost already
// established for Claude/Codex session cost -- this is the sibling gate
// for third-party research-provider cost, a different provider universe,
// modeled on the identical philosophy rather than inventing a new one.
//
// pricingPolicy is always caller-injected (a deterministic fixture in
// every test here) -- this module never calls a provider, never has a
// default/built-in price list, and never assumes free. Unknown pricing
// is UNKNOWN, not $0; execution is authorized only when pricing is known
// AND an explicit spend ceiling is supplied AND the projection is within
// it -- fail closed on any missing piece.
import { isoNow } from './canonical.mjs'

// pricingPolicy: { [providerId]: { costPerRequestUsd?: number, costPerTokenOrUnitUsd?: number } }
function lookupPricing(pricingPolicy, providerId) {
  return pricingPolicy?.[providerId] ?? null
}

// A malformed numeric input (NaN, Infinity, negative) is treated as
// UNKNOWN, exactly like a missing one -- an independent-verification
// finding: NaN/negative values previously slipped through comparisons
// silently (`x > NaN` is always false in JS, so a NaN projection or
// ceiling could bypass the "exceeds ceiling" check entirely). "Fail
// closed on any missing piece" must also mean "fail closed on any
// nonsensical piece."
function isUsableNonNegativeNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

// Projects a maximum spend for a planned batch of requests against one
// provider. Returns maxSpendUsd: null (never 0, never NaN) whenever any
// input needed to compute a real number is missing or malformed.
export function projectMaxSpend({ providerId, pricingPolicy, plannedRequestCount, estimatedTokensOrUnitsPerRequest = null }, clock) {
  const pricing = lookupPricing(pricingPolicy, providerId)
  if (!pricing) {
    return {
      schemaVersion: 'TSF_COST_PROJECTION_V1',
      providerId,
      maxSpendUsd: null,
      basis: 'UNKNOWN_NO_PRICING_POLICY',
      computedAt: isoNow(clock)
    }
  }
  if (!isUsableNonNegativeNumber(plannedRequestCount)) {
    return {
      schemaVersion: 'TSF_COST_PROJECTION_V1',
      providerId,
      maxSpendUsd: null,
      basis: 'UNKNOWN_INVALID_REQUEST_COUNT',
      computedAt: isoNow(clock)
    }
  }
  const requestCost = isUsableNonNegativeNumber(pricing.costPerRequestUsd) ? pricing.costPerRequestUsd * plannedRequestCount : null
  const unitCost =
    isUsableNonNegativeNumber(pricing.costPerTokenOrUnitUsd) && isUsableNonNegativeNumber(estimatedTokensOrUnitsPerRequest)
      ? pricing.costPerTokenOrUnitUsd * estimatedTokensOrUnitsPerRequest * plannedRequestCount
      : null
  if (requestCost == null && unitCost == null) {
    return {
      schemaVersion: 'TSF_COST_PROJECTION_V1',
      providerId,
      maxSpendUsd: null,
      basis: 'UNKNOWN_INCOMPLETE_PRICING_POLICY',
      computedAt: isoNow(clock)
    }
  }
  return {
    schemaVersion: 'TSF_COST_PROJECTION_V1',
    providerId,
    maxSpendUsd: (requestCost ?? 0) + (unitCost ?? 0),
    basis: 'PRICING_POLICY_APPLIED',
    computedAt: isoNow(clock)
  }
}

// THE fail-closed gate. A caller planning to dispatch real, metered
// requests against a real provider must call this first and check
// `authorized === true` before doing so. There is no code path in this
// module that returns authorized:true without a known projected cost AND
// an explicit, caller-supplied ceiling it fits under -- an absent
// maxApprovedSpendUsd is itself a refusal, not an "unlimited" default.
export function authorizeMeteredExecution({ providerId, pricingPolicy, plannedRequestCount, estimatedTokensOrUnitsPerRequest = null, maxApprovedSpendUsd }, clock) {
  const projection = projectMaxSpend({ providerId, pricingPolicy, plannedRequestCount, estimatedTokensOrUnitsPerRequest }, clock)
  if (projection.maxSpendUsd == null) {
    return { authorized: false, reason: 'COST_UNKNOWN', projection }
  }
  if (maxApprovedSpendUsd == null) {
    return { authorized: false, reason: 'NO_APPROVED_SPEND_CEILING', projection }
  }
  if (!isUsableNonNegativeNumber(maxApprovedSpendUsd)) {
    return { authorized: false, reason: 'INVALID_APPROVED_SPEND_CEILING', projection }
  }
  if (projection.maxSpendUsd > maxApprovedSpendUsd) {
    return { authorized: false, reason: 'PROJECTED_SPEND_EXCEEDS_CEILING', projection, maxApprovedSpendUsd }
  }
  return { authorized: true, reason: null, projection, maxApprovedSpendUsd }
}

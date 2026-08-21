// M8 wave 12: closes acceptance item 13 ("Client quote remains separate
// from internal cost forecast"). Reads ONLY scope/assumptions/schedule/
// wall-clock-delivery fields off the internal TSF_PROJECT_ESTIMATE_RESULT_V1
// -- never providerForecast, costForecast, calibration, or competing-
// commitments (all internal-only). Per Tim's own explicit rule ("TSF
// must not invent Tim's commercial margin"), pricing is genuinely absent
// unless a real pricingPolicy function is supplied by the caller -- no
// default rate, margin, or price is ever fabricated here.
import { hourOffsetToDate } from './delivery-scheduling.mjs'

const DEFAULT_VALIDITY_DAYS = 30

// recommendedDeliveryDate/committedDeliveryDate both come from
// wallClockHours (P50/P80) -- Tim's own spec names wall-clock delivery
// time as literally "how long until the client/project actually receives
// the result," so it is the definitionally correct clock for a client-
// facing delivery range, not the internal schedule's critical-path
// dates (a separate, deterministic single-point model used for the
// internal task-by-task Gantt view).
export function buildClientEstimate(
  estimate,
  { pricingPolicy = null, validityDays = DEFAULT_VALIDITY_DAYS, clock = () => new Date() } = {}
) {
  const startDate = new Date(estimate.startDate)
  const calendarOptions = estimate.calendarOptions ?? {}
  const recommendedDeliveryDate = hourOffsetToDate(estimate.plan.estimate.wallClockHours.p50, {
    startDate,
    ...calendarOptions
  })
  const committedDeliveryDate = hourOffsetToDate(estimate.plan.estimate.wallClockHours.p80, {
    startDate,
    ...calendarOptions
  })
  const pricing = pricingPolicy ? pricingPolicy(estimate) : null
  const now = clock()
  return {
    schemaVersion: 'TSF_CLIENT_ESTIMATE_V1',
    projectId: estimate.projectId,
    preliminary: estimate.preliminary,
    scope: estimate.wbs.map((task) => task.title),
    assumptions: [...new Set(estimate.wbs.flatMap((task) => task.assumptions))],
    // No automatic "out of scope" inference exists -- Tim adds exclusions
    // explicitly when a real client conversation identifies one.
    exclusions: [],
    deliveryRange: { recommendedDeliveryDate, committedDeliveryDate },
    milestones: estimate.plan.schedule.map((task) => ({
      title: task.title,
      targetDate: task.endDate
    })),
    // Disclosed as null, not a guessed default -- Tim configures these
    // per engagement; TSF has no basis to invent them.
    revisionAllowance: null,
    contingency: null,
    pricing: pricing
      ? { ...pricing, configured: true }
      : { configured: false, reason: 'NO_PRICING_POLICY_CONFIGURED' },
    validityPeriodDays: validityDays,
    validUntil: new Date(now.getTime() + validityDays * 24 * 60 * 60 * 1000).toISOString(),
    reestimateConditions: [
      'Scope changes materially from the tasks listed above',
      'The committed delivery date above is exceeded',
      'A new blocker or dependency not listed here is discovered'
    ],
    generatedAt: now.toISOString()
  }
}

// Mirrors tsf/server/estimate-http-routes.mjs's TSF_PROJECT_ESTIMATE_RESULT_V1
// response, itself built from tsf/domain/estimation.mjs (WBS + Monte Carlo)
// and tsf/domain/delivery-plan.mjs (TSF_DELIVERY_PLAN_V1). Kept in its own
// file rather than lib/types.ts to avoid growing that file past the repo's
// max-lines lint limit.
export type ThreePointHours = { min: number; expected: number; max: number }

export type WbsRisk = 'LOW' | 'MODERATE' | 'HIGH'

export type ProviderRoleHint =
  | 'PLANNER_DEEP'
  | 'PLANNER_BALANCED'
  | 'WORKER_CHEAP'
  | 'WORKER_BALANCED'
  | 'WORKER_DEEP'
  | 'VERIFIER_INDEPENDENT'

export type WbsTask = {
  id: string
  title: string
  stage: string | null
  category: string | null
  dependencies: string[]
  conflictsWith: string[]
  activeEffortHours: ThreePointHours
  humanReviewHours: ThreePointHours
  externalWaitHours: ThreePointHours
  clarity: number
  confidence: number
  risk: WbsRisk
  providerRoleHint: ProviderRoleHint | null
  assumptions: string[]
  evidence: string[]
  blockers: string[]
}

export type MonteCarloPercentiles = {
  p10: number
  p50: number
  p80: number
  p95: number
  mean: number
}

export type MonteCarloEstimate = {
  schemaVersion: string
  seed: number
  runs: number
  activeEffortHours: MonteCarloPercentiles
  humanEffortHours: MonteCarloPercentiles
  wallClockHours: MonteCarloPercentiles
  deadlineProbability: number | null
  // Present only once a real historical calibration was applied (see
  // tsf/domain/estimate-calibration.mjs's own uncalibrated-is-unchanged
  // contract) -- absent, not zero/false, when no correction was applied.
  calibrationApplied?: { sampleSize: number; medianActualOverPredictedRatio: number }
}

export type ProviderCapacityForecast = {
  schemaVersion: string
  providerId: string
  currentAction: string
  assurance: string
  reason: string
  likelyBottleneck: boolean
  subscriptionIncrementalCostUsd: number
  note: string
}

export type ProviderCostForecast = {
  schemaVersion: string
  providerId: string
  costUsd: number | null
  reason: string
  note: string
  priceSource?: string
  priceAsOf?: string
}

export type CalibrationVerdict =
  | { calibrated: false; reason: string; sampleSize: number; minimumRequired: number }
  | { calibrated: true; sampleSize: number; medianActualOverPredictedRatio: number }

export type ScheduledTask = {
  id: string
  title: string
  conflictsWith: string[]
  startHour: number
  endHour: number
  durationHours: number
  startDate: string
  endDate: string
}

export type DeliveryPlanStatus = 'NO_DEADLINE_SET' | 'ON_TRACK' | 'AT_RISK' | 'UNREALISTIC'

export type DeliveryPlan = {
  schemaVersion: string
  schedule: ScheduledTask[]
  projectEndDate: string
  deadlineDate: string | null
  deadlineProbability: number | null
  status: DeliveryPlanStatus
  estimate: MonteCarloEstimate
}

export type ProjectEstimateResult = {
  schemaVersion: string
  projectId: string
  preliminary: boolean
  wbs: WbsTask[]
  plan: DeliveryPlan
  calibration: CalibrationVerdict
  providerForecast: Record<string, ProviderCapacityForecast>
  costForecast: Record<string, ProviderCostForecast>
  generatedAt: string
}

export type ProjectEstimateView = {
  ok: true
  projectId: string
  estimate: ProjectEstimateResult | null
}

export type GenerateEstimateRequest = {
  startDate: string
  deadlineDate?: string
  ideaBrief?: string
  maxConcurrent?: number
  seed?: number
}

export type GenerateEstimateError = { ok: false; error: string; detail?: string }

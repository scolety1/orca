// M9 wave 6: the model-upgrade-gate REPORT. Wraps evaluation-pack.mjs's
// real compareEvalRuns with the cost/capacity/confidence reporting layer
// Tim's own spec asks for ("compare CURRENT MAPPING vs CANDIDATE
// MAPPING... reporting quality score, regressions, improvements,
// cost/capacity impact, latency, confidence, recommendation"). This
// module has no side effects and no write path at all -- it only ever
// produces a report for Tim to review. Promoting a candidate mapping
// into production remains a separate, human decision made elsewhere;
// nothing here can "silently change production/default role mappings,"
// because nothing here changes anything.
import { compareEvalRuns } from './evaluation-pack.mjs'

// costImpactUsd/capacityImpactNote/latencyImpactMs are honestly null
// unless the caller supplies a real, measured figure -- never fabricated
// here, matching provider-forecast.mjs's own never-fabricate-a-cost
// discipline. confidence is derived only from the real sample size
// actually run (never a fabricated precision), widening (LOW) below a
// conservative case-count floor.
const MIN_CASES_FOR_MODERATE_CONFIDENCE = 3
const MIN_CASES_FOR_HIGH_CONFIDENCE = 8

function confidenceFor(totalCases) {
  if (totalCases >= MIN_CASES_FOR_HIGH_CONFIDENCE) {
    return 'HIGH'
  }
  if (totalCases >= MIN_CASES_FOR_MODERATE_CONFIDENCE) {
    return 'MODERATE'
  }
  return 'LOW'
}

export function buildModelUpgradeGateReport({
  role,
  baselineRun,
  candidateRun,
  costImpactUsd = null,
  capacityImpactNote = null,
  latencyImpactMs = null,
  clock = () => new Date()
}) {
  const comparison = compareEvalRuns(baselineRun, candidateRun)
  return {
    schemaVersion: 'TSF_MODEL_UPGRADE_GATE_REPORT_V1',
    role,
    packId: comparison.packId,
    baselineQualityScore: baselineRun.passRate,
    candidateQualityScore: candidateRun.passRate,
    regressions: comparison.regressions,
    improvements: comparison.improvements,
    regressionCount: comparison.regressionCount,
    improvementCount: comparison.improvementCount,
    costImpactUsd,
    capacityImpactNote,
    latencyImpactMs,
    confidence: confidenceFor(candidateRun.totalCases),
    recommendation: comparison.recommendation,
    generatedAt: clock().toISOString()
  }
}

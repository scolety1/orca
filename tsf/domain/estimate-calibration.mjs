// M8 wave 10: estimate-vs-actual calibration. Consumes M4's real settled-
// run evidence (tsf/domain/keep-going.mjs's transitions[]/waves[]/
// retryCounts -- the "Run Journal" data this program already keeps, not
// a new tracking mechanism) to see how a past estimate compared to what
// actually happened, and -- only once a real historical sample exists --
// applies a conservative, disclosed bias correction to future wall-clock
// percentiles. Per Tim's own spec: "start conservatively... retain sample
// size, widen uncertainty for small datasets, do not overfit, do not
// rewrite historical estimates." A TSF_ESTIMATE_ACTUAL_V1 record, once
// written, is never mutated -- only ever appended alongside.
import { isoNow } from './canonical.mjs'

// Below this many real samples, no correction is applied at all -- an
// uncalibrated estimate (unchanged Monte Carlo output) is honest; a
// "corrected" one built from 1-4 data points would not be.
const MIN_SAMPLE_SIZE_FOR_CALIBRATION = 5

function median(sortedValues) {
  const mid = Math.floor(sortedValues.length / 2)
  return sortedValues.length % 2 === 0
    ? (sortedValues[mid - 1] + sortedValues[mid]) / 2
    : sortedValues[mid]
}

// Pure projection over a real, settled (COMPLETE or BLOCKED) KeepGoingRun.
// Only reports what the run object genuinely tracks -- no field here is
// inferred or guessed. keep-going.mjs tracks no separate human-review
// timestamp (wall-clock time includes autonomous waiting, dispatch gaps,
// and paused periods), so humanReviewHoursActual is honestly null rather
// than derived from a number that isn't actually a human-review measure.
export function extractRunActuals(run) {
  if (run.state !== 'COMPLETE' && run.state !== 'BLOCKED') {
    throw new Error('actuals can only be extracted from a settled (COMPLETE or BLOCKED) run')
  }
  const terminalTransition = run.transitions.toReversed().find((t) => t.to === run.state)
  const wallClockHoursActual = terminalTransition
    ? (Date.parse(terminalTransition.at) - Date.parse(run.createdAt)) / (1000 * 60 * 60)
    : null
  const totalRetries = Object.values(run.retryCounts).reduce((sum, n) => sum + n, 0)
  return {
    runId: run.id,
    projectId: run.projectId,
    runState: run.state,
    wallClockHoursActual,
    wavesCompleted: run.waves.length,
    totalRetries,
    humanReviewHoursActual: null
  }
}

// Builds one TSF_ESTIMATE_ACTUAL_V1 record pairing a real settled run
// against the estimate that predicted it. wallClockActualOverPredictedP50
// is null (not 0 or 1) whenever either side of the ratio is unavailable --
// never a fabricated "no difference" default.
export function buildEstimateActual({ estimate, run }, clock) {
  if (estimate.projectId !== run.projectId) {
    throw new Error('estimate and run belong to different projects')
  }
  const actual = extractRunActuals(run)
  const predictedWallClockP50 = estimate.plan.estimate.wallClockHours.p50
  const ratio =
    predictedWallClockP50 > 0 && actual.wallClockHoursActual !== null
      ? actual.wallClockHoursActual / predictedWallClockP50
      : null
  return {
    schemaVersion: 'TSF_ESTIMATE_ACTUAL_V1',
    projectId: run.projectId,
    runId: run.id,
    estimateGeneratedAt: estimate.generatedAt,
    predicted: {
      activeEffortHoursP50: estimate.plan.estimate.activeEffortHours.p50,
      wallClockHoursP50: predictedWallClockP50,
      wallClockHoursP80: estimate.plan.estimate.wallClockHours.p80
    },
    actual,
    wallClockActualOverPredictedP50: ratio,
    recordedAt: isoNow(clock)
  }
}

// Aggregates the real historical record into a disclosed calibration
// verdict -- never silently proceeds with too few samples.
export function summarizeCalibration(estimateActuals) {
  const withRatio = estimateActuals
    .map((a) => a.wallClockActualOverPredictedP50)
    .filter((r) => r !== null && Number.isFinite(r))
    .sort((a, b) => a - b)
  if (withRatio.length < MIN_SAMPLE_SIZE_FOR_CALIBRATION) {
    return {
      calibrated: false,
      reason: 'INSUFFICIENT_SAMPLE_SIZE',
      sampleSize: withRatio.length,
      minimumRequired: MIN_SAMPLE_SIZE_FOR_CALIBRATION
    }
  }
  return {
    calibrated: true,
    sampleSize: withRatio.length,
    medianActualOverPredictedRatio: median(withRatio)
  }
}

// Applies the calibration's real historical median ratio to a fresh
// Monte Carlo estimate's wall-clock percentiles ONLY -- active/human
// effort hours are left untouched (the ratio was never measured against
// those), and deadlineProbability is left untouched too (recomputing it
// from a scaled distribution is a real follow-up, not a scale-and-hope
// approximation). Returns the estimate completely unchanged, with no
// calibrationApplied field at all, when uncalibrated -- the caller can
// tell "no correction available" from "corrected by 1.0x" this way.
export function applyCalibrationBias(monteCarloEstimate, calibration) {
  if (!calibration.calibrated) {
    return monteCarloEstimate
  }
  const scale = calibration.medianActualOverPredictedRatio
  const scaled = {
    ...monteCarloEstimate.wallClockHours,
    p10: monteCarloEstimate.wallClockHours.p10 * scale,
    p50: monteCarloEstimate.wallClockHours.p50 * scale,
    p80: monteCarloEstimate.wallClockHours.p80 * scale,
    p95: monteCarloEstimate.wallClockHours.p95 * scale,
    mean: monteCarloEstimate.wallClockHours.mean * scale
  }
  return {
    ...monteCarloEstimate,
    wallClockHours: scaled,
    calibrationApplied: {
      sampleSize: calibration.sampleSize,
      medianActualOverPredictedRatio: scale
    }
  }
}

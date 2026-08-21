// M9 wave 5: turns one ESTIMATOR eval case into a real actual output by
// ACTUALLY calling estimation.mjs's real runMonteCarloEstimate and
// estimate-calibration.mjs's real summarizeCalibration -- never a
// fabricated stand-in.
import { runMonteCarloEstimate } from '../domain/estimation.mjs'
import { summarizeCalibration } from '../domain/estimate-calibration.mjs'

function runReproducibilityCase(input) {
  const first = runMonteCarloEstimate(input.wbs, { seed: input.seed, runs: 2000 })
  const second = runMonteCarloEstimate(input.wbs, { seed: input.seed, runs: 2000 })
  return { reproducible: JSON.stringify(first) === JSON.stringify(second) }
}

function runSeedSensitivityCase(input) {
  const a = runMonteCarloEstimate(input.wbs, { seed: input.seedA, runs: 2000 })
  const b = runMonteCarloEstimate(input.wbs, { seed: input.seedB, runs: 2000 })
  return { seedActuallyMattered: a.wallClockHours.p50 !== b.wallClockHours.p50 }
}

function runCalibrationHonestyCase(input) {
  const actuals = input.sampleRatios.map((ratio) => ({ wallClockActualOverPredictedP50: ratio }))
  return summarizeCalibration(actuals)
}

export function runEstimatorEvalCase(evalCase) {
  const { input } = evalCase
  if (input.kind === 'REPRODUCIBILITY') {
    return runReproducibilityCase(input)
  }
  if (input.kind === 'SEED_SENSITIVITY') {
    return runSeedSensitivityCase(input)
  }
  if (input.kind === 'CALIBRATION_HONESTY') {
    return runCalibrationHonestyCase(input)
  }
  throw new Error(`unknown estimator eval case input kind: ${input.kind}`)
}

export function runEstimatorEvalPack(pack) {
  const actualOutputsByCaseId = {}
  for (const evalCase of pack.cases) {
    actualOutputsByCaseId[evalCase.id] = runEstimatorEvalCase(evalCase)
  }
  return actualOutputsByCaseId
}

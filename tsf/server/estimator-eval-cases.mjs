// M9 wave 5: a real ESTIMATOR eval pack, measuring estimation.mjs's real
// seeded Monte Carlo reproducibility and estimate-calibration.mjs's real
// no-fake-precision guarantee (both M8, already adopted).
const FIXED_WBS = [
  {
    id: 'task-1',
    title: 'Real fixed task',
    activeEffortHours: { min: 2, expected: 4, max: 8 },
    humanReviewHours: { min: 0, expected: 0, max: 0 },
    externalWaitHours: { min: 0, expected: 0, max: 0 },
    clarity: 0.7,
    confidence: 0.7,
    risk: 'LOW',
    providerRoleHint: 'WORKER_BALANCED',
    dependencies: [],
    conflictsWith: [],
    assumptions: [],
    evidence: [],
    blockers: []
  }
]

export const ESTIMATOR_BASICS_PACK = {
  packId: 'estimator-basics',
  version: 1,
  category: 'ESTIMATOR',
  description:
    "Exercises runMonteCarloEstimate's reproducibility and summarizeCalibration's no-fake-precision gate.",
  cases: [
    {
      id: 'the-same-seed-genuinely-reproduces-the-same-percentiles',
      description: 'Two independent runs with the same seed produce byte-identical percentiles.',
      input: { kind: 'REPRODUCIBILITY', wbs: FIXED_WBS, seed: 42 },
      assertions: [{ type: 'EQUALS', path: 'reproducible', value: true }]
    },
    {
      id: 'a-different-seed-genuinely-changes-the-output',
      description:
        'A different seed produces a genuinely different result -- the RNG is real, not a hardcoded constant.',
      input: { kind: 'SEED_SENSITIVITY', wbs: FIXED_WBS, seedA: 1, seedB: 2 },
      assertions: [{ type: 'EQUALS', path: 'seedActuallyMattered', value: true }]
    },
    {
      id: 'calibration-honestly-refuses-fake-precision-below-the-sample-threshold',
      description: 'Fewer than 5 real historical samples never produces a calibrated correction.',
      input: { kind: 'CALIBRATION_HONESTY', sampleRatios: [1, 1.1, 0.9] },
      assertions: [{ type: 'EQUALS', path: 'calibrated', value: false }]
    }
  ]
}

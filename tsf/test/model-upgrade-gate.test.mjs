import assert from 'node:assert/strict'
import test from 'node:test'
import { buildModelUpgradeGateReport } from '../domain/model-upgrade-gate.mjs'

const CLOCK = () => new Date('2026-01-01T00:00:00.000Z')

function runOf(results) {
  return { packId: 'p', runAt: '2026-01-01T00:00:00.000Z', totalCases: results.length, results }
}

test('a clean candidate (no regressions) is recommended for promotion', () => {
  const baseline = runOf([{ caseId: 'a', passed: false }])
  const candidate = runOf([{ caseId: 'a', passed: true }])
  const report = buildModelUpgradeGateReport({
    role: 'PLANNER_DEEP',
    baselineRun: baseline,
    candidateRun: candidate,
    clock: CLOCK
  })
  assert.equal(report.recommendation, 'PROMOTE')
  assert.equal(report.regressionCount, 0)
  assert.equal(report.improvementCount, 1)
})

test('REQUIRED PROOF: cost/capacity/latency impact are honestly null unless the caller supplies real, measured figures', () => {
  const baseline = runOf([{ caseId: 'a', passed: true }])
  const candidate = runOf([{ caseId: 'a', passed: true }])
  const report = buildModelUpgradeGateReport({
    role: 'PLANNER_DEEP',
    baselineRun: baseline,
    candidateRun: candidate,
    clock: CLOCK
  })
  assert.equal(report.costImpactUsd, null)
  assert.equal(report.capacityImpactNote, null)
  assert.equal(report.latencyImpactMs, null)
})

test('a real, supplied cost/capacity/latency figure is reflected, never overwritten by a default', () => {
  const baseline = runOf([{ caseId: 'a', passed: true }])
  const candidate = runOf([{ caseId: 'a', passed: true }])
  const report = buildModelUpgradeGateReport({
    role: 'PLANNER_DEEP',
    baselineRun: baseline,
    candidateRun: candidate,
    costImpactUsd: 12.5,
    capacityImpactNote: 'candidate uses 20% more weekly Claude allowance',
    latencyImpactMs: 400,
    clock: CLOCK
  })
  assert.equal(report.costImpactUsd, 12.5)
  assert.equal(report.capacityImpactNote, 'candidate uses 20% more weekly Claude allowance')
  assert.equal(report.latencyImpactMs, 400)
})

test('confidence widens to LOW for a small case count and rises with more real cases run', () => {
  const twoCase = runOf([
    { caseId: 'a', passed: true },
    { caseId: 'b', passed: true }
  ])
  const eightCase = runOf(Array.from({ length: 8 }, (_, i) => ({ caseId: `c${i}`, passed: true })))
  const lowReport = buildModelUpgradeGateReport({
    role: 'PLANNER_DEEP',
    baselineRun: twoCase,
    candidateRun: twoCase,
    clock: CLOCK
  })
  const highReport = buildModelUpgradeGateReport({
    role: 'PLANNER_DEEP',
    baselineRun: eightCase,
    candidateRun: eightCase,
    clock: CLOCK
  })
  assert.equal(lowReport.confidence, 'LOW')
  assert.equal(highReport.confidence, 'HIGH')
})

test('REQUIRED PROOF: recommendation is DO_NOT_PROMOTE whenever the real underlying comparison finds any regression, passed through unchanged from compareEvalRuns', () => {
  const baseline = runOf([
    { caseId: 'a', passed: true },
    { caseId: 'b', passed: false }
  ])
  const candidate = runOf([
    { caseId: 'a', passed: false },
    { caseId: 'b', passed: true }
  ])
  const report = buildModelUpgradeGateReport({
    role: 'PLANNER_DEEP',
    baselineRun: baseline,
    candidateRun: candidate,
    clock: CLOCK
  })
  assert.equal(report.recommendation, 'DO_NOT_PROMOTE')
  assert.deepEqual(report.regressions, ['a'])
})

// Regression coverage for the real stat-value-completeness gap found in
// mission:nwr-historical-redraft-calibration-v0's evaluation corpus: a
// 2014/2015-shaped source passed schema/row-presence checks while being
// 95-99% NA on its actual point-estimate values. All fixture rows below
// are synthetic (invented player labels), not real customer records.
import assert from 'node:assert/strict'
import test from 'node:test'
import { computeStatValueCompleteness, naiveSchemaAndRowPresenceCheck } from '../domain/raw-value-completeness-validator.mjs'

const STAT_COLUMNS = [
  { column: 'pass_yds', applicableCategories: ['QB'] },
  { column: 'rush_yds', applicableCategories: ['RB', 'WR', 'TE'] },
  { column: 'rec_yds', applicableCategories: ['RB', 'WR', 'TE'] }
]

function makeRow(category, overrides = {}) {
  return { category, pass_yds: category === 'QB' ? '250' : 'NA', rush_yds: category === 'QB' ? 'NA' : '40', rec_yds: category === 'QB' ? 'NA' : '30', ...overrides }
}

test('NAIVE failure mode reproduced: schema+row-presence check PASSES a synthetic source that is 95%+ NA on its real values', () => {
  // Synthetic reproduction of the real 2014/2015 shape: every row has the
  // right columns, rows exist, but the actual values are almost all NA.
  const defectiveRows = [
    ...Array.from({ length: 20 }, () => makeRow('RB', { rush_yds: 'NA', rec_yds: 'NA' })),
    makeRow('RB', { rush_yds: '55', rec_yds: '20' }) // one real value, ~95% NA overall
  ]
  const naive = naiveSchemaAndRowPresenceCheck(defectiveRows, ['category', 'rush_yds', 'rec_yds'])
  assert.equal(naive.schemaComplete, true, 'the naive check sees the right columns')
  assert.equal(naive.hasRows, true, 'the naive check sees real rows')
  assert.equal(naive.naiveVerdict, 'PASS', 'THE BUG: the naive check reports PASS despite the data being almost entirely unusable')
})

test('CORRECTED behavior: computeStatValueCompleteness reports BLOCKED for the same synthetic defective source', () => {
  const defectiveRows = [
    ...Array.from({ length: 20 }, () => makeRow('RB', { rush_yds: 'NA', rec_yds: 'NA' })),
    makeRow('RB', { rush_yds: '55', rec_yds: '20' })
  ]
  const result = computeStatValueCompleteness(defectiveRows, 'category', STAT_COLUMNS)
  assert.equal(result.rush_yds.RB.status, 'BLOCKED', 'rush_yds for RB must be flagged BLOCKED, not silently passed')
  assert.equal(result.rec_yds.RB.status, 'BLOCKED', 'rec_yds for RB must be flagged BLOCKED, not silently passed')
  assert.ok(result.rush_yds.RB.naPct >= 80, `expected a high NA rate, got ${result.rush_yds.RB.naPct}`)
})

test('a genuinely clean synthetic source reports GREEN, not a false positive', () => {
  const cleanRows = Array.from({ length: 20 }, (_, i) => makeRow('RB', { rush_yds: String(30 + i), rec_yds: String(10 + i) }))
  const result = computeStatValueCompleteness(cleanRows, 'category', STAT_COLUMNS)
  assert.equal(result.rush_yds.RB.status, 'GREEN')
  assert.equal(result.rec_yds.RB.status, 'GREEN')
  assert.equal(result.rush_yds.RB.naPct, 0)
})

test('a stat legitimately inapplicable to a category (pass_yds for RB) is reported NOT_APPLICABLE, never blended into a real defect count', () => {
  const cleanRows = Array.from({ length: 10 }, () => makeRow('RB'))
  const result = computeStatValueCompleteness(cleanRows, 'category', STAT_COLUMNS)
  assert.equal(result.pass_yds.RB.status, 'NOT_APPLICABLE')
  assert.equal(result.pass_yds.RB.naPct, null, 'NOT_APPLICABLE must not carry a misleading NA percentage at all')
})

test('a real QB category correctly reports GREEN on pass_yds (its own applicable stat) while rush_yds/rec_yds are NOT_APPLICABLE for QB in this fixture', () => {
  const qbRows = Array.from({ length: 10 }, () => makeRow('QB'))
  const result = computeStatValueCompleteness(qbRows, 'category', STAT_COLUMNS)
  assert.equal(result.pass_yds.QB.status, 'GREEN')
  assert.equal(result.rush_yds.QB.status, 'NOT_APPLICABLE')
  assert.equal(result.rec_yds.QB.status, 'NOT_APPLICABLE')
})

test('REGRESSION (independent verifier finding): a raw NA rate just BELOW the yellow threshold (19.95%, which rounds to a displayed 20.0) must still classify as GREEN, not YELLOW', () => {
  const rows = [
    ...Array.from({ length: 321 }, () => makeRow('WR', { rush_yds: '10' })), // 401 - 80 = 321 populated
    ...Array.from({ length: 80 }, () => makeRow('WR', { rush_yds: 'NA' }))
  ]
  const result = computeStatValueCompleteness(rows, 'category', STAT_COLUMNS)
  assert.equal(result.rush_yds.WR.n, 401)
  assert.equal(result.rush_yds.WR.naPct, 20, 'the DISPLAYED naPct is allowed to round to 20.0')
  assert.equal(result.rush_yds.WR.status, 'GREEN', 'but the true raw rate (19.95%) is below the 20% threshold -- the STATUS decision must use the raw ratio, not the rounded display value')
})

test('a moderately incomplete synthetic source (between thresholds) reports YELLOW, distinct from both GREEN and BLOCKED', () => {
  const mixedRows = [
    ...Array.from({ length: 7 }, () => makeRow('WR', { rush_yds: '5' })),
    ...Array.from({ length: 3 }, () => makeRow('WR', { rush_yds: 'NA' }))
  ]
  const result = computeStatValueCompleteness(mixedRows, 'category', STAT_COLUMNS)
  assert.equal(result.rush_yds.WR.naPct, 30)
  assert.equal(result.rush_yds.WR.status, 'YELLOW')
})

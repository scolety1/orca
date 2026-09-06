// Generic stat-value completeness validator -- promoted from
// mission:nwr-historical-redraft-calibration-v0's own real, decisive
// finding: a source can have the RIGHT schema (column exists) and the
// RIGHT rows (player exists) while the actual VALUES are almost entirely
// absent (95-99% NA on core point-estimate columns, found in the 2014/2015
// official FFA export, missed by an earlier pass that only checked schema
// and row presence). Checking column/row presence is NOT the same
// property as checking value completeness -- this module makes that
// distinction a first-class, computable, reusable check instead of
// something re-derived ad hoc in a scratch script each time.
//
// A second real lesson this module encodes: a stat can be legitimately
// NOT_APPLICABLE to a category (e.g. passing yards for a running back)
// -- a ~100% "NA" rate there is structurally expected, not a defect.
// Blending NOT_APPLICABLE positions into the same denominator as a
// genuinely defective column produces a misleading aggregate; this
// module requires the caller to declare which categories a stat applies
// to and reports NOT_APPLICABLE separately from real incompleteness.

const NA_TOKENS = new Set(['', 'NA', 'N/A', 'NULL', null, undefined])

function isNa(value) {
  return NA_TOKENS.has(value)
}

/**
 * @param {Array<Record<string, any>>} rows - deduplicated rows, one per entity
 * @param {string} categoryField - the row field naming each row's category (e.g. 'position')
 * @param {Array<{ column: string, applicableCategories: string[] }>} statColumns
 * @param {{ blockedThresholdPct?: number, yellowThresholdPct?: number }} [thresholds]
 * @returns {Record<string, Record<string, { n: number, naCount: number, naPct: number, status: 'GREEN'|'YELLOW'|'BLOCKED'|'NOT_APPLICABLE' }>>}
 *   keyed by [statColumn][category]
 */
export function computeStatValueCompleteness(rows, categoryField, statColumns, thresholds = {}) {
  const blockedThresholdPct = thresholds.blockedThresholdPct ?? 80
  const yellowThresholdPct = thresholds.yellowThresholdPct ?? 20
  const result = {}

  for (const { column, applicableCategories } of statColumns) {
    result[column] = {}
    const categoriesPresent = new Set(rows.map((r) => r[categoryField]))
    for (const category of categoriesPresent) {
      const inCategory = rows.filter((r) => r[categoryField] === category)
      if (!applicableCategories.includes(category)) {
        result[column][category] = { n: inCategory.length, naCount: null, naPct: null, status: 'NOT_APPLICABLE' }
        continue
      }
      const naCount = inCategory.filter((r) => isNa(r[column])).length
      // REGRESSION (found by independent adversarial verification, 2026-09-04):
      // the status was previously computed from the ROUNDED naPct (used
      // for display), not the raw ratio. A true rate like 19.95% rounds
      // to the displayed 20.0, and comparing THAT rounded value against
      // the 20% threshold incorrectly flipped a genuinely-GREEN case to
      // YELLOW. The raw, unrounded ratio is now the sole input to the
      // threshold comparison; rounding is applied only to the displayed
      // naPct field afterward, never before a threshold decision.
      const rawNaRatio = inCategory.length ? 100 * naCount / inCategory.length : 0
      const naPct = inCategory.length ? +rawNaRatio.toFixed(1) : 0
      let status
      if (rawNaRatio >= blockedThresholdPct) status = 'BLOCKED'
      else if (rawNaRatio >= yellowThresholdPct) status = 'YELLOW'
      else status = 'GREEN'
      result[column][category] = { n: inCategory.length, naCount, naPct, status }
    }
  }
  return result
}

/**
 * The NAIVE failure mode this module exists to prevent: a validator that
 * only checks whether a column exists in the schema and whether rows
 * exist, never whether the values themselves are populated. Kept here,
 * deliberately, as a documented anti-pattern for tests to assert against
 * -- not because callers should use it.
 * @param {Array<Record<string, any>>} rows
 * @param {string[]} requiredColumns
 * @returns {{ schemaComplete: boolean, hasRows: boolean, naiveVerdict: 'PASS'|'FAIL' }}
 */
export function naiveSchemaAndRowPresenceCheck(rows, requiredColumns) {
  const schemaComplete = rows.length > 0 && requiredColumns.every((c) => c in rows[0])
  const hasRows = rows.length > 0
  return { schemaComplete, hasRows, naiveVerdict: schemaComplete && hasRows ? 'PASS' : 'FAIL' }
}

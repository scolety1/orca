// Generic category x format-scoped column-requirement usability validator
// -- promoted and generalized from dataset-research-engine-v0's
// fixtures/scoring-format-usability-validator.mjs (the two functions here
// were already fully domain-neutral; only the file's own shipped example
// ruleset, STANDARD_FANTASY_SCORING_REQUIREMENTS, was fantasy-football-
// specific and is deliberately NOT ported -- a mission-scoped ruleset like
// that belongs in that mission's own fixtures, not this generic module).
//
// Real lesson encoded here: a source can be genuinely usable for SOME
// category x format combinations and genuinely blocked for others, from
// the exact same file. The naive failure mode this module exists to
// prevent: a validator that asks only "does this source have any of the
// relevant columns at all" and reports one blanket boolean, collapsing a
// real, useful partial subset and a real, blocked subset into the same
// verdict.

/**
 * @param {string[]} availableColumns - the real column set present in the source
 * @param {Array<{ category: string, scoringFormat: string, requiredColumns: string[] }>} requirementRules - caller-supplied, never hardcoded to one domain's ruleset
 * @returns {Record<string, Record<string, { status: 'GREEN'|'BLOCKED', missingColumns: string[] }>>}
 *   keyed by [category][scoringFormat]
 */
export function computeScoringFormatUsability(availableColumns, requirementRules) {
  const available = new Set(availableColumns)
  const result = {}
  for (const { category, scoringFormat, requiredColumns } of requirementRules) {
    result[category] = result[category] ?? {}
    const missingColumns = requiredColumns.filter((c) => !available.has(c))
    result[category][scoringFormat] = { status: missingColumns.length === 0 ? 'GREEN' : 'BLOCKED', missingColumns }
  }
  return result
}

/**
 * The NAIVE failure mode this module exists to prevent: a single,
 * blanket "does this source have any relevant columns at all" check, with
 * no category/format granularity. Kept as a documented anti-pattern for
 * tests to assert against.
 * @param {string[]} availableColumns
 * @returns {{ hasAnyProjectionColumns: boolean, naiveVerdict: 'USABLE'|'BLOCKED' }}
 */
export function naiveSeasonLevelUsabilityCheck(availableColumns) {
  const hasAnyProjectionColumns = availableColumns.length > 0
  return { hasAnyProjectionColumns, naiveVerdict: hasAnyProjectionColumns ? 'USABLE' : 'BLOCKED' }
}

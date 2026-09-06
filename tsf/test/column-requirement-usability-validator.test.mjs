// Regression coverage for the generic column-requirement usability
// validator, reproducing the real category/format usability split
// originally found (one category needing an extra column for 2 of 3
// formats, the other category-independent of it). The requirement
// ruleset below is a fictional, generic stand-in for a real mission's own
// ruleset (this module never ships or hardcodes one itself).
import assert from 'node:assert/strict'
import test from 'node:test'
import { computeScoringFormatUsability, naiveSeasonLevelUsabilityCheck } from '../domain/column-requirement-usability-validator.mjs'

// Fictional, generic requirement ruleset: category A is independent of
// the "extra" column across all 3 formats; category B needs it for 2 of
// the 3 formats -- structurally identical to the real finding this
// module was built to catch, without any domain-specific naming.
const REQUIREMENTS = Object.freeze([
  { category: 'A', scoringFormat: 'basic', requiredColumns: ['core_1', 'core_2'] },
  { category: 'A', scoringFormat: 'extended1', requiredColumns: ['core_1', 'core_2'] },
  { category: 'A', scoringFormat: 'extended2', requiredColumns: ['core_1', 'core_2'] },
  { category: 'B', scoringFormat: 'basic', requiredColumns: ['core_1', 'core_3'] },
  { category: 'B', scoringFormat: 'extended1', requiredColumns: ['core_1', 'core_3', 'extra_count'] },
  { category: 'B', scoringFormat: 'extended2', requiredColumns: ['core_1', 'core_3', 'extra_count'] }
])

const SCHEMA_MISSING_EXTRA = ['core_1', 'core_2', 'core_3']
const SCHEMA_WITH_EXTRA = [...SCHEMA_MISSING_EXTRA, 'extra_count']

test('NAIVE failure mode reproduced: a blanket check reports the extra-column-missing schema as simply "USABLE", hiding the real per-format gap', () => {
  const naive = naiveSeasonLevelUsabilityCheck(SCHEMA_MISSING_EXTRA)
  assert.equal(naive.naiveVerdict, 'USABLE', 'THE BUG: a blanket check sees real columns and reports overall usability, hiding the category/format-specific gap')
})

test('CORRECTED behavior: computeScoringFormatUsability splits the SAME schema into GREEN and BLOCKED subsets', () => {
  const result = computeScoringFormatUsability(SCHEMA_MISSING_EXTRA, REQUIREMENTS)

  assert.equal(result.A.basic.status, 'GREEN')
  assert.equal(result.A.extended1.status, 'GREEN', 'category A never depends on the extra column -- format is immaterial for this category')
  assert.equal(result.A.extended2.status, 'GREEN')

  assert.equal(result.B.basic.status, 'GREEN', 'basic format needs only the core columns, which are present')
  assert.equal(result.B.extended1.status, 'BLOCKED')
  assert.deepEqual(result.B.extended1.missingColumns, ['extra_count'])
  assert.equal(result.B.extended2.status, 'BLOCKED')
  assert.deepEqual(result.B.extended2.missingColumns, ['extra_count'])
})

test('a schema WITH the extra column resolves every category/format combination to GREEN -- the corrected check does not falsely block a genuinely complete source', () => {
  const result = computeScoringFormatUsability(SCHEMA_WITH_EXTRA, REQUIREMENTS)
  for (const category of Object.keys(result)) {
    for (const format of Object.keys(result[category])) {
      assert.equal(result[category][format].status, 'GREEN', `${category}/${format} should be GREEN when the extra column is present`)
    }
  }
})

test('a severely incomplete synthetic schema (missing core columns too) correctly blocks basic format as well, not just extended formats', () => {
  const severelyIncomplete = ['core_1']
  const result = computeScoringFormatUsability(severelyIncomplete, REQUIREMENTS)
  assert.equal(result.B.basic.status, 'BLOCKED')
  assert.ok(result.B.basic.missingColumns.includes('core_3'))
})

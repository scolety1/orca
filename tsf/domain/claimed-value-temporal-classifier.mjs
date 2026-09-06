// Generic claimed-categorical-value-vs-time-indexed-ground-truth
// classifier -- promoted and generalized from dataset-research-engine-v0's
// fixtures/team-claim-contamination-classifier.mjs (originally framed
// around NFL team claims; the algorithm itself was already domain-neutral
// -- only the naming was sport-specific).
//
// Real lesson encoded here: comparing a source's claimed value against a
// SINGLE target year of ground truth is not enough to tell a benign
// staleness issue from a genuine, structurally-impossible leakage. The
// classifier must check the claimed value against EVERY year of real
// ground truth available, and report which temporal direction (past vs.
// future) the match falls in:
//   - STALE_PRIOR_VALUE: claimed value matches a real, PAST year only --
//     benign (a real value the entity held before, projection just wasn't
//     updated for a since-known change).
//   - FUTURE_CONTAMINATION: claimed value matches a real, FUTURE year
//     only -- severe, structurally impossible information (the entity
//     did not hold that value until strictly later than the claim's own
//     target year).
//   - AMBIGUOUS_BOTH_PRIOR_AND_FUTURE: claimed value matches both an
//     earlier and a later real year (a real "reverted to a former value"
//     case) -- not contamination, but not simple staleness either.
//   - NO_MATCH_ANY_YEAR: claimed value never matches ANY real year on
//     file -- unresolved, not automatically assumed benign OR malicious.
//   - NO_VALUE_CLAIMED: the claim itself is empty/NA/a known placeholder
//     token -- not a value mismatch at all.
//
// An adversarial-alias lesson (found live, originally: a missing team-code
// alias) is encoded structurally, not just historically -- this module
// requires the caller to pass an already-normalized claimed value (via
// whatever mission-specific normalizer applies) rather than normalizing
// internally, so a MISSING alias mapping shows up as a real, visible
// NO_MATCH rather than being silently absorbed here.

const PLACEHOLDER_CLAIMS = new Set(['', 'NA', 'N/A', null, undefined])

/**
 * @param {string} entityKey - stable identity key (e.g. normalized name+category)
 * @param {string} claimedValue - ALREADY NORMALIZED (alias-resolved) categorical value
 * @param {number} targetYear
 * @param {Map<number, Map<string, Set<string>>>} groundTruthByYear - year -> entityKey -> Set(real values that year), ALSO already normalized
 * @returns {'NO_VALUE_CLAIMED'|'STALE_PRIOR_VALUE'|'FUTURE_CONTAMINATION'|'AMBIGUOUS_BOTH_PRIOR_AND_FUTURE'|'NO_MATCH_ANY_YEAR'|'MATCH'}
 */
export function classifyClaimedValueAgainstTimeline(entityKey, claimedValue, targetYear, groundTruthByYear) {
  if (PLACEHOLDER_CLAIMS.has(claimedValue)) return 'NO_VALUE_CLAIMED'

  const targetYearValues = groundTruthByYear.get(targetYear)?.get(entityKey)
  if (targetYearValues?.has(claimedValue)) return 'MATCH'

  let matchedPriorYear = null
  let matchedFutureYear = null
  for (const [year, entities] of groundTruthByYear) {
    const values = entities.get(entityKey)
    if (!values?.has(claimedValue)) continue
    if (year < targetYear && matchedPriorYear === null) matchedPriorYear = year
    if (year > targetYear && matchedFutureYear === null) matchedFutureYear = year
  }

  if (matchedPriorYear !== null && matchedFutureYear === null) return 'STALE_PRIOR_VALUE'
  if (matchedFutureYear !== null && matchedPriorYear === null) return 'FUTURE_CONTAMINATION'
  if (matchedPriorYear !== null && matchedFutureYear !== null) return 'AMBIGUOUS_BOTH_PRIOR_AND_FUTURE'
  return 'NO_MATCH_ANY_YEAR'
}

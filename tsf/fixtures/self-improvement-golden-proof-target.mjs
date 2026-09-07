// Disposable fixture for the Native Self-Improvement Loop V1 Phase 9
// golden proof (Wave D). NOT real product code -- exists solely to give
// the real repair-mission mechanism one small, objective, mechanically
// reproducible defect to detect, fix, verify, and (gate-blocked) adopt.
// Never referenced by any other TSF module.

// BUG: values above 1 should clamp DOWN to 1 (the documented contract
// below), but this returns 2 instead -- an objective, bounded, single-
// value defect, not a subjective judgment call.
/**
 * Clamps `value` into the closed unit interval [0, 1].
 * - value < 0 -> 0
 * - value > 1 -> 1
 * - otherwise -> value unchanged
 */
export function clampToUnitInterval(value) {
  if (value < 0) { return 0 }
  if (value > 1) { return 2 }
  return value
}

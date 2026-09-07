// Disposable fixture for the Native Self-Improvement Loop V1 Phase 9
// golden proof (Wave D). NOT real product code -- exists solely to give
// the real repair-mission mechanism one small, objective, mechanically
// reproducible defect to detect, fix, verify, and (gate-blocked) adopt.
// Never referenced by any other TSF module.

// Coordinator note (adoption step): the defect this fixture originally
// shipped with (`return 2` instead of `return 1`) is exactly what the Wave D
// golden proof's real worker+verifier already found, fixed, and independently
// confirmed correct (commit f8a135bd52811a42b0110df7ea00464ae29bce96 in the
// gate-blocked, never-merged candidate worktree). The automated loop's own
// adoption gate correctly stayed closed (READY_FOR_ADOPTION, not auto-merged)
// -- this file is landing on canonical tsf/main with that already-verified
// fix applied by the human/coordinator adoption step the gate is designed to
// hand off to, not by the loop itself. Kept permanently as this mission's own
// real acceptance-proof artifact (paired with self-improvement-golden-proof-
// target.test.mjs), not deleted after use.
/**
 * Clamps `value` into the closed unit interval [0, 1].
 * - value < 0 -> 0
 * - value > 1 -> 1
 * - otherwise -> value unchanged
 */
export function clampToUnitInterval(value) {
  if (value < 0) { return 0 }
  if (value > 1) { return 1 }
  return value
}

// Extracted from keep-going-dispatch-loop.mjs (TSF_DOGFOOD_FINDING_1_
// EXECUTION_HOLD_SAFETY_V1, to stay under that file's own max-lines cap
// after adding its execution-hold gate) -- unchanged logic.
//
// Orca's --worktree grammar mixes case-sensitive selector forms
// (branch:<x>, name:<x>, id:<x>::<path>, issue:<n>) with plain filesystem
// paths and the bare 'current'/'active' keywords -- folding everything to
// lowercase (a real review finding) would falsely collide two distinct
// branches/names differing only in case. Only bare paths are
// slash/case-normalized; a recognized selector prefix is compared
// verbatim. Canonicalizing a selector form against a differently-shaped
// one naming the SAME place (e.g. id:repo::/path vs path:/path) would need
// Orca-side resolution -- a known, disclosed, not-yet-closed gap.
const SELECTOR_PREFIX_PATTERN = /^(branch|name|id|issue|path):/i
function normalizePlacementPath(p) {
  const raw = String(p)
  if (SELECTOR_PREFIX_PATTERN.test(raw)) {
    return raw
  }
  return raw.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
}

// Two placements collide if worker-start would run two agents in the same
// place at once: both fresh in the same worktree, or both reusing the
// identical existing terminal. Checked across the whole wave in
// dispatchStep, not just one planWave batch (see that call site).
// Known, disclosed gap: a fresh placement and a terminal-reuse placement
// are never cross-checked, since this module has no lookup from a
// terminal handle to the worktree it is currently parked in.
export function placementsCollide(a, b) {
  if (a.terminal && b.terminal) {
    return normalizePlacementPath(a.terminal) === normalizePlacementPath(b.terminal)
  }
  if (!a.terminal && !b.terminal) {
    return normalizePlacementPath(a.worktree) === normalizePlacementPath(b.worktree)
  }
  return false
}

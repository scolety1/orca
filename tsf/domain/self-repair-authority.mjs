// TSF self-repair authority gate. Per explicit operator decision: an
// explicit UI toggle is required -- free text alone never authorizes
// auto-provisioning a worktree from accepted tsf/main.
//
// Adversarial-review finding, fixed here: the first version of this gate
// authorized self-repair for ANY exactly-matched project, not specifically
// TSF's own -- an operator who left the toggle on (it persists across
// messages) and then named an unrelated project exactly would have that
// unrelated project's worktree branched from 'main' instead of its normal
// default base. `selfRepairProjectId` closes this: it must be explicitly
// configured (TSF_SELF_REPAIR_PROJECT_ID) to the one real project that
// actually is TSF's own -- with nothing configured, self-repair can never
// be authorized for any project, which is the honest, safe default (no
// invented "the TSF project" identifier exists anywhere else in this
// codebase to guess from). Authorization requires all of: the toggle
// explicitly on, the target project resolved by an EXACT id/displayName
// match (never a fuzzy guess), that project's id matching the configured
// self-repair project exactly, and the message clearing the normal
// TIM_REQUIRED authority gate.
export function isAuthorizedSelfRepair({
  toggleOn,
  matchedOn,
  decisionClass,
  projectId,
  selfRepairProjectId
}) {
  return (
    !!toggleOn &&
    !!matchedOn &&
    matchedOn !== 'fuzzy' &&
    decisionClass !== 'TIM_REQUIRED' &&
    !!selfRepairProjectId &&
    projectId === selfRepairProjectId
  )
}

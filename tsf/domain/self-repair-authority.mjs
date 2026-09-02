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
//
// Adversarial-review finding: `matchedOn !== 'fuzzy'` also admitted the
// project-name-resolver.mjs 'alias' tier once durable aliases (Nytheria,
// NWR, ...) were added -- an operator who left the toggle on (it persists
// across messages) could then authorize self-repair via a casual nickname
// mention rather than the project's own literal id/displayName,
// contradicting this gate's own "EXACT id/displayName match" requirement
// above. An alias is a real, trusted match for ordinary targeting/dispatch,
// but self-repair is TSF's single highest-stakes action (branching a
// worktree from tsf/main itself) and is held to a strictly narrower bar on
// purpose.
//
// Disclosed, pre-existing gap this narrowing does not (and was never meant
// to) close: `matchedOn: 'id'` also flows from an operator picking a
// project explicitly via UI (http-server.mjs's `body.projectId` path), not
// only from typing its literal id/displayName in chat text -- so the
// toggle-persists-across-messages design already lets a dropdown selection
// plus any ordinary dispatch-worthy message authorize self-repair, same as
// before this repair. Real, but orthogonal to what this repair changes
// (Command's free-text project RESOLUTION, not the toggle/selection UX
// upstream of it) -- not fixed here.
export function isAuthorizedSelfRepair({
  toggleOn,
  matchedOn,
  decisionClass,
  projectId,
  selfRepairProjectId
}) {
  return (
    !!toggleOn &&
    (matchedOn === 'id' || matchedOn === 'displayName') &&
    decisionClass !== 'TIM_REQUIRED' &&
    !!selfRepairProjectId &&
    projectId === selfRepairProjectId
  )
}

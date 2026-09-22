// M3/M-Command: turns a dispatch-worthy chat message into a real Orca
// dispatch via chat-dispatch-bridge.mjs, returning the SAME {intent,
// decisionClass, text, ...} response shape every other chat branch already
// produces. If the caller (Planner Chat's Advanced field, or a directly-
// supplied placement) gave an explicit worktree/workerTerminal, that wins
// unchanged; otherwise this auto-provisions a fresh worktree
// (ensureWorktreeForDispatch, M-Command) instead of refusing outright --
// the manual field is now a debug override, not a requirement (spec Phase
// 6). `selfRepairFromBranch` is only ever set by an already-authorized
// self-repair caller (domain/self-repair-authority.mjs); every other
// caller auto-provisions from the repo's own default base.
//
// Extracted out of chat-http-routes.mjs (2026-09-22, TSF Daytime
// Productization) to keep that file under its own max-lines ceiling --
// this function was already fully self-contained (a single call site),
// no behavior change.
import { classifyIntent, classifyDecision } from './chat-responder.mjs'
import { planAndDispatchFromChat, ensureWorktreeForDispatch } from './chat-dispatch-bridge.mjs'
import { readProjectExecutionHold } from './project-execution-hold-store.mjs'
import { isProjectExecutionHoldActive } from '../domain/project-execution-hold.mjs'
import { resolveRepositoryIdentity } from './repository-identity.mjs'

export async function dispatchFromChat({
  project,
  message,
  placement,
  selfRepairFromBranch,
  attachments = []
}) {
  const intent = classifyIntent(message)
  const decisionClass = classifyDecision(message, intent)
  // Coordinator adoption-review fix: planAndDispatchFromChat's own hold
  // check (chat-dispatch-bridge.mjs) runs too late to stop THIS function's
  // own ensureWorktreeForDispatch call below -- a held project's chat
  // dispatch would still create a real worktree before ever reaching that
  // gate. Same check, defense-in-depth, before any real side effect here.
  const hold = readProjectExecutionHold(project.id)
  if (isProjectExecutionHoldActive(hold)) {
    return {
      intent,
      decisionClass,
      text: `This project is under an execution hold (${hold.reason}${hold.note ? `: ${hold.note}` : ''}, set by ${hold.setBy}) -- release the hold before dispatching new work.`,
      providerLabel: 'PLANNER_DEEP · dispatch withheld -- PROJECT_EXECUTION_HOLD_ACTIVE',
      live: false,
      dispatched: false
    }
  }
  let effectivePlacement = placement
  if (!effectivePlacement?.worktree && !effectivePlacement?.workerTerminal) {
    const provisioned = await ensureWorktreeForDispatch(
      project,
      {},
      { fromBranch: selfRepairFromBranch }
    )
    if (!provisioned.ok) {
      return {
        intent,
        decisionClass,
        text: `I need a worktree to dispatch into. I tried to create one automatically and couldn't: ${provisioned.detail ?? provisioned.reason}. Supply a worktree path manually (Advanced) instead.`,
        providerLabel: 'PLANNER_DEEP · dispatch attempted, auto-provisioning failed',
        live: false,
        dispatched: false
      }
    }
    effectivePlacement = { worktree: provisioned.worktree }
  }
  if (!effectivePlacement.worktree) {
    return {
      intent,
      decisionClass,
      text: `I need an exact worktree path to dispatch into -- reusing an existing terminal for a chat-triggered dispatch isn't wired up yet, please supply a worktree.`,
      providerLabel: 'PLANNER_DEEP · dispatch attempted, no repository binding available',
      live: false,
      dispatched: false
    }
  }
  const resolved = await resolveRepositoryIdentity(effectivePlacement.worktree)
  if (!resolved.ok) {
    const reasonText =
      resolved.reason === 'REPOSITORY_UNAVAILABLE'
        ? 'that worktree path does not exist'
        : resolved.reason === 'NOT_A_GIT_REPOSITORY'
          ? 'that path is not a git repository'
          : 'the repository could not be inspected'
    return {
      intent,
      decisionClass,
      text: `I can't dispatch this: ${reasonText} (${resolved.detail}).`,
      providerLabel: 'PLANNER_DEEP · dispatch attempted, repository resolution failed',
      live: false,
      dispatched: false
    }
  }

  const dispatch = await planAndDispatchFromChat({
    project,
    message,
    placement: effectivePlacement,
    identity: { repository: resolved.identity },
    clock: () => new Date(),
    attachments
  })

  if (!dispatch.ok) {
    const detailText = dispatch.detail ? ` (${dispatch.detail})` : ''
    return {
      intent,
      decisionClass,
      text: `I couldn't dispatch this on **${project.displayName}**: ${dispatch.reason}${detailText}.`,
      providerLabel: 'PLANNER_DEEP · dispatch attempted, did not complete',
      live: false,
      dispatched: false,
      dispatchReason: dispatch.reason,
      dispatchDetail: dispatch.detail
    }
  }

  const items = dispatch.tickResult.dispatchRecords ?? []
  // BUG-06 (bug-ledger.json): the SAME chat phrasing ("go ahead" etc.)
  // silently either creates a brand new Keep Going run/mission or adds a
  // work item to whichever run is already ACTIVE for this project,
  // depending on hidden server-side state the operator cannot see --
  // freshlyCreated (now threaded through planAndDispatchFromChat, was
  // previously computed and discarded) is what actually distinguishes
  // them; said explicitly here rather than identical text either way.
  const missionPhrase = dispatch.freshlyCreated
    ? 'Started a new mission'
    : 'Added to the mission already running'
  // Recovered from a stranded uncommitted worktree: names the actual Keep
  // Going run and states the governance guarantee explicitly, layered onto
  // BUG-06's missionPhrase rather than replacing it.
  const dispatchedText =
    items.length > 0
      ? `${missionPhrase} for **${project.displayName}** in Keep Going run **${dispatch.tickResult.run?.id ?? 'unknown'}**: dispatched **${dispatch.candidateWorkItem.id}** (task ${items[0].taskId}) -- real Orca worker, no terminal opened by hand. Work remains governed and stops at Ready for Adoption.`
      : `${missionPhrase} for **${project.displayName}**: ${dispatch.tickResult.action}.`
  return {
    intent,
    decisionClass,
    text: dispatchedText,
    providerLabel: 'PLANNER_DEEP · real dispatch via Keep Going',
    live: true,
    dispatched: true,
    tickResult: dispatch.tickResult,
    candidateWorkItem: dispatch.candidateWorkItem,
    planCapsule: dispatch.planCapsule
  }
}

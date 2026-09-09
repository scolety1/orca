// Fleet Dispatch Readiness + Explicit Command Adoption V1, Part A: Command
// <-> real adoption-execution bridge. Same early layer as command-fleet-
// attention-bridge.mjs/command-self-improvement-bridge.mjs (checked in
// command-responder.mjs ahead of ordinary intent/project classification) --
// this is the SINGLE-project entry point (a message resolving to exactly
// one real, exact-matched project, or an explicit referring phrase against
// the prior turn's real resultItems); command-multi-action-bridge.mjs's own
// handleEntry covers the multi-project case, both calling the SAME real
// engine (server/command-adoption-execution.mjs) -- never two execution
// paths.
import { classifyAdoptionCommandIntent } from '../domain/command-adoption-execution.mjs'
import { executeCommandAdoption } from './command-adoption-execution.mjs'
import { resolveCommandReferent } from '../domain/command-referent-resolution.mjs'
import { trimAttentionItem } from '../domain/fleet-attention-status.mjs'

// `projects` (optional, the real registered project list): threaded
// through to classifyAdoptionCommandIntent's own accept/approve object-
// recognition allowlist (see that function's own header comment) -- when
// supplied, "approve the budget for WorldForge" is correctly recognized
// as NOT adoption language even though a real project name appears in the
// message, because it isn't the verb's own direct object.
export function shouldRouteToAdoptionCommandBridge(message, projects) {
  return classifyAdoptionCommandIntent(message, projects) !== 'NOT_ADOPTION'
}

function ambiguousResponse(message) {
  return {
    intent: 'ADOPTION_COMMAND',
    // Not one of chat-responder.mjs's own TIM_REQUIRED/RECOMMEND_AND_PROCEED/
    // AUTO_DECIDE decision classes -- a distinct, honest shape for "I could
    // act, but which candidate/whether you really mean it is genuinely
    // unclear, so I'm asking rather than guessing" (mirrors the existing
    // NEEDS_OWNER AttentionItem category's own meaning, just as a live
    // decisionClass instead of a static item).
    decisionClass: 'NEEDS_OWNER',
    text: `That's ambiguous adoption language -- I won't guess. Tell me explicitly which candidate to adopt (e.g. "adopt the <project> run").`,
    plannerRole: 'PLANNER_DEEP',
    providerLabel: 'PLANNER_DEEP · adoption intent ambiguous, no action taken',
    live: false,
    resolvedProjectIds: [],
    scope: 'ADOPTION_COMMAND',
    dispatchDetail: message
  }
}

function outcomeText(project, result) {
  if (result.ok) {
    if (result.alreadyIncluded) {
      return `**${project.displayName}** -- already adopted: the candidate is already included in canonical at \`${(result.resultingCanonicalSha ?? '').slice(0, 10)}\`. Recorded a verification receipt (\`${result.receipt.receiptHash.slice(0, 10)}\`).`
    }
    return `**${project.displayName}** -- adopted: canonical advanced from \`${(result.priorCanonicalSha ?? '').slice(0, 10)}\` to \`${result.resultingCanonicalSha.slice(0, 10)}\`. Receipt \`${result.receipt.receiptHash.slice(0, 10)}\` recorded.`
  }
  return `**${project.displayName}** -- couldn't adopt: ${result.reason}${result.detail ? ` (${result.detail})` : ''}.`
}

async function adoptForProjects(targetProjects, clock, deps) {
  const execute = deps.executeCommandAdoption ?? executeCommandAdoption
  const outcomes = []
  for (const project of targetProjects) {
    // eslint-disable-next-line no-await-in-loop -- a real, deliberate merge per project; sequential keeps a real git working-tree op from racing another project's own, never a correctness dependency between them
    const result = await execute({ project, clock, deps })
    outcomes.push({ project, result })
  }
  return outcomes
}

function respondFromOutcomes(outcomes) {
  const text = outcomes.map(({ project, result }) => outcomeText(project, result)).join('\n')
  const anyOk = outcomes.some(({ result }) => result.ok)
  return {
    intent: 'ADOPTION_COMMAND',
    decisionClass: 'RECOMMEND_AND_PROCEED',
    text,
    plannerRole: 'PLANNER_DEEP',
    providerLabel: 'PLANNER_DEEP · real adoption execution via command-adoption-execution.mjs',
    live: anyOk,
    resolvedProjectIds: outcomes.map(({ project }) => project.id),
    scope: outcomes.length > 1 ? 'MULTI_PROJECT' : 'PROJECT',
    resultItems: outcomes
      .filter(({ result }) => !result.ok)
      .map(({ project, result }) => trimAttentionItem({
        id: `adoption-command:${project.id}`,
        category: result.reason === 'PROJECT_EXECUTION_HOLD_ACTIVE' ? 'BLOCKED_EXTERNAL' : null,
        label: project.displayName,
        project: { id: project.id, displayName: project.displayName },
        reason: `${result.reason}${result.detail ? `: ${result.detail}` : ''}`
      }))
  }
}

// `exactMatchProjects`: the caller's own already-resolved exact project
// match(es) for this message (command-responder.mjs's own `exactMatches`,
// same "only an EXACT match is ever trusted enough to act on" convention
// every other real action in this codebase follows). `priorResultItems`:
// the prior __command__ turn's trimmed AttentionItem[] (Part A2), used only
// when the message itself named no project at all (a referring phrase like
// "adopt both of those").
export async function respondAdoptionCommand({ message, exactMatchProjects = [], priorResultItems = [], projects, clock = () => new Date(), deps = {} }) {
  const classification = classifyAdoptionCommandIntent(message, projects)
  if (classification === 'NOT_ADOPTION') {
    return null
  }
  if (classification === 'AMBIGUOUS') {
    return ambiguousResponse(message)
  }

  // EXECUTE_ADOPTION from here.
  //
  // Coverage-audit finding (Full Conversational Control Plane Exhaustive
  // Gauntlet V1, one-hour continuation, independent read-only review,
  // real/live-confirmed P0): this file's own header comment above already
  // documents it as "the SINGLE-project entry point," but this check used
  // to accept ANY count > 0 -- command-responder.mjs's `exactMatches` is
  // resolved over the WHOLE message, not scoped to the adoption verb's own
  // clause, so a message like "pause batch12-project-a, adopt
  // batch12-project-b" (an unrelated verb for one project, a genuine
  // adoption request for a different one) passed BOTH projects through as
  // exactMatchProjects -- adoptForProjects then called the real
  // executeCommandAdoption (a real git ff-only merge) against EVERY one of
  // them unconditionally, including the project that was never asked to be
  // adopted. If that co-named project genuinely had a real, ready
  // (COMPLETE) candidate at that moment, this would have silently merged
  // it. Confirmed live with synthetic fixtures: decomposeMultiAction
  // itself was not a safe substitute here either (a bare-comma-joined,
  // different-verb, different-project clause is a SEPARATE, disclosed,
  // deferred gap in that module's own clause-splitting -- see this
  // commit's corpus entry) -- so the safe fix is here, at the one place
  // that actually knows this bridge is documented as single-project-only.
  // A single exact match (the overwhelmingly common, already-tested case)
  // is completely unaffected; 2+ exact matches now fails safe (asks,
  // never guesses which one(s) were actually meant), matching this
  // codebase's own established "ambiguous -- won't guess" convention
  // rather than silently acting on every co-named project.
  if (exactMatchProjects.length === 1) {
    return respondFromOutcomes(await adoptForProjects(exactMatchProjects, clock, deps))
  }
  if (exactMatchProjects.length > 1) {
    return {
      intent: 'ADOPTION_COMMAND',
      decisionClass: 'NEEDS_OWNER',
      text: `That names more than one project alongside adoption language (${exactMatchProjects.map((p) => `**${p.displayName}**`).join(', ')}) -- I won't guess which one(s) you actually meant to adopt. Say "adopt <project>" for exactly the one you mean.`,
      plannerRole: 'PLANNER_DEEP',
      providerLabel: 'PLANNER_DEEP · adoption target ambiguous across multiple named projects, no action taken',
      live: false,
      resolvedProjectIds: [],
      scope: 'ADOPTION_COMMAND',
      dispatchDetail: message
    }
  }

  const referent = resolveCommandReferent({ message, resultItems: priorResultItems })
  if (referent.resolved) {
    const readyItems = referent.items.filter((item) => item.category === 'READY_FOR_ADOPTION')
    if (readyItems.length === 0) {
      return {
        intent: 'ADOPTION_COMMAND',
        decisionClass: 'NEEDS_OWNER',
        text: `I found what you're referring to, but none of it is actually ready for adoption right now -- nothing to do.`,
        plannerRole: 'PLANNER_DEEP',
        providerLabel: 'PLANNER_DEEP · adoption referent resolved to no ready-for-adoption candidate',
        live: false,
        resolvedProjectIds: [],
        scope: 'ADOPTION_COMMAND'
      }
    }
    const targetProjectIds = [...new Set(readyItems.map((item) => item.project?.id).filter(Boolean))]
    const targetProjects = targetProjectIds.map((id) => projects.find((p) => p.id === id)).filter(Boolean)
    if (targetProjects.length === 0) {
      return ambiguousResponse(message)
    }
    return respondFromOutcomes(await adoptForProjects(targetProjects, clock, deps))
  }

  // No exact project match and no resolvable referent -- genuinely unclear
  // which candidate this refers to; asks rather than guessing, same honesty
  // as every other "couldn't tell which project" fallback in this codebase.
  return {
    intent: 'ADOPTION_COMMAND',
    decisionClass: 'NEEDS_OWNER',
    text: `I can't tell which candidate you mean -- name a project (by id or display name) before I adopt anything.`,
    plannerRole: 'PLANNER_DEEP',
    providerLabel: 'PLANNER_DEEP · adoption intent explicit, but no confidently-identified candidate',
    live: false,
    resolvedProjectIds: [],
    scope: 'ADOPTION_COMMAND'
  }
}

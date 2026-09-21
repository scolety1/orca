// Hands-Free Command + Project Manager V1: the one real conversational path
// to action-executor.mjs's RESOLVE_NEEDS_YOU -- before this, it was
// reachable ONLY from three dedicated UI-button HTTP routes
// (keep-going-http-routes.mjs, planner-needs-you-http-routes.mjs,
// research-http-routes.mjs). Covers both mission examples with the SAME
// mechanism: "Answer the NWR question with option two" and "Yes, authorize
// it" both just answer a different already-open Needs-You/approval item
// (domain/research-paid-approval.mjs already raises paid-spend confirmation
// as an ordinary RESEARCH-source Needs-You item -- no separate confirmation
// subsystem exists or is needed here).
//
// Targeting discipline (domain/command-needs-you-answer-targeting.mjs) is
// safety-first, mirroring project-name-resolver.mjs's own exact-match-only
// philosophy: NO ACTION WAS TAKEN is always a legitimate outcome. This
// bridge only ever resolves an ALREADY-OPEN, already-modeled item through
// the real, unmodified executeAction -- it cannot invent a target, bypass a
// hold, or answer a TIM_REQUIRED refusal (those never create a Needs-You
// item in the first place).
import { classifyIntent, DELIBERATIVE_STATEMENT_OPENER } from './chat-responder.mjs'
import { resolveProjectsFromText } from './project-name-resolver.mjs'
import { fleetNeedsYouStatus } from '../domain/fleet-work-status.mjs'
import { resolveNeedsYouAnswerTarget } from '../domain/command-needs-you-answer-targeting.mjs'
import { executeAction } from './action-executor.mjs'

export function shouldRouteToNeedsYouAnswerBridge(message) {
  return classifyIntent(message) === 'NEEDS_YOU_ANSWER'
}

// DIRECTIVE SEMANTICS CLOSURE V1 (P0): classifyIntent's NEEDS_YOU_ANSWER
// pattern is pure vocabulary matching ("answer ... question" / "option
// two" / "yes, authorize it") with no directive-vs-musing guard at all --
// unlike every other consequential path in this codebase, this bridge
// never called isGenuineDirective (or any equivalent) before resolving
// and mutating. Reproduced directly: "I wonder if we should just answer
// the question with option two" and "Maybe we should answer that with
// option two" both classified identically to the real, unambiguous
// "answer the question with option two" and would have resolved (and
// mutated) a real open item purely because the musing text happened to
// contain the trigger vocabulary. This is the SAME RESOLVE_NEEDS_YOU
// mechanism research-paid-approval grants ride on (this file's own header
// above), so it is exactly the money-adjacent surface this closure pass
// is about, not a cosmetic gap.
function isDeliberativeMusing(message) {
  return DELIBERATIVE_STATEMENT_OPENER.test(message.trim())
}

const REFUSAL_TEXT = {
  NONE_OPEN: "Nothing needs your input right now -- there's no open question to answer.",
  AMBIGUOUS:
    "I'm not sure which open question you mean -- name the project it's for (or answer from that project's own chat).",
  NO_MATCH: "I couldn't find an open question for that project -- nothing was resolved.",
  DELIBERATIVE:
    "Sounds like you're still deciding -- say it as a direct answer (e.g. \"answer with option two\") when you're ready and I'll record it."
}

// message: the real user text ("Answer the NWR question with option two.",
//   "Yes, authorize it.").
// projects / opState: same real catalog/state every other bridge reads.
// focusProjectId: the durable Command focus (domain/command-conversation-
//   focus.mjs), or null -- Planner Chat callers pass their own project's id
//   here instead (a project-scoped chat is unambiguously "about" that
//   project, same as an explicit turn target would be).
// aliases: loadProjectAliases()'s output, threaded through like every other
//   bridge (avoids a second, redundant re-parse for the same request).
// Real Codex adversarial-review finding (P0): a Needs-You answer's own
// free-text ANSWER content ("...with password remediation") was scanned
// by resolveProjectsFromText for a project reference exactly like the
// rest of the message -- if the answer happens to contain words that
// coincidentally match a real, different project's own name, it was
// wrongly treated as an explicit project reference, resolving (and
// mutating) the WRONG project's question instead of the one actually
// named or focused. Reproduced: focus is HouseOS, HouseOS and a real
// `password-remediation` project each have one open item, and "Answer the
// question with password remediation" resolved and answered
// password-remediation's item instead of HouseOS's. Only the portion of
// the message BEFORE a real answer-content marker is ever scanned for a
// project name now -- text after it is the owner's own answer, never
// project-targeting language. The canonical phrasings ("Answer the NWR
// question with option two", "Answer that with option two") are
// unaffected -- the project name/back-reference always comes BEFORE
// "with" in every real example this mission and its own tests use.
const ANSWER_CONTENT_MARKER = /\b(?:with|saying|that'?s|that\s+it'?s|that\s+it\s+is)\b/i

function targetingPortion(message) {
  const match = ANSWER_CONTENT_MARKER.exec(message)
  return match ? message.slice(0, match.index) : message
}

export async function respondNeedsYouAnswerCommand({
  message,
  projects,
  opState,
  focusProjectId = null,
  clock = () => new Date(),
  aliases,
  deps = {}
}) {
  if (isDeliberativeMusing(message)) {
    return {
      intent: 'NEEDS_YOU_ANSWER',
      decisionClass: 'AUTO_DECIDE',
      text: REFUSAL_TEXT.DELIBERATIVE,
      plannerRole: 'PLANNER_DEEP',
      providerLabel: 'PLANNER_DEEP · Needs You answer refused -- DELIBERATIVE',
      live: false,
      resolvedProjectIds: []
    }
  }
  const resolution = resolveProjectsFromText(targetingPortion(message), projects, { aliases })
  const turnTargetProjectIds = resolution.matches
    .filter((m) => m.matchedOn !== 'fuzzy')
    .map((m) => m.project.id)
  // Every match, exact or fuzzy -- see targeting.mjs's own header for why a
  // dropped fuzzy signal must not be treated as "nothing named" (real
  // dogfood-round-1 P0 finding).
  const mentionedProjectIds = [...new Set(resolution.matches.map((m) => m.project.id))]

  const openItems = fleetNeedsYouStatus(
    projects,
    opState.keepGoingRuns,
    opState.researchMissions,
    opState.plannerMissions
  )

  const targeted = resolveNeedsYouAnswerTarget(message, {
    openItems,
    turnTargetProjectIds,
    mentionedProjectIds,
    focusProjectId
  })

  if (!targeted.ok) {
    return {
      intent: 'NEEDS_YOU_ANSWER',
      decisionClass: 'AUTO_DECIDE',
      text: REFUSAL_TEXT[targeted.reason] ?? REFUSAL_TEXT.AMBIGUOUS,
      plannerRole: 'PLANNER_DEEP',
      providerLabel: `PLANNER_DEEP · Needs You answer refused -- ${targeted.reason}`,
      live: false,
      resolvedProjectIds: []
    }
  }

  const { item } = targeted
  const execute = deps.executeAction ?? executeAction
  const result = await execute({
    type: 'RESOLVE_NEEDS_YOU',
    target: item.targetId,
    parameters: { source: item.source, needsYouId: item.id, resolution: message },
    clock,
    deps: deps.actionExecutor ?? {}
  })

  if (!result.ok) {
    return {
      intent: 'NEEDS_YOU_ANSWER',
      decisionClass: 'AUTO_DECIDE',
      text: `I found the question ("${item.question}") but couldn't record your answer: ${result.detail}.`,
      plannerRole: 'PLANNER_DEEP',
      providerLabel: 'PLANNER_DEEP · Needs You resolution failed',
      live: false,
      resolvedProjectIds: item.projectId ? [item.projectId] : []
    }
  }

  return {
    intent: 'NEEDS_YOU_ANSWER',
    decisionClass: 'AUTO_DECIDE',
    text: `Got it -- answered "${item.question}" for **${item.label}**.`,
    plannerRole: 'PLANNER_DEEP',
    providerLabel: 'PLANNER_DEEP · real Needs You resolution via the canonical Action executor',
    live: false,
    resolvedProjectIds: item.projectId ? [item.projectId] : []
  }
}

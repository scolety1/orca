// Command architecture, final conversational-context pass (Gap 1):
// explanatory follow-ups ("what does that mean?", "why?", "why is it
// stuck?", "what's blocking it?", "explain that", "is that bad?").
//
// Deliberately NOT "persist arbitrary hidden chat text and replay it" --
// this module never reads a prior turn's `content` (the rendered answer
// text). It reads only the BOUNDED semantic record http-server.mjs's
// chat-save already persists per turn (resolvedProjectIds,
// researchMissionId, scope, intent -- see that file's own comment on
// exactly this contract), then RECOMPUTES a fresh explanation from CURRENT
// canonical state every time. A stale answer from ten minutes ago can
// never be echoed back as if it were still true.
//
// Context establishes REFERENT only, never authority: every function here
// is read-only by construction (no domain mutation call anywhere in this
// file) -- an explanatory follow-up cannot run/pause/deploy/spend/adopt/
// repair/mutate anything even in principle, not merely by convention.
import { fleetWorkStatus, fleetNeedsYouStatus } from '../domain/fleet-work-status.mjs'
import { advisorySafeProjects } from './command-scope-classifier.mjs'
import { readResearchMissionStatus, readResearchMissionReviewItems } from './research-mission-driver.mjs'

// Anchored narrowly on purpose: bare "why?" (optionally with a "?") is the
// whole message: chat-responder.mjs's own RATIONALE pattern
// (`/\bwhy (did you|was)\b/`) already owns the longer "why did you .../why
// was ..." forms for a per-project conversation -- this file's job is only
// the genuinely under-specified, referent-needing shapes those patterns
// don't cover.
const EXPLANATORY_FOLLOWUP_PATTERN =
  /^\s*why\??\s*$|\bwhy (that|this) one\b|\bwhy is it (stuck|blocked)\b|\bwhy is (that|this) (stuck|blocked)\b|\bwhat'?s blocking it\b|\bwhat is blocking it\b|\bwhat does (that|this) mean\b|\bexplain (that|this)\b|\bis (that|this) bad\??\s*$/i

export function isExplanatoryFollowUp(message) {
  return EXPLANATORY_FOLLOWUP_PATTERN.test(message)
}

// The one place a bounded prior-turn summary is read back out of
// chatThreads.__command__ -- mirrors command-responder.mjs's own
// lastReferencedProjectId exactly (most recent assistant entry wins), kept
// as a separate function since a follow-up EXPLANATION needs the whole
// bounded record (intent/scope/researchMissionId too), not just a project
// id.
function lastAnswerSummary(opState) {
  const thread = opState.chatThreads?.__command__ ?? []
  for (let i = thread.length - 1; i >= 0; i -= 1) {
    const entry = thread[i]
    if (entry.role === 'assistant') {
      return {
        answerType: entry.intent ?? null,
        resolvedProjectIds: entry.resolvedProjectIds ?? [],
        researchMissionId: entry.researchMissionId ?? null,
        scope: entry.scope ?? null
      }
    }
  }
  return null
}

const NEEDS_ATTENTION_STATES = new Set(['NEEDS_YOU', 'STALLED'])

function explainProjectState(project, keepGoingRuns, clock) {
  const [status] = fleetWorkStatus([project], keepGoingRuns, clock)
  if (!status.hasRun) {
    return `**${project.displayName}** has no Keep Going run right now -- nothing is stuck, there's just nothing in flight.`
  }
  const needsAttention = NEEDS_ATTENTION_STATES.has(status.feed.state)
  const judgment = needsAttention ? "Yes, that's worth a look" : "No, that's expected"
  return `**${project.displayName}** is ${status.feed.state}: ${status.feed.reason}. ${judgment}.`
}

// Phase 6 fix: plannerMissions is now a real 4th argument -- see
// fleet-work-status.mjs's own header on why a planner-raised Needs You
// item was previously invisible even to this "why?" follow-up.
function explainNeedsYou(projects, keepGoingRuns, researchMissions, plannerMissions) {
  const items = fleetNeedsYouStatus(projects, keepGoingRuns, researchMissions, plannerMissions)
  if (items.length === 0) {
    return { text: "There's nothing actually blocking on you right now -- the fleet-wide check came back empty.", resolvedProjectIds: [] }
  }
  const [first, ...rest] = items
  const restNote = rest.length > 0 ? ` (${rest.length} more open item(s) besides this one.)` : ''
  // Real deep link when the single most-relevant item names a real
  // project (matches command-responder.mjs's own NEEDS_YOU_QUERY chip
  // wiring) -- honestly omitted for a RESEARCH/PLANNER item with no
  // project association.
  return {
    text: `**${first.label}** -- ${first.question}${restNote}`,
    resolvedProjectIds: first.projectId ? [first.projectId] : []
  }
}

function explainGlobalAdvisory(projects) {
  const safe = advisorySafeProjects(projects)
  if (safe.length === 0) {
    return "There wasn't a real disposable/test-only project in the catalog to point at -- every known project is a real one."
  }
  const reasons = safe.map((p) => `**${p.displayName}** because ${p.sourceClass === 'FIXTURE' ? "it's a deterministic fixture, not real state" : "its own name marks it as a disposable test project"}`)
  return `Because ${reasons.join('; ')} -- nothing else in the catalog is safe to experiment on freely.`
}

function explainResearchMission(missionId) {
  const status = readResearchMissionStatus(missionId)
  if (!status) return `I don't have a research mission called ${missionId} anymore.`
  if (status.phase === 'WAITING_NEEDS_INPUT') {
    const openItems = readResearchMissionReviewItems(missionId) ?? []
    const first = openItems[0]
    return `**${missionId}** is waiting on you: ${first ? first.question : 'an open decision is recorded but has no question text.'}`
  }
  const phaseExplain = {
    DRAFT: 'nothing has been scoped yet -- it exists as a record only',
    CREATED: 'real scope exists (fields/expected items) but nothing has actually been dispatched yet',
    EXECUTING: 'real work is genuinely in flight',
    COMPLETE: 'it finished, verified against its own acceptance criteria',
    BLOCKED: 'it was stopped -- an operator decision or cancellation'
  }
  return `**${missionId}** is ${status.phase}: ${phaseExplain[status.phase] ?? 'no further detail recorded for this phase'}.`
}

// The main entry point. Returns { text, resolvedProjectIds, researchMissionId, scope }
// (result()-shaped fields command-responder.mjs can spread directly into
// its own return) or null when this message isn't an explanatory
// follow-up at all -- the caller falls through unchanged.
export function explainPriorAnswer({ message, opState, projects, clock = () => new Date() }) {
  if (!isExplanatoryFollowUp(message)) return null

  const summary = lastAnswerSummary(opState)
  if (!summary) {
    return { text: "There's nothing recent to explain -- ask me something first, or name a project directly.", resolvedProjectIds: [], researchMissionId: null, scope: 'FLEET' }
  }

  // Phase 6 fix, ordering: checked BEFORE the generic resolvedProjectIds
  // branches below. A NEEDS_YOU_QUERY answer now legitimately carries a
  // real resolvedProjectIds (deep-link fix, fleet-work-status.mjs) when
  // exactly one project-sourced item was open -- without this check first,
  // "why is that blocked?" would fall into the generic single-project
  // branch and explain the project's overall run state instead of the
  // actual open Needs You question the prior turn was about. answerType is
  // the more specific, correct signal of what "that" refers to here.
  if (summary.answerType === 'NEEDS_YOU_QUERY') {
    const explanation = explainNeedsYou(projects, opState.keepGoingRuns ?? {}, opState.researchMissions ?? {}, opState.plannerMissions ?? {})
    return {
      text: explanation.text,
      resolvedProjectIds: explanation.resolvedProjectIds,
      researchMissionId: null,
      scope: explanation.resolvedProjectIds.length > 0 ? 'PROJECT' : 'FLEET'
    }
  }

  // Ambiguous prior answer (more than one project, or a fleet-wide answer
  // with no single project/mission referent) -- refuse rather than guess
  // which one "that" means.
  if (summary.resolvedProjectIds.length > 1) {
    return { text: "The previous answer covered more than one project -- which one do you mean?", resolvedProjectIds: [], researchMissionId: null, scope: 'FLEET' }
  }

  if (summary.resolvedProjectIds.length === 1) {
    const project = projects.find((p) => p.id === summary.resolvedProjectIds[0])
    if (!project) {
      return { text: "That project isn't in the current catalog anymore -- I can't explain something that no longer exists here.", resolvedProjectIds: [], researchMissionId: null, scope: 'FLEET' }
    }
    return { text: explainProjectState(project, opState.keepGoingRuns ?? {}, clock), resolvedProjectIds: [project.id], researchMissionId: null, scope: 'PROJECT' }
  }

  if (summary.researchMissionId) {
    return { text: explainResearchMission(summary.researchMissionId), resolvedProjectIds: [], researchMissionId: summary.researchMissionId, scope: 'RESEARCH' }
  }

  if (summary.answerType === 'GLOBAL_ADVISORY') {
    return { text: explainGlobalAdvisory(projects), resolvedProjectIds: [], researchMissionId: null, scope: 'FLEET' }
  }

  // GLOBAL_STATUS or anything else with no single referent -- an honest
  // "nothing specific to explain" rather than a guess.
  return { text: "The previous answer was a fleet-wide summary, not about one specific thing -- ask about a project or mission by name for a real explanation.", resolvedProjectIds: [], researchMissionId: null, scope: 'FLEET' }
}

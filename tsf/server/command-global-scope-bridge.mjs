// Extracted from command-responder.mjs (line-budget maintenance while adding
// Finding #4's action-ambiguity fallback -- pure move, no behavior change),
// matching this codebase's own established command-*-bridge.mjs convention
// (see command-responder.mjs's own header for the full bridge list).
//
// Command architecture fix (hands-on pilot round 2, Finding 1): a message
// that matched none of chat-responder.mjs's own deterministic patterns
// (GENERAL/QUESTION, command-responder.mjs's UNROUTED_QUESTION_INTENTS) AND
// named no project at all is not assumed to be a failed project lookup -- it
// might genuinely need no project (GLOBAL_STATUS/GLOBAL_ADVISORY/
// NEEDS_YOU_QUERY/RESEARCH_REQUEST). The caller gates this to those two
// catch-all intents only: every other read-only intent (STATUS/HEALTH/etc.)
// already has its own real, tested, deterministic pattern and fast
// fleet-wide fallback, so this never adds live-planner latency to an
// already-working path.
import {
  classifyGlobalScope,
  advisorySafeProjects,
  buildGlobalAdvisoryText
} from './command-scope-classifier.mjs'
import { fleetResearchStatus, fleetWorkStatus } from '../domain/fleet-work-status.mjs'
import { buildFleetAttentionItems, trimAttentionItem } from '../domain/fleet-attention-status.mjs'
import { readAllFindings } from './self-improvement-finding-store.mjs'
import { respondResearchCommand } from './command-research-bridge.mjs'

// Moved from command-responder.mjs verbatim (line-budget maintenance, no
// behavior change) -- also used there by respondNoProjectResolved and the
// back-reference branch, re-imported from here.
//
// researchStatuses (optional): fleetResearchStatus's own output --
// domain/fleet-work-status.mjs's real "is any research currently active"
// computation. "Command, Work/Home/global indicator and Research status must
// agree" (hands-on pilot Finding 3) -- a mission in the EXECUTING or
// WAITING_NEEDS_INPUT phase now appears in fleet-wide status exactly like a
// Keep Going run does, never silently absent from "what's running right now"
// just because it isn't project-scoped coding work.
// Hands-on pilot round 3, UX polish: idle projects are named individually up
// to IDLE_NAME_THRESHOLD (collapsing even a single- or few-project answer to
// a bare count would break "what about that project?", which resolves to
// exactly one project and must still say its name); a larger idle fleet
// collapses to a count instead of listing every one individually.
const IDLE_NAME_THRESHOLD = 3

export function formatFleetStatusText(statuses, researchStatuses = []) {
  if (statuses.length === 0 && researchStatuses.length === 0) {
    return 'No known projects yet -- add one from the Projects page.'
  }
  // Finding #5: leads with the settled primary word, never the raw feed state.
  const activeProjectLines = statuses
    .filter((s) => s.hasRun)
    .map(
      (s) =>
        `- **${s.displayName}** — ${s.primaryState}${s.primaryReasonLabel ? ` (${s.primaryReasonLabel})` : ''} (run \`${s.runId}\`) — ${s.feed.reason}.`
    )
  const idleProjects = statuses.filter((s) => !s.hasRun)
  const researchLines = researchStatuses.map(
    (r) =>
      `- **Research ${r.missionId}** — ${r.phase}${r.phase === 'WAITING_NEEDS_INPUT' ? ' (needs a decision)' : ''}.`
  )
  const idleLines = idleProjects.map((s) => `- **${s.displayName}** — no Keep Going run.`)

  if (activeProjectLines.length === 0 && researchLines.length === 0) {
    if (idleProjects.length === 0) {
      return 'No known projects yet -- add one from the Projects page.'
    }
    if (idleProjects.length <= IDLE_NAME_THRESHOLD) {
      return `Nothing is running right now:\n${idleLines.join('\n')}`
    }
    return `Nothing is running right now. ${idleProjects.length} project(s) are idle. Ask me about any one by name for detail.`
  }

  const sections = []
  if (activeProjectLines.length > 0 || researchLines.length > 0) {
    sections.push([...activeProjectLines, ...researchLines].join('\n'))
  }
  if (idleProjects.length > 0) {
    sections.push(
      idleProjects.length <= IDLE_NAME_THRESHOLD
        ? idleLines.join('\n')
        : `${idleProjects.length} other project(s) idle, nothing to report -- ask me about any one by name for detail.`
    )
  }
  return `Here's what's really running right now:\n${sections.join('\n')}`
}

// Returns a full command-responder.mjs response shape for GLOBAL_STATUS/
// GLOBAL_ADVISORY/NEEDS_YOU_QUERY/RESEARCH_REQUEST, or null when the
// classified scope is PROJECT_REQUIRED/UNCLEAR/a RESEARCH_REQUEST the
// research bridge itself couldn't make a real topic out of -- the caller
// falls through to its own existing, honest "couldn't tell" fallback.
export async function respondUnroutedGlobalScope({
  message,
  decisionClass,
  projects,
  opState,
  clock,
  holds,
  scopeFor
}) {
  const classification = await classifyGlobalScope({ message })
  if (classification.scope === 'GLOBAL_STATUS') {
    return {
      intent: 'GLOBAL_STATUS',
      decisionClass,
      text: formatFleetStatusText(
        fleetWorkStatus(projects, opState.keepGoingRuns, clock, holds),
        fleetResearchStatus(opState.researchMissions)
      ),
      plannerRole: 'PLANNER_DEEP',
      providerLabel:
        classification.source === 'LIVE_PLANNER'
          ? 'PLANNER_DEEP · real scope classification, grounded fleet-wide answer, no dispatch'
          : 'PLANNER_DEEP · deterministic fallback scope classification (live planner unavailable), grounded fleet-wide answer',
      live: false,
      resolvedProjectIds: [],
      scope: 'FLEET'
    }
  }
  if (classification.scope === 'GLOBAL_ADVISORY') {
    // Dogfood sequence C ("safe-project advisory -> run that"): an advisory
    // that names exactly ONE real candidate is remembered as a back-reference
    // target -- a genuinely ambiguous multi-project list is not
    // (resolvedProjectIds stays empty, exactly as before, so a later "run
    // that" still honestly asks which one).
    const safe = advisorySafeProjects(projects)
    const singleCandidateId = safe.length === 1 ? safe[0].id : null
    return {
      intent: 'GLOBAL_ADVISORY',
      decisionClass,
      text: buildGlobalAdvisoryText(projects),
      plannerRole: 'PLANNER_DEEP',
      providerLabel:
        classification.source === 'LIVE_PLANNER'
          ? 'PLANNER_DEEP · real scope classification, grounded in the real catalog, no dispatch, no action taken'
          : 'PLANNER_DEEP · deterministic fallback scope classification (live planner unavailable), grounded in the real catalog',
      live: false,
      resolvedProjectIds: singleCandidateId ? [singleCandidateId] : [],
      scope: singleCandidateId ? 'PROJECT' : 'FLEET'
    }
  }
  if (classification.scope === 'NEEDS_YOU_QUERY') {
    // Phase 6 fix: plannerMissions (opState.plannerMissions) is a real 4th
    // source -- see fleet-work-status.mjs's own header for why it was
    // missing. resolvedProjectIds/scope are not hardcoded to empty/FLEET --
    // every item with a real, known projectId (a Keep Going run's owning
    // project, or a ResearchMission's own recorded projectId) is surfaced as
    // a real "Targeting" deep link, reusing CommandPanel.tsx's existing
    // chip-rendering, never a new UI mechanism. A PLANNER item's projectId is
    // honestly null (no reliable project association exists on that
    // record), so it never contributes a fabricated link.
    //
    // Operator Attention V1, Wave 2: swapped from the narrow
    // fleetNeedsYouStatus to buildFleetAttentionItems filtered to
    // NEEDS_OWNER -- a strict superset that also surfaces self-improvement
    // findings the eligibility classifier declined to autofix (previously
    // invisible outside the self-improvement chat bridge). resourcePressureState
    // is explicitly null: NEEDS_OWNER can structurally never include the
    // resource-pressure item (only WAITING_FOR_RESOURCES does), so there is
    // no real host-memory evidence to bother collecting for this query.
    const items = buildFleetAttentionItems({
      projects,
      keepGoingRuns: opState.keepGoingRuns,
      researchMissions: opState.researchMissions,
      plannerMissionRecords: opState.plannerMissions,
      selfImprovementFindings: readAllFindings(),
      resourcePressureState: null
    }).filter((i) => i.category === 'NEEDS_OWNER')
    const text =
      items.length === 0
        ? 'Nothing needs you right now -- no open decisions across any project or research mission.'
        : `${items.length} thing(s) need you:\n${items.map((i) => `- **${i.label}** -- ${i.reason}`).join('\n')}`
    const linkedProjectIds = [...new Set(items.map((i) => i.project?.id).filter(Boolean))]
    return {
      intent: 'NEEDS_YOU_QUERY',
      decisionClass,
      text,
      plannerRole: 'PLANNER_DEEP',
      providerLabel:
        classification.source === 'LIVE_PLANNER'
          ? 'PLANNER_DEEP · real scope classification, grounded in real outstanding Needs You state, no dispatch'
          : 'PLANNER_DEEP · deterministic fallback scope classification (live planner unavailable), grounded in real outstanding Needs You state',
      live: false,
      resolvedProjectIds: linkedProjectIds,
      scope: scopeFor(linkedProjectIds),
      // Part A2: this answer really did come from buildFleetAttentionItems
      // (AttentionItem[]) -- a bounded, trimmed projection is persisted so a
      // later turn's referring phrase ("the stalled one") can resolve
      // against it.
      resultItems: items.map(trimAttentionItem)
    }
  }
  if (classification.scope === 'RESEARCH_REQUEST') {
    // Delegates to the SAME research bridge entry point command-research-
    // bridge.mjs's own deterministic patterns use -- never a second,
    // parallel mission-creation path. Its own patterns already catch the
    // common "research X"/"build a dataset" phrasing directly (checked
    // ahead of this classifier by the caller); this is the
    // belt-and-suspenders path for a genuine research ask phrased without
    // those exact words.
    const researchResult = await respondResearchCommand({ message, opState, clock })
    if (researchResult) {
      return researchResult
    }
  }
  // PROJECT_REQUIRED / UNCLEAR / a RESEARCH_REQUEST the bridge itself still
  // couldn't make a real topic out of -- the caller falls through to its
  // own existing, honest "couldn't tell" fallback rather than guessing
  // further.
  return null
}

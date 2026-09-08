// Multi-Project Command + Real Fleet Orchestration Overnight V1, Parts
// A4-A6: Command <-> multi-action decomposition bridge. Same early-layer
// placement as the other command-*-bridge.mjs files (checked in
// command-responder.mjs ahead of ordinary intent/project classification),
// but this one IS about registered fleet projects -- domain/command-multi-
// action-decomposition.mjs does the real work of splitting one message into
// distinct (target, intent) actions; this file gives each action its real
// per-action authority check and a real execution/report path, reusing the
// SAME primitives every other Command surface already uses (planAndDispatchFromCommand,
// buildFleetAttentionItems, fleetWorkStatus) -- never a second execution
// engine.
import { decomposeMultiAction } from '../domain/command-multi-action-decomposition.mjs'
import { trimAttentionItem, buildFleetAttentionItems } from '../domain/fleet-attention-status.mjs'
import { fleetWorkStatus } from '../domain/fleet-work-status.mjs'
import { createProjectExecutionHold } from '../domain/project-execution-hold.mjs'
import { classifyDecision, classifyIntent } from './chat-responder.mjs'
import { planAndDispatchFromCommand } from './chat-dispatch-bridge.mjs'
import { withProjectExecutionHold } from './project-execution-hold-store.mjs'
import { readAllFindings } from './self-improvement-finding-store.mjs'

// A2's own required test: the gate this file's caller (command-responder.mjs)
// uses to decide "is this genuinely a multi-project, multi-action message,
// or the SAME single action already handled by dispatchAndRespond/the
// 'everything' quantifier". Deliberately conservative -- >=2 real targets
// AND >=2 genuinely DISTINCT non-generic intents, so an ordinary "check on
// niners-war-room and worldforge" (both GENERAL -- no distinguishing verb)
// or "run everything except tsf-orca" (a single uniform action) never gets
// rerouted away from their own existing, correct handling.
const GENERIC_INTENTS = new Set(['GENERAL', 'STATUS_QUERY'])

export function classifyMultiActionEntries(message, projects, aliases) {
  const entries = decomposeMultiAction(message, projects, aliases)
  const targets = new Set(entries.map((e) => e.target))
  const distinguishingIntents = new Set(entries.filter((e) => !GENERIC_INTENTS.has(e.intent)).map((e) => e.intent))
  return targets.size >= 2 && distinguishingIntents.size >= 2 ? entries : null
}

// EXTERNAL_WORK_HOLD really, durably records the hold BEFORE the response
// ever claims it did -- "never a promise with no backing durable record"
// (A6). Idempotent: re-stating an already-held project doesn't overwrite
// its original setBy/setAt/reason.
async function applyExternalWorkHold(project, rawClause, clock, deps) {
  const withHold = deps.withProjectExecutionHold ?? withProjectExecutionHold
  const hold = await withHold(project.id, (current) =>
    current && current.status === 'ACTIVE'
      ? current
      : createProjectExecutionHold(
          { projectId: project.id, reason: 'EXTERNAL_WORK_ACTIVE', setBy: 'OPERATOR_CHAT', note: rawClause },
          clock
        )
  )
  return {
    text: `Held -- ${hold.note ?? 'external work active'} (recorded, releasable later).`,
    category: 'BLOCKED_EXTERNAL',
    ok: true
  }
}

// Report-only, always -- the one architecturally hard constraint this whole
// mission preserves (chat-responder.mjs ~line 552: no automated adoption
// execution path exists anywhere in TSF). This never performs an adoption,
// under any authorization phrasing. deps.readAllFindings lets a test inject
// a fixed store snapshot, same convention as every other bridge here.
function reportAdoptionCandidate(project, opState, clock, deps) {
  const read = deps.readAllFindings ?? readAllFindings
  const items = buildFleetAttentionItems({
    projects: [project],
    keepGoingRuns: opState.keepGoingRuns ?? {},
    researchMissions: opState.researchMissions ?? {},
    plannerMissionRecords: opState.plannerMissions ?? {},
    selfImprovementFindings: read(),
    resourcePressureState: null,
    clock
  }).filter((i) => i.project?.id === project.id && i.category === 'READY_FOR_ADOPTION')
  if (items.length === 0) {
    return { text: 'Nothing ready for adoption right now.', category: null, ok: true }
  }
  return {
    text: `Ready for adoption (${items[0].reason}) -- chat can't adopt it (no automated adoption path exists); use the Adoption tab.`,
    category: 'READY_FOR_ADOPTION',
    ok: true
  }
}

// START_KEEP_GOING / ASSESS_AND_UPGRADE both real-dispatch, through the
// SAME planAndDispatchFromCommand fan-out dispatchAndRespond already uses --
// this is the one real per-action authority check that matters here: Part
// B's execution-hold gate lives INSIDE planAndDispatchFromChat (this
// dispatch's real downstream), so a held project is refused honestly by the
// same real choke point, never a second, duplicated hold check invented in
// this file.
async function dispatchAction(project, rawClause, clock, deps) {
  const dispatch = await planAndDispatchFromCommand({ projects: [project], message: rawClause, clock, deps })
  const [result] = dispatch.results
  if (result.ok) {
    return { text: `${result.detail}.`, category: null, ok: true }
  }
  return {
    text: `couldn't start -- ${result.reason}${result.detail ? ` (${result.detail})` : ''}.`,
    category: result.reason === 'PROJECT_EXECUTION_HOLD_ACTIVE' ? 'BLOCKED_EXTERNAL' : null,
    ok: false
  }
}

function reportStatus(project, opState, clock) {
  const [status] = fleetWorkStatus([project], opState.keepGoingRuns ?? {}, clock)
  return {
    text: status.hasRun ? `${status.feed.state} -- ${status.feed.reason}.` : 'no Keep Going run right now.',
    category: null,
    ok: true
  }
}

// One decomposed action's real per-action authority + execution/report.
// TIM_REQUIRED is evaluated per-CLAUSE (not once for the whole message) --
// A5's own requirement: one gated action must never block an independent,
// ungated action on a different target in the same message.
async function handleEntry(entry, project, opState, clock, deps) {
  const decisionClass = classifyDecision(entry.rawClause, classifyIntent(entry.rawClause))
  if (decisionClass === 'TIM_REQUIRED') {
    return {
      text: "that's a consequential decision -- I won't act on it automatically; tell me explicitly.",
      category: null,
      ok: false
    }
  }
  if (entry.intent === 'EXTERNAL_WORK_HOLD') {
    return applyExternalWorkHold(project, entry.rawClause, clock, deps)
  }
  if (entry.intent === 'ADOPT_CANDIDATE_REPORT') {
    return reportAdoptionCandidate(project, opState, clock, deps)
  }
  if (entry.intent === 'START_KEEP_GOING' || entry.intent === 'ASSESS_AND_UPGRADE') {
    return dispatchAction(project, entry.rawClause, clock, deps)
  }
  return reportStatus(project, opState, clock)
}

// A6: grouped-by-project response, stating what ACTUALLY happened (real
// durable/dispatch outcomes, never an intention). A4: resultItems reflects
// the FULL multi-project result set for real referential continuity on the
// NEXT turn (Part A2), never just one child project's.
export async function respondMultiActionCommand({ projects, opState, clock = () => new Date(), deps = {}, entries }) {
  const byProject = new Map()
  for (const entry of entries) {
    if (!byProject.has(entry.target)) {
      byProject.set(entry.target, [])
    }
    byProject.get(entry.target).push(entry)
  }

  const sections = []
  const resultItems = []
  const resolvedProjectIds = []
  // Sequential, not concurrent: keeps EXTERNAL_WORK_HOLD's durable write and
  // any dispatch attempt for the SAME message ordered and simple to reason
  // about; bounded by the real per-message action count (never unbounded).
  for (const [projectId, projectEntries] of byProject) {
    const project = projects.find((p) => p.id === projectId)
    if (!project) {
      sections.push(`**${projectId}**\n- unknown project, skipped.`)
      continue
    }
    resolvedProjectIds.push(project.id)
    const lines = []
    for (const entry of projectEntries) {
      // eslint-disable-next-line no-await-in-loop -- A5: one target's action must never block another's; sequential here is a simplicity choice, not a correctness dependency between targets
      const outcome = await handleEntry(entry, project, opState, clock, deps)
      lines.push(`- ${outcome.text}`)
      resultItems.push({
        id: `multi-action:${project.id}:${entry.intent}`,
        category: outcome.category,
        label: project.displayName,
        project: { id: project.id, displayName: project.displayName },
        reason: outcome.text
      })
    }
    sections.push(`**${project.displayName}**\n${lines.join('\n')}`)
  }

  return {
    intent: 'MULTI_ACTION',
    decisionClass: 'RECOMMEND_AND_PROCEED',
    text: sections.join('\n\n'),
    plannerRole: 'PLANNER_DEEP',
    providerLabel: 'PLANNER_DEEP · multi-project decomposition, real per-action dispatch/report',
    live: true,
    resolvedProjectIds,
    scope: 'MULTI_PROJECT',
    resultItems: resultItems.map(trimAttentionItem)
  }
}

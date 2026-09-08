// Operator Attention + Proactive Notifications V1, Wave 2: Command <-> fleet
// attention bridge. Same layer/reasoning as command-dogfood-bridge.mjs and
// command-self-improvement-bridge.mjs (checked early in command-responder.mjs,
// ahead of project-fleet intent classification) -- pure message-
// classification + read-only reporting glue over buildFleetAttentionItems
// (domain/fleet-attention-status.mjs) and, for the "while I was away"
// question, Wave 1's own drainDueAttentionNotifications reconciler. Only the
// 4 questions nothing existing already answers live here -- "what needs me?"
// and "what is ready for adoption?" stay in command-responder.mjs's
// NEEDS_YOU_QUERY handler and command-self-improvement-bridge.mjs
// respectively (both surgically extended to the same aggregator already).
import { buildFleetAttentionItems, trimAttentionItem } from '../domain/fleet-attention-status.mjs'
import { gatherRealFleetAttentionInputs, drainDueAttentionNotifications } from './attention-status-reconciler.mjs'
import { buildResourcePressureState } from '../domain/resource-pressure-governor.mjs'
import { collectHostMemoryEvidence } from './resource-pressure-collector.mjs'

const INTENT_PATTERNS = [
  { id: 'FLEET_ATTENTION_COMPLETED', test: (msg) => /\bwhat\s+(just\s+)?finished\b/i.test(msg) || /\bwhat\s+completed\b/i.test(msg) },
  { id: 'FLEET_ATTENTION_WAITING_ON_RESOURCES', test: (msg) => /\bwhat'?s?\s+waiting\s+on\s+resources?\b/i.test(msg) || /\banything\s+waiting\s+on\s+resources?\b/i.test(msg) },
  { id: 'FLEET_ATTENTION_FAILED_TODAY', test: (msg) => /\bwhat\s+failed\s+today\b/i.test(msg) },
  { id: 'FLEET_ATTENTION_CHANGED_WHILE_AWAY', test: (msg) => /\bdid\s+anything\s+change\s+while\s+i\s+(was\s+)?(gone|away)\b/i.test(msg) || /\bwhat\s+changed\s+while\s+i\s+(was\s+)?(gone|away)\b/i.test(msg) }
]

export function classifyFleetAttentionRequest(message) {
  for (const { id, test } of INTENT_PATTERNS) {
    if (test(message)) { return id }
  }
  return null
}

export function shouldRouteToFleetAttentionBridge(message) {
  return classifyFleetAttentionRequest(message) !== null
}

// Same fallback-to-real convention reconcileFleetAttentionItems itself
// established (attention-status-reconciler.mjs): only reads the real global
// project/run/mission/finding stores when the caller (a test) didn't already
// inject a fixed fleet snapshot. resourcePressureState is deliberately NOT
// included here -- only FLEET_ATTENTION_WAITING_ON_RESOURCES ever needs real
// host-memory evidence, so it's read separately, only by that one branch.
function realFleetInputs(deps) {
  const needsRealFleetRead = deps.projects === undefined || deps.keepGoingRuns === undefined
  const real = needsRealFleetRead ? gatherRealFleetAttentionInputs() : null
  return {
    projects: deps.projects ?? real.projects,
    keepGoingRuns: deps.keepGoingRuns ?? real.keepGoingRuns,
    researchMissions: deps.researchMissions ?? real?.researchMissions ?? {},
    plannerMissionRecords: deps.plannerMissionRecords ?? real?.plannerMissionRecords ?? {},
    selfImprovementFindings: deps.selfImprovementFindings ?? real?.selfImprovementFindings ?? {}
  }
}

function itemLine(item) {
  return `- **${item.label}** -- ${item.reason}`
}

function listOrNone(items, noneText) {
  return items.length === 0 ? noneText : items.map(itemLine).join('\n')
}

function isSameUtcDay(isoString, referenceDate) {
  if (!isoString) { return false }
  const d = new Date(isoString)
  if (Number.isNaN(d.getTime())) { return false }
  return (
    d.getUTCFullYear() === referenceDate.getUTCFullYear() &&
    d.getUTCMonth() === referenceDate.getUTCMonth() &&
    d.getUTCDate() === referenceDate.getUTCDate()
  )
}

function projectIdsFrom(items) {
  return [...new Set(items.map((i) => i.project?.id).filter(Boolean))]
}

// resolvedProjectIds/resultItems omitted -> honestly empty (no oxlint
// react/no-object-type-as-default-prop false-positive from a `= []`
// default parameter). resultItems (Part A2): a bounded, trimmed projection
// of the real AttentionItem[] this answer was actually built from, so a
// later turn's referring phrase can resolve against it -- honestly absent
// for FLEET_ATTENTION_CHANGED_WHILE_AWAY, which is sourced from drained
// notices, not AttentionItem[].
const RESPOND = ({ intent, text, resolvedProjectIds, resultItems }) => ({
  intent,
  decisionClass: 'RECOMMEND_AND_PROCEED',
  text,
  plannerRole: 'PLANNER_DEEP',
  providerLabel: 'PLANNER_DEEP · real read from the fleet-wide attention aggregator, no mutation',
  live: true,
  resolvedProjectIds: resolvedProjectIds ?? [],
  scope: 'FLEET_ATTENTION',
  resultItems: resultItems ?? []
})

export async function respondFleetAttentionCommand({ message, clock = () => new Date(), deps = {} }) {
  const intent = classifyFleetAttentionRequest(message)
  if (!intent) { return null }

  if (intent === 'FLEET_ATTENTION_COMPLETED') {
    const items = buildFleetAttentionItems({ ...realFleetInputs(deps), resourcePressureState: null, clock })
      .filter((i) => i.category === 'COMPLETED_RECENTLY')
    return RESPOND({
      intent,
      text: `Recently completed:\n${listOrNone(items, 'Nothing has completed recently.')}`,
      resolvedProjectIds: projectIdsFrom(items),
      resultItems: items.map(trimAttentionItem)
    })
  }

  if (intent === 'FLEET_ATTENTION_WAITING_ON_RESOURCES') {
    const resourcePressureState =
      deps.resourcePressureState ?? buildResourcePressureState({ hostMemory: collectHostMemoryEvidence() }, clock)
    const items = buildFleetAttentionItems({ ...realFleetInputs(deps), resourcePressureState, clock })
      .filter((i) => i.category === 'WAITING_FOR_RESOURCES')
    return RESPOND({
      intent,
      text: `Waiting on resources:\n${listOrNone(items, 'Nothing is currently waiting on host resources.')}`,
      resolvedProjectIds: projectIdsFrom(items),
      resultItems: items.map(trimAttentionItem)
    })
  }

  if (intent === 'FLEET_ATTENTION_FAILED_TODAY') {
    const now = clock()
    const items = buildFleetAttentionItems({ ...realFleetInputs(deps), resourcePressureState: null, clock })
      .filter((i) => i.category === 'FAILED_REQUIRES_ATTENTION' && isSameUtcDay(i.changedAt, now))
    return RESPOND({
      intent,
      text: `Failed today:\n${listOrNone(items, 'Nothing has failed today.')}`,
      resolvedProjectIds: projectIdsFrom(items),
      resultItems: items.map(trimAttentionItem)
    })
  }

  // FLEET_ATTENTION_CHANGED_WHILE_AWAY: an explicit, on-demand pull of the
  // SAME durable notification drain the chat-attach mechanism otherwise
  // waits for on the next unrelated turn -- deps passed straight through so
  // this stays real (real reconcile + real store) unless a test injects a
  // fixed fleet snapshot, exactly like every other real caller of
  // drainDueAttentionNotifications. No project ids are recoverable from a
  // drained notice's own {eventId, text} shape without fabricating a
  // lookup, so resolvedProjectIds is honestly empty here.
  const notices = await drainDueAttentionNotifications(clock, deps)
  return RESPOND({
    intent,
    text: notices.length === 0
      ? 'Nothing changed while you were away.'
      : notices.map((n) => `- ${n.text}`).join('\n')
  })
}

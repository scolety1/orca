// Reconciles + delivers attention-notification events (domain/attention-
// notification-event.mjs). Mirrors completion-watch-reconciler.mjs's shape:
// reconciles lazily on every chat turn, no new background scheduler. Calls
// Phase 2's buildFleetAttentionItems fresh each time -- re-observing the
// same live item is a true no-op (content-addressed eventId dedup), which
// is what makes this safe across a restart or two concurrent reconciles.
import { buildFleetAttentionItems } from '../domain/fleet-attention-status.mjs'
import { createAttentionNotificationEvent, markAttentionNotificationEventDelivered } from '../domain/attention-notification-event.mjs'
import {
  listAttentionNotificationEvents,
  registerAttentionNotificationEventIfAbsent,
  withAttentionNotificationEvent
} from './attention-notification-event-store.mjs'
import { projectsById } from './project-catalog.mjs'
import { readAllResearchMissions } from './research-mission-store.mjs'
import { readAllPlannerMissionRecords } from './planner-mission-store.mjs'
import { readAllFindings } from './self-improvement-finding-store.mjs'
import { buildResourcePressureState } from '../domain/resource-pressure-governor.mjs'
import { collectHostMemoryEvidence } from './resource-pressure-collector.mjs'

// Per the checkpoint doc's own locked Phase 5 design: BLOCKED_EXTERNAL is
// real and shown in the live Phase 2 view, but deliberately NOT notify-
// worthy this pass (no durable "just became blocked" transition signal
// exists independent of the live aggregation itself -- surfacing it would
// mean notifying on every reconcile a project happens to still be blocked,
// not on a real transition).
const NOTIFY_WORTHY_CATEGORIES = new Set([
  'NEEDS_OWNER',
  'READY_FOR_ADOPTION',
  'FAILED_REQUIRES_ATTENTION',
  'COMPLETED_RECENTLY',
  'WAITING_FOR_RESOURCES'
])

// What makes re-entering the SAME transition a true no-op (dedup) vs a
// fresh notification: a self-improvement finding's own `.status` (so a
// REPAIR_RETRY_BUDGET_EXCEEDED NEEDS_OWNER and an AUTOFIX_ELIGIBILITY_
// CLASSIFIED NEEDS_OWNER never collide -- they differ by `category`, which
// is also hashed into the eventId); a fixed literal for every other source,
// since none of them carry a finer-grained durable sub-state to key on.
function transitionSignatureFor(item, findingsById) {
  if (item.source.kind === 'SELF_IMPROVEMENT_FINDING') {
    return findingsById.get(item.source.id)?.status ?? item.category
  }
  if (item.category === 'WAITING_FOR_RESOURCES') {
    // The tier string itself -- see the resource-pressure-oscillation test
    // for the documented, deliberate consequence of this choice: re-
    // entering the SAME tier after clearing does not re-fire (no durable
    // previous-tier tracker exists to tell a real re-onset apart from
    // still-the-same-episode -- checkpoint doc's own disclosed, bounded
    // scope), but escalating to a genuinely worse tier does.
    return item.source.id
  }
  if (item.category === 'COMPLETED_RECENTLY') { return 'COMPLETED' }
  if (item.category === 'FAILED_REQUIRES_ATTENTION') { return 'STALLED' }
  if (item.category === 'READY_FOR_ADOPTION') { return 'READY_FOR_ADOPTION' }
  // Remaining case: NEEDS_OWNER sourced from fleetNeedsYouStatus (PROJECT/
  // RESEARCH/PLANNER needsYou), never from a self-improvement finding here.
  return 'NEEDS_YOU_OPEN'
}

// Real, default readers -- injectable so tests never touch the global
// store. `projectsById()` is read once (not once per field) so `projects`
// and `keepGoingRuns` are consistent with each other, not two independent
// snapshots of a state file that could change between calls.
function gatherRealDeps(clock) {
  const { map, opState } = projectsById()
  return {
    projects: [...map.values()],
    keepGoingRuns: opState.keepGoingRuns ?? {},
    researchMissions: readAllResearchMissions(),
    plannerMissionRecords: readAllPlannerMissionRecords(),
    selfImprovementFindings: readAllFindings(),
    resourcePressureState: buildResourcePressureState({ hostMemory: collectHostMemoryEvidence() }, clock)
  }
}

export async function reconcileFleetAttentionItems(clock, deps = {}) {
  const needsRealFleetRead = deps.projects === undefined || deps.keepGoingRuns === undefined
  const real = needsRealFleetRead ? gatherRealDeps(clock) : null
  const projects = deps.projects ?? real.projects
  const keepGoingRuns = deps.keepGoingRuns ?? real.keepGoingRuns
  const researchMissions = deps.researchMissions ?? real?.researchMissions ?? readAllResearchMissions()
  const plannerMissionRecords = deps.plannerMissionRecords ?? real?.plannerMissionRecords ?? readAllPlannerMissionRecords()
  const selfImprovementFindings = deps.selfImprovementFindings ?? real?.selfImprovementFindings ?? readAllFindings()
  const resourcePressureState =
    deps.resourcePressureState ??
    real?.resourcePressureState ??
    buildResourcePressureState({ hostMemory: collectHostMemoryEvidence() }, clock)

  const items = buildFleetAttentionItems({
    projects,
    keepGoingRuns,
    researchMissions,
    plannerMissionRecords,
    selfImprovementFindings,
    resourcePressureState,
    clock
  })
  const findingsById = new Map(Object.values(selfImprovementFindings).map((f) => [f.findingId, f]))

  const registered = []
  for (const item of items) {
    if (!NOTIFY_WORTHY_CATEGORIES.has(item.category)) { continue }
    const transitionSignature = transitionSignatureFor(item, findingsById)
    const fields = {
      category: item.category,
      sourceKind: item.source.kind,
      sourceId: item.source.id,
      transitionSignature,
      label: item.label,
      reason: item.reason,
      deepLink: item.deepLink,
      severity: item.severity
    }
    // eslint-disable-next-line no-await-in-loop -- bounded by real item count, mirrors reconcilePendingCompletionWatches's own sequential-await precedent
    const { event, created } = await registerAttentionNotificationEventIfAbsent(() =>
      createAttentionNotificationEvent(fields, clock)
    )
    if (created) { registered.push(event) }
  }
  return registered
}

const CATEGORY_VERB = Object.freeze({
  NEEDS_OWNER: 'needs you',
  READY_FOR_ADOPTION: 'is ready for adoption',
  FAILED_REQUIRES_ATTENTION: 'has failed and needs your attention',
  COMPLETED_RECENTLY: 'just completed'
})

function describeAttentionEvent(event) {
  if (event.category === 'WAITING_FOR_RESOURCES') {
    return `Host resource pressure reached **${event.sourceId}** -- ${event.reason}`
  }
  const verb = CATEGORY_VERB[event.category] ?? 'changed state'
  return `**${event.label}** ${verb}${event.reason ? ` -- ${event.reason}` : ''}.`
}

// Reconciles, then delivers every UNSEEN event exactly once, marking each
// DELIVERED before returning -- never re-delivered later. Mirrors
// drainDueCompletionNotifications's exact race-safe wonDelivery pattern.
export async function drainDueAttentionNotifications(clock, deps = {}) {
  await reconcileFleetAttentionItems(clock, deps)
  const due = listAttentionNotificationEvents().filter((e) => e.state === 'UNSEEN')
  const notices = []
  for (const event of due) {
    let wonDelivery = false
    // eslint-disable-next-line no-await-in-loop -- see reconcile's own comment
    await withAttentionNotificationEvent(event.eventId, (current) => {
      if (!current || current.state !== 'UNSEEN') {
        return current
      }
      wonDelivery = true
      return markAttentionNotificationEventDelivered(current, clock)
    })
    if (wonDelivery) {
      notices.push({ eventId: event.eventId, text: describeAttentionEvent(event) })
    }
  }
  return notices
}

// Prepends any due notices to a chat payload, surfacing them unprompted on
// Tim's next message regardless of what it's about. Mirrors
// attachDueCompletionNotices exactly, wired at the SAME call sites
// (http-server.mjs) alongside it -- not this wave's job (Wave 2).
export async function attachDueAttentionNotices(payload, clock, deps = {}) {
  let notices
  try {
    notices = await drainDueAttentionNotifications(clock, deps)
  } catch (error) {
    // Never turn an already-persisted chat answer into a failed response
    // over this augmentation (e.g. a lock timeout under contention).
    console.error('attention-status reconciliation failed:', error)
    return payload
  }
  if (!notices.length) {
    return payload
  }
  return { ...payload, text: [...notices.map((n) => n.text), payload.text].join('\n\n') }
}

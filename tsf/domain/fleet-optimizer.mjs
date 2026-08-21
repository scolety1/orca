// M12: TSF-native, deterministic fleet scheduler -- upgrades Active
// Fleet/Work Set from "these projects are active" into a proposed,
// explained execution schedule across all of them. Reuses M8's real
// dependency-aware computeCriticalPathSchedule (per project) and M5's
// real decideCapacityAction (unchanged) -- per Tim's own explicit
// preference, no OR-Tools/CP-SAT solver dependency is introduced; a
// simpler TSF-native scheduler is used instead. Pure, stateless, no
// side effects: this module never dispatches work or authorizes
// anything beyond a project's own existing Work Set/policy (acceptance
// item 8) -- it only produces a report Tim/TSF reviews before any real
// dispatch happens elsewhere.
import { computeCriticalPathSchedule } from './delivery-scheduling.mjs'
import { decideCapacityAction } from './capacity-policy.mjs'

// A provider capacity action that isn't a plain PROCEED genuinely
// changes the fleet's effective concurrency -- never just noted in a
// comment while scheduling proceeds as if nothing were wrong (acceptance
// item 3: "provider resets change the result").
function effectiveConcurrency(requestedConcurrency, capacityAction) {
  if (capacityAction === 'PAUSE_AND_CHECKPOINT') {
    return 0
  }
  if (capacityAction === 'REDUCE_CONCURRENCY') {
    return Math.max(1, Math.floor(requestedConcurrency / 2))
  }
  return requestedConcurrency
}

function buildReasoning(project, capacityAction, capacityReason, deadlineMet) {
  const parts = [`priority ${project.priority}`]
  if (capacityAction !== 'PROCEED') {
    parts.push(`provider capacity action ${capacityAction} (${capacityReason})`)
  }
  if (deadlineMet === false) {
    parts.push('deadline is NOT achievable at this priority/concurrency level')
  } else if (deadlineMet === true) {
    parts.push('deadline is achievable')
  }
  return parts.join('; ')
}

// projects: [{ projectId, priority (lower = higher priority), wbs (already
// normalized, see estimation.mjs's normalizeWbs), deadlineHours (optional) }]
export function buildFleetSchedule({
  projects,
  maxConcurrentWorkers = 2,
  capacitySnapshot = null,
  providerId = 'codex'
}) {
  if (!Array.isArray(projects) || projects.length === 0) {
    throw new Error('at least one project is required to build a fleet schedule')
  }
  const capacityDecision = decideCapacityAction(capacitySnapshot, providerId)
  const concurrency = effectiveConcurrency(maxConcurrentWorkers, capacityDecision.action)

  // Deterministic priority ordering (acceptance item 10): lower priority
  // number goes first; ties broken by projectId for reproducibility.
  const ordered = [...projects].sort(
    (a, b) => a.priority - b.priority || a.projectId.localeCompare(b.projectId)
  )

  // Fleet-wide concurrency pool: every project's tasks compete for the
  // SAME `concurrency` slots (Windows safety, acceptance item 5), not a
  // per-project allowance -- a lower-priority project's task that would
  // exceed the shared cap is pushed later, regardless of its own
  // internal critical path.
  const globalBusyIntervals = []
  const projectSchedules = ordered.map((project) => {
    if (concurrency === 0) {
      return {
        projectId: project.projectId,
        priority: project.priority,
        schedule: [],
        totalDurationHours: null,
        deadlineHours: project.deadlineHours ?? null,
        deadlineMet: null,
        reasoning: buildReasoning(project, capacityDecision.action, capacityDecision.reason, null)
      }
    }
    // Each project's own dependency-aware critical path first (M8,
    // unchanged) -- the fleet scheduler re-places those tasks onto the
    // shared timeline, it never re-derives per-project dependency order.
    const perProjectSchedule = computeCriticalPathSchedule(project.wbs, {
      maxConcurrent: project.wbs.length
    })
    const placed = []
    for (const task of perProjectSchedule.schedule) {
      let start = task.startHour
      for (let attempt = 0; attempt < placed.length + globalBusyIntervals.length + 2; attempt++) {
        const overlapping = globalBusyIntervals.filter(
          (iv) => start < iv.end && start + task.durationHours > iv.start
        )
        if (overlapping.length < concurrency) {
          break
        }
        start = Math.min(...overlapping.map((iv) => iv.end))
      }
      const end = start + task.durationHours
      globalBusyIntervals.push({ start, end })
      placed.push({ ...task, startHour: start, endHour: end })
    }
    const totalDurationHours = placed.length ? Math.max(...placed.map((p) => p.endHour)) : 0
    const deadlineMet =
      project.deadlineHours == null ? null : totalDurationHours <= project.deadlineHours
    return {
      projectId: project.projectId,
      priority: project.priority,
      schedule: placed,
      totalDurationHours,
      deadlineHours: project.deadlineHours ?? null,
      deadlineMet,
      reasoning: buildReasoning(
        project,
        capacityDecision.action,
        capacityDecision.reason,
        deadlineMet
      )
    }
  })

  return {
    schemaVersion: 'TSF_FLEET_SCHEDULE_V1',
    requestedConcurrency: maxConcurrentWorkers,
    effectiveConcurrency: concurrency,
    providerId,
    capacityAction: capacityDecision.action,
    capacityReason: capacityDecision.reason,
    projects: projectSchedules
  }
}

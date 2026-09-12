// Operator Attention V1, Phase 2: the ONE fleet-wide "what needs Tim's
// attention" projection. Composes existing aggregators (fleet-work-status.mjs,
// work-feed-summary.mjs, self-improvement findings, resource pressure) into a
// single honest item list -- never a second, independently-derived truth
// store. See tsf/docs/tsf/OPERATOR_ATTENTION_NOTIFICATIONS_V1_CHECKPOINT.md
// for the locked reconciliation this implements.
import { fleetNeedsYouStatus } from './fleet-work-status.mjs'
import { summarizeWorkFromRuns } from './work-feed-summary.mjs'
import { computeRepairMissionId } from '../server/self-improvement-mission-origination.mjs'

export const ATTENTION_CATEGORIES = Object.freeze([
  'NEEDS_OWNER',
  'READY_FOR_ADOPTION',
  'WAITING_FOR_RESOURCES',
  'FAILED_REQUIRES_ATTENTION',
  'BLOCKED_EXTERNAL',
  'COMPLETED_RECENTLY'
])

const DEFAULT_SEVERITY_BY_CATEGORY = Object.freeze({
  NEEDS_OWNER: 'P1',
  FAILED_REQUIRES_ATTENTION: 'P1',
  WAITING_FOR_RESOURCES: 'P1',
  READY_FOR_ADOPTION: 'P2',
  BLOCKED_EXTERNAL: 'P2',
  COMPLETED_RECENTLY: 'P3'
})

function projectRef(displayNameById, projectId) {
  if (!projectId) {
    return null
  }
  return { id: projectId, displayName: displayNameById.get(projectId) ?? projectId }
}

// fleetNeedsYouStatus's own contract (fleet-work-status.mjs) is narrow and
// reused verbatim -- it does not expose the real raisedAt/missionId a
// notification needs, so those are recovered here by indexing the SAME raw
// records fleetNeedsYouStatus itself reads, keyed by the needsYou entry's own
// (content-hashed, effectively unique) id -- never a second guess at what
// fleetNeedsYouStatus already computed.
function indexNeedsYouOrigins(keepGoingRuns, researchMissions, plannerMissionRecords) {
  const project = new Map() // entryId -> raisedAt
  for (const run of Object.values(keepGoingRuns)) {
    for (const entry of run.needsYou ?? []) {
      project.set(entry.id, entry.raisedAt)
    }
  }
  const research = new Map() // entryId -> { raisedAt, missionId }
  for (const mission of Object.values(researchMissions)) {
    for (const entry of mission.needsYou ?? []) {
      research.set(entry.id, { raisedAt: entry.raisedAt, missionId: mission.id })
    }
  }
  const planner = new Map() // entryId -> { at, missionId }
  for (const [missionId, record] of Object.entries(plannerMissionRecords)) {
    for (const entry of record?.checkpoint?.needsYou ?? []) {
      planner.set(entry.id, { at: entry.at, missionId })
    }
  }
  return { project, research, planner }
}

function needsYouItems(needsYou, origins, displayNameById) {
  return needsYou.map((entry) => {
    if (entry.source === 'PROJECT') {
      return {
        id: `needsyou:PROJECT:${entry.id}`,
        category: 'NEEDS_OWNER',
        severity: DEFAULT_SEVERITY_BY_CATEGORY.NEEDS_OWNER,
        project: projectRef(displayNameById, entry.projectId),
        label: entry.label,
        reason: entry.question,
        changedAt: origins.project.get(entry.id) ?? null,
        deepLink: { kind: 'PROJECT', id: entry.projectId },
        source: { kind: 'KEEP_GOING_RUN', id: entry.projectId }
      }
    }
    if (entry.source === 'RESEARCH') {
      const origin = origins.research.get(entry.id) ?? null
      return {
        id: `needsyou:RESEARCH:${entry.id}`,
        category: 'NEEDS_OWNER',
        severity: DEFAULT_SEVERITY_BY_CATEGORY.NEEDS_OWNER,
        project: projectRef(displayNameById, entry.projectId),
        label: entry.label,
        reason: entry.question,
        changedAt: origin?.raisedAt ?? null,
        deepLink: { kind: 'RESEARCH_MISSION', id: origin?.missionId ?? null },
        source: { kind: 'RESEARCH_MISSION', id: origin?.missionId ?? null }
      }
    }
    // PLANNER -- no real project association exists on a planner checkpoint
    // (repoState is branch/sha/worktreePath, not a project id), so project
    // stays honestly null, matching fleetNeedsYouStatus's own convention.
    const origin = origins.planner.get(entry.id) ?? null
    return {
      id: `needsyou:PLANNER:${entry.id}`,
      category: 'NEEDS_OWNER',
      severity: DEFAULT_SEVERITY_BY_CATEGORY.NEEDS_OWNER,
      project: null,
      label: entry.label,
      reason: entry.question,
      changedAt: origin?.at ?? null,
      deepLink: { kind: 'PLANNER_MISSION', id: origin?.missionId ?? null },
      source: { kind: 'PLANNER_MISSION_NEEDS_YOU', id: entry.id }
    }
  })
}

function stalledItems(stalled, displayNameById) {
  return stalled.map((entry) => ({
    id: `run:${entry.id}:stalled`,
    category: 'FAILED_REQUIRES_ATTENTION',
    severity: DEFAULT_SEVERITY_BY_CATEGORY.FAILED_REQUIRES_ATTENTION,
    project: projectRef(displayNameById, entry.id),
    label: entry.displayName,
    reason: entry.liveWorkFeed?.reason ?? 'run is stalled',
    changedAt: entry.lastCheckpointAt ?? null,
    deepLink: { kind: 'PROJECT', id: entry.id },
    source: { kind: 'KEEP_GOING_RUN', id: entry.id }
  }))
}

// readyForAdoption mixes legacy (operator-adoption-candidate, no Keep Going
// run) and run-sourced entries -- distinguished by the presence of `runId`,
// the one field only run-sourced entries carry. Legacy entries have no real
// per-item "became ready" timestamp anywhere in the project record (no
// fabricated stand-in -- see module header), so changedAt is honestly null.
function readyForAdoptionItems(readyForAdoption, displayNameById) {
  return readyForAdoption.map((entry) => {
    const isRunSourced = entry.runId !== undefined
    return {
      id: `run:${entry.id}:readyForAdoption`,
      category: 'READY_FOR_ADOPTION',
      severity: DEFAULT_SEVERITY_BY_CATEGORY.READY_FOR_ADOPTION,
      project: projectRef(displayNameById, entry.id),
      label: entry.displayName,
      reason: isRunSourced
        ? (entry.liveWorkFeed?.reason ?? 'ready for adoption')
        : 'adoption candidate is ready for adoption',
      changedAt: isRunSourced ? (entry.lastCheckpointAt ?? null) : null,
      deepLink: { kind: 'PROJECT', id: entry.id },
      source: isRunSourced
        ? { kind: 'KEEP_GOING_RUN', id: entry.id }
        : { kind: 'PROJECT_ADOPTION_CANDIDATE', id: entry.id }
    }
  })
}

// blocked mixes legacy (project.mission.state startsWith 'BLOCKED', no real
// per-item timestamp available anywhere -- honestly null) and research-
// mission-sourced entries (kind: 'RESEARCH_MISSION', real updatedAt).
function blockedItems(blocked, researchMissions, displayNameById) {
  return blocked.map((entry) => {
    if (entry.kind === 'RESEARCH_MISSION') {
      const mission = researchMissions[entry.missionId]
      const reason = mission?.transitions?.at(-1)?.reason ?? 'research mission is blocked'
      return {
        id: `research:${entry.missionId}:blocked`,
        category: 'BLOCKED_EXTERNAL',
        severity: DEFAULT_SEVERITY_BY_CATEGORY.BLOCKED_EXTERNAL,
        project: projectRef(displayNameById, entry.projectId),
        label: entry.researchQuestion ?? entry.missionId,
        reason,
        changedAt: entry.updatedAt ?? null,
        deepLink: { kind: 'RESEARCH_MISSION', id: entry.missionId },
        source: { kind: 'RESEARCH_MISSION', id: entry.missionId }
      }
    }
    return {
      id: `legacy:${entry.id}:blocked`,
      category: 'BLOCKED_EXTERNAL',
      severity: DEFAULT_SEVERITY_BY_CATEGORY.BLOCKED_EXTERNAL,
      project: projectRef(displayNameById, entry.id),
      label: entry.displayName,
      reason: entry.mission?.blockedReason ?? 'blocked',
      changedAt: null,
      deepLink: { kind: 'PROJECT', id: entry.id },
      source: { kind: 'PROJECT_LEGACY_BLOCKED', id: entry.id }
    }
  })
}

// Real finding (#11) fix: this used to independently re-derive its own
// Keep-Going-run completion signal straight from fleetWorkStatus's live
// feed state (COMPLETED -- reserved by live-work-feed.mjs for a run whose
// project has since been adopted) -- but projectLiveWorkFeedState never
// actually emits COMPLETED (a real, pre-existing, already-disclosed gap;
// see work-feed-summary.mjs's own header), so this loop was structurally
// dead code for every real Keep-Going-run project, no matter how many were
// genuinely adopted. Fixed by reading from `recentlyCompleted` -- the
// SAME, now-adoption-aware unified list work-feed-summary.mjs's own
// summarizeWorkFromRuns already builds (legacy/run/research completions
// merged there, computed once, never a second independently-drifting
// classification here). A research-mission entry is distinguished by
// `kind === 'RESEARCH_MISSION'` (researchMissionWorkItem's own real
// shape). A project-run entry with `sourceKind === 'LEGACY_CANDIDATE_
// DECISION'` is skipped here -- this fix's own first attempt included it
// and broke the pre-existing, deliberate exclusion below (the operator
// directly decided ADOPT/REJECT through that flow, already knows,
// caught by this module's own real regression test) -- everything else
// is a real KEEP_GOING_RUN_ADOPTED entry (this fix's actual target: a
// real merge the operator may NOT already know about from this surface),
// which now always carries an honest `reason`.
function completedRecentlyItems(recentlyCompleted, displayNameById) {
  const items = []
  for (const entry of recentlyCompleted) {
    if (entry.kind === 'RESEARCH_MISSION') {
      items.push({
        id: `research:${entry.missionId}:completed`,
        category: 'COMPLETED_RECENTLY',
        severity: DEFAULT_SEVERITY_BY_CATEGORY.COMPLETED_RECENTLY,
        project: projectRef(displayNameById, entry.projectId),
        label: entry.researchQuestion ?? entry.missionId,
        reason: 'research mission reached COMPLETE',
        changedAt: entry.updatedAt,
        deepLink: { kind: 'RESEARCH_MISSION', id: entry.missionId },
        source: { kind: 'RESEARCH_MISSION', id: entry.missionId }
      })
      continue
    }
    if (entry.sourceKind === 'LEGACY_CANDIDATE_DECISION') {
      continue
    }
    items.push({
      id: `run:${entry.id}:completed`,
      category: 'COMPLETED_RECENTLY',
      severity: DEFAULT_SEVERITY_BY_CATEGORY.COMPLETED_RECENTLY,
      project: projectRef(displayNameById, entry.id),
      label: entry.displayName ?? displayNameById.get(entry.id) ?? entry.id,
      reason: entry.reason ?? 'completed',
      changedAt: entry.adoptedAt ?? null,
      deepLink: { kind: 'PROJECT', id: entry.id },
      source: { kind: 'KEEP_GOING_RUN', id: entry.id }
    })
  }
  return items
}

// Split by the SAME transition-reason distinction command-self-improvement-
// bridge.mjs already establishes (lines ~95-125): a real repair attempt that
// exhausted its retry budget is a genuine failure, distinct from eligibility
// declining to attempt one at all.
function selfImprovementItems(selfImprovementFindings, displayNameById) {
  const items = []
  for (const finding of Object.values(selfImprovementFindings)) {
    const lastReason = finding.transitions?.at(-1)?.reason
    let category = null
    let reason = null
    if (finding.status === 'NEEDS_OWNER' && lastReason === 'AUTOFIX_ELIGIBILITY_CLASSIFIED') {
      category = 'NEEDS_OWNER'
      reason = `Not eligible for autofix${finding.authorityRequired ? ` (${finding.authorityRequired})` : ''} -- needs your call.`
    } else if (finding.status === 'NEEDS_OWNER' && lastReason === 'REPAIR_RETRY_BUDGET_EXCEEDED') {
      category = 'FAILED_REQUIRES_ATTENTION'
      reason =
        'Automated repair attempts failed and exhausted the retry budget -- needs your review.'
    } else if (finding.status === 'READY_FOR_ADOPTION') {
      category = 'READY_FOR_ADOPTION'
      reason = 'A fix is ready for your review and adoption.'
    }
    if (!category) {
      continue
    }
    items.push({
      id: `finding:${finding.findingId}`,
      category,
      severity: finding.severity ?? DEFAULT_SEVERITY_BY_CATEGORY[category],
      project: projectRef(displayNameById, finding.projectId),
      label: finding.affectedSurface,
      reason,
      changedAt: finding.updatedAt,
      deepLink: { kind: 'SELF_IMPROVEMENT_FINDING', id: finding.findingId },
      source: { kind: 'SELF_IMPROVEMENT_FINDING', id: finding.findingId }
    })
  }
  return items
}

// Multi-Project Command + Real Fleet Orchestration Overnight V1, Part B: a
// real, active project execution hold is exactly the "known, not urgent,
// not actionable by Tim right now" shape BLOCKED_EXTERNAL already exists
// for (see blockedItems above) -- REUSE the category rather than inventing
// a new one, source it from the new durable store instead of the legacy
// mission.blockedReason/research-mission shapes that category already
// mixes.
function holdItems(projectExecutionHolds, displayNameById) {
  return Object.values(projectExecutionHolds)
    .filter((hold) => hold.status === 'ACTIVE')
    .map((hold) => ({
      id: `hold:${hold.projectId}`,
      category: 'BLOCKED_EXTERNAL',
      severity: DEFAULT_SEVERITY_BY_CATEGORY.BLOCKED_EXTERNAL,
      project: projectRef(displayNameById, hold.projectId),
      label: displayNameById.get(hold.projectId) ?? hold.projectId,
      reason: hold.note ?? `execution held -- ${hold.reason}`,
      changedAt: hold.setAt,
      deepLink: { kind: 'PROJECT', id: hold.projectId },
      source: { kind: 'PROJECT_EXECUTION_HOLD', id: hold.projectId }
    }))
}

function resourcePressureItem(resourcePressureState) {
  if (!resourcePressureState) {
    return null
  }
  if (!['CRITICAL', 'EMERGENCY'].includes(resourcePressureState.tier)) {
    return null
  }
  return {
    id: `resource-pressure:${resourcePressureState.tier}`,
    category: 'WAITING_FOR_RESOURCES',
    severity: DEFAULT_SEVERITY_BY_CATEGORY.WAITING_FOR_RESOURCES,
    project: null,
    label: 'Host resource pressure',
    reason:
      resourcePressureState.admission?.reason ??
      `host memory tier is ${resourcePressureState.tier}`,
    changedAt: resourcePressureState.observedAt,
    deepLink: { kind: 'RESOURCE_PRESSURE', id: null },
    source: { kind: 'RESOURCE_PRESSURE_TIER', id: resourcePressureState.tier }
  }
}

// Resource-Wait Auto-Resume V1: the fleet-wide resourcePressureItem above
// answers "is the HOST under pressure" but never names WHICH project is
// waiting or whether it needs Tim at all -- the exact gap that let a
// resource wait read as indistinguishable from a genuine STALLED failure.
// Read directly off each run's own durable checkpoint/pendingDispatch
// (no separate resourcePressureState needed -- unlike the host-level item
// above, this is honest even when host memory currently isn't being
// re-measured for this request) so "why isn't EasyLife running" and "will
// Nytheria start on its own" both have a real, per-project, always-
// available answer.
function resourceBlockedRunItems(keepGoingRuns, displayNameById) {
  return Object.entries(keepGoingRuns)
    .filter(
      ([, run]) =>
        run.state === 'ACTIVE' && run.checkpoints.at(-1)?.phase === 'DISPATCH_WAITING_FOR_RESOURCES'
    )
    .map(([projectId, run]) => {
      const lastCheckpoint = run.checkpoints.at(-1)
      const willAutoResume = !!run.pendingDispatch
      return {
        id: `run:${projectId}:waitingForResources`,
        category: 'WAITING_FOR_RESOURCES',
        severity: DEFAULT_SEVERITY_BY_CATEGORY.WAITING_FOR_RESOURCES,
        project: projectRef(displayNameById, projectId),
        label: displayNameById.get(projectId) ?? projectId,
        reason: willAutoResume
          ? `waiting for host memory to ease (${lastCheckpoint.note ?? 'resource pressure'}) -- will resume automatically, no action needed`
          : `waiting for host memory to ease (${lastCheckpoint.note ?? 'resource pressure'}) -- this run has no recorded first-wave dispatch to auto-resume yet`,
        changedAt: lastCheckpoint.at,
        deepLink: { kind: 'PROJECT', id: projectId },
        source: { kind: 'KEEP_GOING_RUN', id: projectId }
      }
    })
}

// ACTIVE avoids retaining a stale wait beside a later authoritative outcome.
function resourceBlockedResearchMissionItems(researchMissions, displayNameById) {
  return Object.values(researchMissions)
    .filter(
      (mission) =>
        mission.state === 'ACTIVE' &&
        mission.checkpoints?.at(-1)?.phase === 'DISPATCH_WAITING_FOR_RESOURCES'
    )
    .map((mission) => {
      const lastCheckpoint = mission.checkpoints.at(-1)
      const detail = lastCheckpoint.note ?? lastCheckpoint.reason ?? 'resource pressure'
      return {
        id: `research:${mission.id}:waitingForResources`,
        category: 'WAITING_FOR_RESOURCES',
        severity: DEFAULT_SEVERITY_BY_CATEGORY.WAITING_FOR_RESOURCES,
        project: projectRef(displayNameById, mission.projectId),
        label: mission.specification?.researchQuestion ?? mission.id,
        reason: `waiting for host resources: ${detail}`,
        changedAt: lastCheckpoint.at,
        deepLink: { kind: 'RESEARCH_MISSION', id: mission.id },
        source: { kind: 'RESEARCH_MISSION', id: mission.id }
      }
    })
}

// A refused repair dispatch records its governor observation on the repair
// mission's own durable checkpoint, so this is finding-specific evidence
// rather than an inference from the current host-wide pressure tier.
function resourceBlockedSelfImprovementItems(
  selfImprovementFindings,
  plannerMissionRecords,
  displayNameById
) {
  return Object.values(selfImprovementFindings)
    .filter((finding) => ['FIX_MISSION_CREATED', 'FIX_IN_PROGRESS'].includes(finding.status))
    .flatMap((finding) => {
      const resourceState =
        plannerMissionRecords[computeRepairMissionId(finding.findingId)]?.checkpoint?.resourceState
      // Independent-adversarial-review finding (P2, real, reproduced): a
      // truthy but malformed resourceState (e.g. `{}`) passed the old
      // bare truthiness check and produced a garbled "at tier undefined:
      // undefined" attention item with no usable changedAt. resourceState
      // is only ever written by this program's own recordResourceState
      // call with a real {tier, reason, observedAt} shape or null (never
      // any other value) -- a malformed shape here would mean something
      // else wrote to this field unexpectedly, and honestly ignoring it
      // (never fabricating a broken card) is safer than rendering
      // incomplete evidence.
      if (!resourceState?.tier || !resourceState?.reason || !resourceState?.observedAt) {
        return []
      }
      return [
        {
          id: `finding:${finding.findingId}:waitingForResources`,
          category: 'WAITING_FOR_RESOURCES',
          severity: finding.severity ?? DEFAULT_SEVERITY_BY_CATEGORY.WAITING_FOR_RESOURCES,
          project: projectRef(displayNameById, finding.projectId),
          label: finding.affectedSurface,
          reason: `repair is waiting for resources at tier ${resourceState.tier}: ${resourceState.reason}`,
          changedAt: resourceState.observedAt,
          deepLink: { kind: 'SELF_IMPROVEMENT_FINDING', id: finding.findingId },
          source: { kind: 'SELF_IMPROVEMENT_FINDING', id: finding.findingId }
        }
      ]
    })
}

export function buildFleetAttentionItems({
  projects,
  keepGoingRuns = {},
  researchMissions = {},
  plannerMissionRecords = {},
  selfImprovementFindings = {},
  projectExecutionHolds = {},
  // Real finding (#11) fix: without this, summarizeWorkFromRuns below has
  // no way to tell a genuinely READY_FOR_ADOPTION run from one that has
  // ALREADY been really adopted (see that function's own header comment).
  // Defaults to {} (existing callers that never pass it keep their exact
  // current behavior -- no fabrication if this evidence isn't supplied).
  projectCanonicalBases = {},
  resourcePressureState = null,
  clock = () => new Date()
}) {
  const displayNameById = new Map(projects.map((p) => [p.id, p.displayName]))
  const origins = indexNeedsYouOrigins(keepGoingRuns, researchMissions, plannerMissionRecords)
  const needsYou = fleetNeedsYouStatus(
    projects,
    keepGoingRuns,
    researchMissions,
    plannerMissionRecords
  )
  const workSummary = summarizeWorkFromRuns(
    projects,
    keepGoingRuns,
    clock,
    researchMissions,
    projectCanonicalBases
  )

  const items = [
    ...needsYouItems(needsYou, origins, displayNameById),
    ...stalledItems(workSummary.stalled, displayNameById),
    ...readyForAdoptionItems(workSummary.readyForAdoption, displayNameById),
    ...blockedItems(workSummary.blocked, researchMissions, displayNameById),
    ...completedRecentlyItems(workSummary.recentlyCompleted, displayNameById),
    ...selfImprovementItems(selfImprovementFindings, displayNameById),
    ...holdItems(projectExecutionHolds, displayNameById),
    ...resourceBlockedRunItems(keepGoingRuns, displayNameById),
    ...resourceBlockedResearchMissionItems(researchMissions, displayNameById),
    ...resourceBlockedSelfImprovementItems(
      selfImprovementFindings,
      plannerMissionRecords,
      displayNameById
    )
  ]
  const resourceItem = resourcePressureItem(resourcePressureState)
  if (resourceItem) {
    items.push(resourceItem)
  }
  return items
}

// Command architecture, referential continuity (Part A2): the bounded,
// durable per-turn projection of an AttentionItem a later turn's referring
// phrase ("the stalled one", "the UI one") can resolve against --
// deliberately smaller than the full item (no deepLink/source/severity/
// changedAt) to keep the persisted chat record small; every field a real
// referring-phrase resolution needs is kept.
export function trimAttentionItem(item) {
  return {
    id: item.id,
    category: item.category,
    label: item.label,
    project: item.project ? { id: item.project.id, displayName: item.project.displayName } : null,
    reason: item.reason
  }
}

// Buckets fleetWorkStatus's per-project "what's really happening" into the
// Work page's sections. This closes the exact "tsf-orca: Started." -> "No
// active missions" defect: a project with a real Keep Going run is now
// bucketed by its live feed state (live-work-feed.mjs's 9-state vocabulary),
// including PLANNING (a run that exists but hasn't dispatched a wave yet) --
// which lands in `active`, not nowhere. A project with NO run falls through
// to exactly the legacy mission.state/candidate-state classification the
// original summarizeWork used -- merge, never replace: `blocked` stays a
// legacy, onboarding-time-only bucket (no Keep Going run makes a project
// less/more blocked in that sense), independent of `needsYou`/`stalled`,
// which are purely run-driven and have no legacy equivalent.
import { fleetWorkStatus } from './fleet-work-status.mjs'
import { computeResearchMissionPhase } from './research-mission.mjs'

// Real free-path research execution finding: this aggregation (Work page/
// Home) had zero ResearchMission awareness at all -- a mission genuinely
// EXECUTING never appeared here even though it does now appear in
// Command's own fleet-status text (fleet-work-status.mjs's
// fleetResearchStatus). Mapped onto the SAME phase vocabulary
// computeResearchMissionPhase already produces -- no second, independently-
// derived classification. Disclosed, not fixed here: there is no durable
// per-mission "WAITING_FOR_RESOURCES" signal to bucket from (that decision
// is made fresh each driver cycle, never persisted) -- a real, small,
// separately-scoped follow-up, not implemented in this pass.
const RESEARCH_PHASE_SECTION = Object.freeze({
  EXECUTING: 'active',
  WAITING_NEEDS_INPUT: 'needsYou',
  COMPLETE: 'recentlyCompleted',
  BLOCKED: 'blocked'
})

// Operator IA consolidation: enough for HQ/Work to render a real title/
// stats line ("NFL Salary Cap 2018-2020 · RESEARCH · 3 expected items ·
// Free-path only") without a second round-trip -- same fields
// readAllResearchMissionSummaries (research-mission-driver.mjs) exposes,
// computed here directly since this module has the mission object already.
function researchMissionWorkItem(mission, phase) {
  return {
    kind: 'RESEARCH_MISSION',
    missionId: mission.id,
    phase,
    updatedAt: mission.updatedAt,
    researchQuestion: mission.specification?.researchQuestion ?? null,
    entityType: mission.specification?.entityType ?? null,
    expectedCount: mission.expectedUniverse?.expectedCount ?? null,
    freePathOnly: (mission.specification?.budget?.maxCostUsd ?? 0) === 0,
    projectId: mission.projectId ?? null
  }
}

// live-work-feed.mjs's vocabulary reserves COMPLETED for a run whose
// project has since been adopted -- projectLiveWorkFeedState itself never
// emits it today (adoption is tracked separately via mission.state ===
// 'ADOPTED', not a run.state), so this branch is forward-compatible rather
// than currently reachable; documented here, not fabricated.
const RUN_FEED_SECTION = Object.freeze({
  PLANNING: 'active',
  WORKING: 'active',
  WAITING: 'active',
  VERIFYING: 'verifying',
  REVISION: 'verifying',
  NEEDS_YOU: 'needsYou',
  STALLED: 'stalled',
  READY_FOR_ADOPTION: 'readyForAdoption',
  COMPLETED: 'recentlyCompleted'
})

function recentlyCompletedEntry(project, missionId, adoptedAt) {
  return { id: project.id, displayName: project.displayName, missionId, adoptedAt }
}

export function summarizeWorkFromRuns(projects, keepGoingRuns = {}, clock = () => new Date(), researchMissions = {}) {
  const statusByProjectId = new Map(
    fleetWorkStatus(projects, keepGoingRuns, clock).map((status) => [status.projectId, status])
  )

  // Legacy classification -- unchanged from the original summarizeWork,
  // computed only for projects with no real run (see module header).
  const legacyActive = []
  const legacyReadyForAdoption = []
  const legacyRecentlyCompleted = []
  // `blocked` has no run-driven equivalent -- always the static,
  // onboarding-time classification, for every project regardless of run.
  const blocked = projects.filter((p) => (p.mission.state ?? '').startsWith('BLOCKED'))

  const runActive = []
  const queued = []
  const verifying = []
  const needsYou = []
  const stalled = []
  const runReadyForAdoption = []
  const runRecentlyCompleted = []

  for (const project of projects) {
    const status = statusByProjectId.get(project.id)
    if (!status?.hasRun) {
      if (['ACTIVE', 'PLANNING', 'REVIEW'].includes(project.mission.state)) {
        legacyActive.push(project)
      }
      if (project.candidate?.state === 'READY_FOR_ADOPTION') {
        legacyReadyForAdoption.push(project)
      }
      if (project.mission.state === 'ADOPTED') {
        legacyRecentlyCompleted.push(
          recentlyCompletedEntry(
            project,
            project.mission.id,
            project.receipts?.chain?.at(-1)?.timestamp ?? null
          )
        )
      }
      continue
    }
    const item = {
      ...project,
      liveWorkFeed: status.feed,
      runId: status.runId,
      lastCheckpointAt: status.lastCheckpointAt
    }
    const section = RUN_FEED_SECTION[status.feed.state]
    switch (section) {
      case 'active':
        runActive.push(item)
        break
      case 'verifying':
        verifying.push(item)
        break
      case 'needsYou':
        needsYou.push(item)
        break
      case 'stalled':
        stalled.push(item)
        break
      case 'readyForAdoption':
        runReadyForAdoption.push(item)
        break
      case 'recentlyCompleted':
        runRecentlyCompleted.push(
          recentlyCompletedEntry(
            project,
            status.runId,
            keepGoingRuns[project.id]?.updatedAt ?? null
          )
        )
        break
      default:
        break
    }
  }

  const researchActive = []
  const researchNeedsYou = []
  const researchRecentlyCompleted = []
  const researchBlocked = []
  for (const mission of Object.values(researchMissions)) {
    const phase = computeResearchMissionPhase(mission)
    const section = RESEARCH_PHASE_SECTION[phase]
    const item = researchMissionWorkItem(mission, phase)
    if (section === 'active') {
      researchActive.push(item)
    } else if (section === 'needsYou') {
      researchNeedsYou.push(item)
    } else if (section === 'recentlyCompleted') {
      researchRecentlyCompleted.push(item)
    } else if (section === 'blocked') {
      researchBlocked.push(item)
    }
  }

  return {
    active: [...legacyActive, ...runActive, ...researchActive],
    queued,
    verifying,
    needsYou: [...needsYou, ...researchNeedsYou],
    stalled,
    blocked: [...blocked, ...researchBlocked],
    readyForAdoption: [...legacyReadyForAdoption, ...runReadyForAdoption],
    recentlyCompleted: [...legacyRecentlyCompleted, ...runRecentlyCompleted, ...researchRecentlyCompleted]
  }
}

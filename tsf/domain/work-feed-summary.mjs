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
// derived classification.
const RESEARCH_PHASE_SECTION = Object.freeze({
  EXECUTING: 'active',
  // Match Keep Going's WAITING precedent until Work gains a waiting section.
  WAITING_FOR_RESOURCES: 'active',
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

// `reason` (finding #11's own fix): a real, honest, human-readable
// explanation of WHY this project counts as recently completed -- carried
// through so fleet-attention-status.mjs's completedRecentlyItems can build
// a real AttentionItem straight from this entry, instead of independently
// re-deriving (and, before this fix, getting wrong for a real adoption)
// its own separate classification. `sourceKind` (also finding #11's own
// fix, added after this fix's own regression run caught it): distinguishes
// a LEGACY_CANDIDATE_DECISION entry (the operator directly clicked
// ADOPT/REJECT -- already knows, deliberately excluded from the
// COMPLETED_RECENTLY attention category, unchanged pre-existing behavior)
// from a KEEP_GOING_RUN_ADOPTED entry (a real merge the operator may NOT
// already know about from THIS surface -- the whole point of this fix).
function recentlyCompletedEntry(project, missionId, adoptedAt, reason = null, sourceKind = null) {
  return {
    id: project.id,
    displayName: project.displayName,
    missionId,
    adoptedAt,
    reason,
    sourceKind
  }
}

export function summarizeWorkFromRuns(
  projects,
  keepGoingRuns = {},
  clock = () => new Date(),
  researchMissions = {},
  canonicalBases = {}
) {
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
            project.receipts?.chain?.at(-1)?.timestamp ?? null,
            'adopted (legacy candidate flow)',
            'LEGACY_CANDIDATE_DECISION'
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
    // Real finding (#11), disclosed earlier this mission, fixed here:
    // projectLiveWorkFeedState's own READY_FOR_ADOPTION classification is
    // derived purely from run.state === 'COMPLETE', with no awareness of
    // whether THIS exact candidate has already been really adopted (a real
    // git merge, tracked durably via project-canonical-base-store.mjs's
    // own ADVANCED history, keyed by the SAME missionId -- see findings
    // #12/#14, which made that history the trustworthy, race-safe source
    // of "did a real merge for this run actually land"). A pre-existing
    // gap (this module's own prior header comment already named it --
    // "adoption is tracked separately via mission.state === 'ADOPTED'...
    // this branch is forward-compatible rather than currently reachable")
    // that tonight's other fixes made far more likely to be hit in
    // practice, since real adoption is now reachable from many more
    // surfaces. Overridden HERE, at the one real aggregation choke point
    // both Work and the attention feed read from (see fleet-attention-
    // status.mjs's own buildFleetAttentionItems), rather than widening
    // projectLiveWorkFeedState's own contract (~10 other real call sites
    // also depend on its exact vocabulary) -- never invents a new status,
    // just checks the same real, durable evidence already proven safe.
    const advancedEntry = (canonicalBases[project.id]?.history ?? []).find(
      (h) => h.action === 'ADVANCED' && h.missionId === status.runId
    )
    const section =
      status.feed.state === 'READY_FOR_ADOPTION' && advancedEntry
        ? 'recentlyCompleted'
        : RUN_FEED_SECTION[status.feed.state]
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
            advancedEntry?.at ?? keepGoingRuns[project.id]?.updatedAt ?? null,
            advancedEntry
              ? 'a real adoption merge landed for this run -- no longer ready for adoption'
              : status.feed.reason,
            'KEEP_GOING_RUN_ADOPTED'
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
    recentlyCompleted: [
      ...legacyRecentlyCompleted,
      ...runRecentlyCompleted,
      ...researchRecentlyCompleted
    ]
  }
}

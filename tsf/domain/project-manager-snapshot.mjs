// Hands-Free Command + Project Manager V1: "one logical Project Manager
// capability" per project, per the mission spec -- composed entirely from
// existing, real, already-tested projections (buildOwnerWorkItems,
// fleetNeedsYouStatus), never a new engine, scheduler, or private state
// store. Pure, no I/O -- callers (chat-http-routes.mjs) supply already-read
// opState slices.
import { buildOwnerWorkItems, legacyProjectPrimaryState } from './owner-work-model.mjs'
import { fleetNeedsYouStatus } from './fleet-work-status.mjs'
import { compareStateToGoal } from './keep-going.mjs'

// project: the real project object (has .id, .displayName).
// keepGoingRun: this project's own run (opState.keepGoingRuns[project.id]) or undefined.
// researchMissions / plannerMissionRecords: the FULL maps (fleetNeedsYouStatus's
//   own contract) -- filtered to this project internally, never pre-filtered
//   by the caller (avoids a second, divergent filtering rule).
// projectExecutionHold: this project's own hold (opState.projectExecutionHolds[project.id]) or undefined.
// canonicalBase: this project's own canonical-base record (opState.projectCanonicalBases[project.id]) or undefined.
export function buildProjectManagerSnapshot(
  project,
  {
    keepGoingRun,
    researchMissions = {},
    plannerMissionRecords = {},
    projectExecutionHold,
    canonicalBase
  } = {},
  clock = () => new Date()
) {
  const keepGoingRunsMap = keepGoingRun ? { [project.id]: keepGoingRun } : {}
  const holdsMap = projectExecutionHold ? { [project.id]: projectExecutionHold } : {}
  const canonicalBasesMap = canonicalBase ? { [project.id]: canonicalBase } : {}

  // Deliberately researchMissions: {} here -- buildOwnerWorkItems' own
  // fleet-wide loop would append a SEPARATE researchMissionWorkItem per
  // mission, which this snapshot already surfaces distinctly below
  // (openResearchMissions). Passing the full map would double-count.
  const workItems = buildOwnerWorkItems(
    [project],
    keepGoingRunsMap,
    {},
    canonicalBasesMap,
    holdsMap,
    clock
  )

  // legacyProjectPrimaryState already exists specifically to answer "exactly
  // ONE primaryState/primaryReasonLabel for one project" (owner-work-
  // model.mjs's own documented reason: buildOwnerWorkItems' fleet-wide list
  // can legitimately return more than one item for a single run-less
  // project). A real Keep Going run's own work item already carries its own
  // primaryState -- reused directly rather than re-derived when present.
  const runWorkItem = workItems.find((item) => item.runId != null)
  const { primaryState, primaryReasonLabel } = runWorkItem
    ? { primaryState: runWorkItem.primaryState, primaryReasonLabel: runWorkItem.primaryReasonLabel }
    : legacyProjectPrimaryState(project, projectExecutionHold)

  const openResearchMissions = Object.values(researchMissions).filter(
    (mission) => mission.projectId === project.id
  )

  // fleetNeedsYouStatus already merges PROJECT/RESEARCH/PLANNER sources
  // correctly (domain/fleet-work-status.mjs) -- reused wholesale, filtered
  // to this one project afterward, never re-classified.
  const openNeedsYou = fleetNeedsYouStatus(
    [project],
    keepGoingRunsMap,
    researchMissions,
    plannerMissionRecords
  ).filter((item) => item.projectId === project.id)

  // keepGoingRunWorkItem's own returned shape (owner-work-model.mjs) does
  // NOT expose the gap it was built with -- recomputed here identically to
  // how buildOwnerWorkItems does internally (same guard: only a real,
  // ACTIVE run has a meaningful gap; never fabricated for any other state).
  const gap =
    keepGoingRun && keepGoingRun.state === 'ACTIVE'
      ? compareStateToGoal(keepGoingRun, { verifiedSatisfied: [] }, clock)
      : null

  return {
    project: { id: project.id, displayName: project.displayName },
    primaryState,
    primaryReasonLabel,
    workItems,
    keepGoingRun: keepGoingRun ?? null,
    gap,
    openResearchMissions,
    openNeedsYou,
    projectExecutionHold: projectExecutionHold ?? null
  }
}

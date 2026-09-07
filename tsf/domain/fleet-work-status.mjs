// Single source of truth for "what is really running right now" across the
// fleet. Built once here, on top of the real per-run projection
// (live-work-feed.mjs already bridges a Keep Going run into an honest
// state/reason pair) -- both Work's section-bucketing (work-feed-summary.mjs)
// and Command's status answers read this same function, so a status answer
// in prose and a Work-page card can never disagree.
import { compareStateToGoal } from './keep-going.mjs'
import { projectLiveWorkFeedState, isRunExecuting } from './live-work-feed.mjs'
import { computeResearchMissionPhase } from './research-mission.mjs'

// "Command, Work/Home/global indicator and Research status must agree"
// (hands-on pilot finding): a ResearchMission is not a project's Keep Going
// run and was previously invisible to fleet-wide status entirely -- a
// mission that was genuinely EXECUTING free research still showed "No
// Active runs" everywhere but its own status read. This is the one place
// "is any research currently active" is computed, read by both Command's
// fleet-status text and (for a real UI) the same Work/Home surface reading
// fleetWorkStatus above. A mission only counts as active here in the
// EXECUTING or WAITING_NEEDS_INPUT phases -- DRAFT/CREATED (declared scope,
// nothing has actually run yet) deliberately do not, matching
// computeResearchMissionPhase's own "started must mean something real"
// contract exactly.
const ACTIVE_RESEARCH_PHASES = new Set(['EXECUTING', 'WAITING_NEEDS_INPUT'])

export function fleetResearchStatus(researchMissions = {}) {
  return Object.values(researchMissions)
    .map((mission) => ({ missionId: mission.id, phase: computeResearchMissionPhase(mission), state: mission.state }))
    .filter((entry) => ACTIVE_RESEARCH_PHASES.has(entry.phase))
}

// "What needs me?" (Command architecture round 2, extended Phase 6): a
// real, fleet-wide aggregation of every outstanding owner decision -- a
// Keep Going run's own needsYou (real per-project coding work), a
// ResearchMission's (real per-mission research work), AND a Planner
// Context Lifecycle mission's own needsYou (real per-planner-mission
// work, raised via planner-mission-checkpoint.mjs's raisePlannerNeedsYou)
// -- read from the exact same durable arrays Work/Flight Recorder/
// Research status already read, never a second, independently-tracked
// "pending decisions" list. Bounded, honest human-readable labels only --
// never a raw run/mission id standing in for a project's real displayName
// when one is known.
//
// Phase 6 finding: plannerMissionRecords was entirely absent from this
// function until now -- opState.plannerMissions (server/planner-mission-
// store.mjs's readAllPlannerMissionRecords, the SAME opState-collection
// convention keepGoingRuns/researchMissions already use) durably holds a
// { lease, checkpoint } record per mission, and checkpoint.needsYou is a
// real, independently-raised array a planner mission accumulates exactly
// like a research mission does -- but no caller ever passed it in, so a
// planner-raised Needs You item was structurally invisible to every real
// "what needs me?" query (Command's NEEDS_YOU_QUERY and its "why?"
// follow-up), even though it was durably persisted and correctly raised.
// projectId is carried on every item so a caller can deep-link back to the
// owning project when one is really known -- never fabricated: a
// ResearchMission genuinely records its own projectId; a planner mission's
// checkpoint carries no such field (repoState is branch/sha/worktreePath,
// not a project id), so PLANNER items honestly report projectId: null
// rather than guessing one.
export function fleetNeedsYouStatus(projects, keepGoingRuns = {}, researchMissions = {}, plannerMissionRecords = {}) {
  const displayNameById = new Map(projects.map((p) => [p.id, p.displayName]))
  const items = []
  for (const [projectId, run] of Object.entries(keepGoingRuns)) {
    for (const entry of run.needsYou ?? []) {
      if (entry.resolvedAt) continue
      items.push({
        source: 'PROJECT',
        label: displayNameById.get(projectId) ?? projectId,
        id: entry.id,
        question: entry.question,
        projectId
      })
    }
  }
  for (const mission of Object.values(researchMissions)) {
    for (const entry of mission.needsYou ?? []) {
      if (entry.resolvedAt) continue
      items.push({
        source: 'RESEARCH',
        label: `Research ${mission.id}`,
        id: entry.id,
        question: entry.question,
        projectId: mission.projectId ?? null
      })
    }
  }
  for (const [missionId, record] of Object.entries(plannerMissionRecords)) {
    for (const entry of record?.checkpoint?.needsYou ?? []) {
      if (entry.resolvedAt) { continue }
      items.push({
        source: 'PLANNER',
        label: `Planner ${missionId}`,
        id: entry.id,
        question: entry.question,
        projectId: null
      })
    }
  }
  return items
}

// keepGoingRuns is the opState.keepGoingRuns map (projectId -> real run),
// never a legacy mission-state field -- a project absent here genuinely has
// no Keep Going run, not "not active" by some other measure.
export function fleetWorkStatus(projects, keepGoingRuns = {}, clock = () => new Date()) {
  return projects.map((project) => {
    const run = keepGoingRuns[project.id] ?? null
    if (!run) {
      return {
        projectId: project.id,
        displayName: project.displayName,
        hasRun: false,
        feed: null,
        runId: null,
        executing: false,
        lastCheckpointAt: null
      }
    }
    // Mirrors keep-going-controller.mjs's projectKeepGoingRun: no autonomous
    // dispatch loop independently verifies criteria for a UI-started run yet,
    // so verifiedSatisfied is honestly empty rather than fabricated -- and
    // gap is only meaningful while the run is ACTIVE.
    const gap =
      run.state === 'ACTIVE' ? compareStateToGoal(run, { verifiedSatisfied: [] }, clock) : null
    return {
      projectId: project.id,
      displayName: project.displayName,
      hasRun: true,
      feed: projectLiveWorkFeedState(run, gap),
      runId: run.id,
      // The one real fact update-safety.mjs's adoption gate actually needs
      // -- see isRunExecuting's own comment in live-work-feed.mjs.
      executing: isRunExecuting(run),
      // BUG-15/persistent-visibility (bug-ledger.json): the real, already-
      // persisted "when did this run last do anything" fact -- no
      // fabricated heartbeat (see keep-going-result-capsules.mjs/
      // domain/live-work-feed.mjs's own comments on why no true per-
      // worker heartbeat exists in this codebase).
      lastCheckpointAt: run.checkpoints.at(-1)?.at ?? null
    }
  })
}

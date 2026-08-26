// Single source of truth for "what is really running right now" across the
// fleet. Built once here, on top of the real per-run projection
// (live-work-feed.mjs already bridges a Keep Going run into an honest
// state/reason pair) -- both Work's section-bucketing (work-feed-summary.mjs)
// and Command's status answers read this same function, so a status answer
// in prose and a Work-page card can never disagree.
import { compareStateToGoal } from './keep-going.mjs'
import { projectLiveWorkFeedState, isRunExecuting } from './live-work-feed.mjs'

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
        executing: false
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
      executing: isRunExecuting(run)
    }
  })
}

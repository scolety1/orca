import { isResearchMissionWorkItem, type WorkSummary } from './types.ts'

// BUG-14 (bug-ledger.json): FleetPage never called /api/work at all, so
// none of the run-driven RUNNING/PAUSED/WAITING/STALLED/VERIFYING/
// NEEDS_YOU/READY_FOR_ADOPTION vocabulary reached Fleet Planning -- an
// operator building a schedule there had zero visibility into which
// Work Set projects already had a live run in progress. Flattens the
// same WorkSummary Work/Home already render into one projectId -> feed
// lookup, so Fleet reads the identical, already-computed server state
// rather than re-deriving anything.
export function buildLiveWorkFeedLookup(
  work: WorkSummary
): Map<string, { state: string; reason: string }> {
  const lookup = new Map<string, { state: string; reason: string }>()
  for (const bucket of [
    work.active,
    work.verifying,
    work.needsYou,
    work.stalled,
    work.readyForAdoption
  ]) {
    for (const item of bucket) {
      // A ResearchMission has no project id / liveWorkFeed of its own --
      // this lookup is project-scoped by construction.
      if (!isResearchMissionWorkItem(item) && item.liveWorkFeed) {
        lookup.set(item.id, item.liveWorkFeed)
      }
    }
  }
  return lookup
}

// Operator Attention V1, Wave 2: extended with the fleet-attention
// aggregator's own category vocabulary (NEEDS_OWNER/WAITING_FOR_RESOURCES/
// FAILED_REQUIRES_ATTENTION/COMPLETED_RECENTLY) -- never collides with a
// liveWorkFeed state string above, so both vocabularies share one map
// (READY_FOR_ADOPTION is deliberately the SAME key/color in both -- genuinely
// the same real meaning) rather than a second parallel function callers
// would have to choose between.
//
// TSF Reconcile & Upgrade Protocol V1, Lane 5: BLOCKED_EXTERNAL was
// previously omitted here on the theory it was never one of the
// categories GlobalRunStatusIndicator merges in -- global-run-status.ts's
// selectExtraAttentionItems now includes PROJECT_EXECUTION_HOLD (its own
// real gap fix), which always carries this category, so an entry is
// required here too or a real, active hold would render with the bland
// 'neutral' fallback (a silently understated, not-actually-neutral
// state) instead of correctly reading as blocked, same as STALLED/
// FAILED_REQUIRES_ATTENTION.
const BADGE_VARIANT: Record<string, 'primary' | 'neutral' | 'degraded' | 'healthy' | 'blocked'> = {
  PLANNING: 'neutral',
  WORKING: 'primary',
  WAITING: 'neutral',
  VERIFYING: 'primary',
  REVISION: 'degraded',
  STALLED: 'blocked',
  NEEDS_YOU: 'degraded',
  READY_FOR_ADOPTION: 'healthy',
  COMPLETED: 'healthy',
  NEEDS_OWNER: 'degraded',
  FAILED_REQUIRES_ATTENTION: 'blocked',
  WAITING_FOR_RESOURCES: 'degraded',
  COMPLETED_RECENTLY: 'healthy',
  BLOCKED_EXTERNAL: 'blocked'
}

// Same live-work-feed state vocabulary (now extended with the fleet-
// attention category vocabulary above), one shared badge-color mapping --
// reused wherever a live run state or attention category needs a Badge
// variant, so it never reads as a different color/urgency on one surface
// than another.
export function liveWorkFeedBadgeVariant(
  state: string
): 'primary' | 'neutral' | 'degraded' | 'healthy' | 'blocked' {
  return BADGE_VARIANT[state] ?? 'neutral'
}

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

const BADGE_VARIANT: Record<string, 'primary' | 'neutral' | 'degraded' | 'healthy' | 'blocked'> = {
  PLANNING: 'neutral',
  WORKING: 'primary',
  WAITING: 'neutral',
  VERIFYING: 'primary',
  REVISION: 'degraded',
  STALLED: 'blocked',
  NEEDS_YOU: 'degraded',
  READY_FOR_ADOPTION: 'healthy',
  COMPLETED: 'healthy'
}

// Same live-work-feed state vocabulary, one shared badge-color mapping --
// reused wherever a live run state needs a Badge variant, so a state never
// reads as a different color/urgency on one surface than another.
export function liveWorkFeedBadgeVariant(
  state: string
): 'primary' | 'neutral' | 'degraded' | 'healthy' | 'blocked' {
  return BADGE_VARIANT[state] ?? 'neutral'
}

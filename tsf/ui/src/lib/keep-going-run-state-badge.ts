import type { KeepGoingRunState } from './keep-going-types'

type BadgeVariant = 'primary' | 'neutral' | 'degraded' | 'healthy' | 'blocked'

// BUG-09 (bug-ledger.json): the one real KeepGoingRunState -> Badge-color
// mapping, previously defined only inline in KeepGoingPanel.tsx --
// FlightRecorderPanel.tsx showed the same real state (timeline.state) with
// no color/legibility mapping at all. Reused here rather than duplicated,
// so a run's state can never read as a different urgency on one surface
// than another (same "one source of truth for a badge variant" discipline
// as work-feed-lookup.ts's liveWorkFeedBadgeVariant).
export const KEEP_GOING_RUN_STATE_BADGE: Record<KeepGoingRunState, BadgeVariant> = {
  ACTIVE: 'primary',
  NEEDS_YOU: 'degraded',
  PAUSED: 'neutral',
  STALLED: 'degraded',
  COMPLETE: 'healthy',
  BLOCKED: 'blocked'
}

const BADGE_VARIANT_BY_STRING: Record<string, BadgeVariant> = KEEP_GOING_RUN_STATE_BADGE

export function keepGoingRunStateBadgeVariant(state: string): BadgeVariant {
  return BADGE_VARIANT_BY_STRING[state] ?? 'neutral'
}

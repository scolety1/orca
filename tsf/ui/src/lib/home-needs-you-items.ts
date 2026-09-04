import type { WorkItem, WorkSummary } from './types'

export type HomeNeedsYouItem = WorkItem & { keyPrefix: string }

// BUG-14 (bug-ledger.json) real, independently-verified regression:
// work.blocked (a legacy, run-independent classification) can legitimately
// contain the SAME project id as work.needsYou/work.stalled -- a project
// with a BLOCKED legacy mission.state can also have a live NEEDS_YOU/
// STALLED Keep Going run at the same time (domain/work-feed-summary.mjs
// computes `blocked` unconditionally, independent of run state). A bare
// `key={p.id}` across the combined list collides in that case. WorkPage.tsx
// already guards this exact overlap with prefixed keys; this is the same
// fix, factored out so it's actually testable (HomePage.tsx has no test
// harness of its own).
export function buildHomeNeedsYouItems(work: WorkSummary): HomeNeedsYouItem[] {
  return [
    ...work.needsYou.map((p) => ({ ...p, keyPrefix: 'needs-you' })),
    ...work.stalled.map((p) => ({ ...p, keyPrefix: 'stalled' })),
    ...work.blocked.map((p) => ({ ...p, keyPrefix: 'blocked' })),
    ...work.readyForAdoption.map((p) => ({ ...p, keyPrefix: 'ready-for-adoption' }))
  ]
}

export function homeNeedsYouItemKey(item: HomeNeedsYouItem): string {
  return `${item.keyPrefix}-${item.id}`
}

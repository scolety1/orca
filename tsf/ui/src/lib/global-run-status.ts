import type { WorkSummary } from './types'

// Persistent global execution visibility (bug-ledger.json, BUG-14's own
// disclosed remaining gap): "a user must be able to see, from anywhere in
// TSF, what is RUNNING/PAUSED/WAITING/STALLED/VERIFYING/NEEDS_YOU/
// READY_FOR_ADOPTION" -- "active entries must be mission/run-specific, not
// vague project-level summaries." Flattens the same WorkSummary Work/Home/
// Fleet already render, filtered to items that actually carry a real
// liveWorkFeed (run-driven) -- a project appearing only in the legacy
// work.blocked/work.active buckets with no run has no exact run to report
// on, so it's honestly excluded here, never collapsed into a vague
// "something's happening" entry.
export type GlobalRunStatusItem = {
  id: string
  displayName: string
  runId: string | null
  state: string
  reason: string
  lastCheckpointAt: string | null
}

export function buildGlobalRunStatusItems(work: WorkSummary): GlobalRunStatusItem[] {
  const items: GlobalRunStatusItem[] = []
  for (const bucket of [
    work.active,
    work.verifying,
    work.needsYou,
    work.stalled,
    work.readyForAdoption
  ]) {
    for (const p of bucket) {
      if (p.liveWorkFeed) {
        items.push({
          id: p.id,
          displayName: p.displayName,
          runId: p.runId ?? null,
          state: p.liveWorkFeed.state,
          reason: p.liveWorkFeed.reason,
          lastCheckpointAt: p.lastCheckpointAt ?? null
        })
      }
    }
  }
  return items
}

// Most-urgent-first: an operator opening this from anywhere should see
// what needs them before what's merely progressing normally.
const URGENCY_RANK: Record<string, number> = {
  NEEDS_YOU: 0,
  STALLED: 1,
  READY_FOR_ADOPTION: 2,
  REVISION: 3,
  VERIFYING: 4,
  WORKING: 5,
  WAITING: 6,
  PLANNING: 7,
  COMPLETED: 8
}

export function sortByUrgency(items: GlobalRunStatusItem[]): GlobalRunStatusItem[] {
  return [...items].sort((a, b) => (URGENCY_RANK[a.state] ?? 99) - (URGENCY_RANK[b.state] ?? 99))
}

// The single most urgent state present, for the always-visible trigger's
// own summary dot/count -- null when nothing is run-driven right now.
export function mostUrgentState(items: GlobalRunStatusItem[]): string | null {
  if (items.length === 0) {
    return null
  }
  return sortByUrgency(items)[0].state
}

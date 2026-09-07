import { isResearchMissionWorkItem, type AttentionItem, type WorkSummary } from './types.ts'
import { projectDeepLinkTo } from './project-work-deep-link.ts'

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
  // Operator Attention V1, Wave 2: present (possibly null) ONLY for an item
  // merged in from GET /api/attention (see attentionItemToGlobalRunStatusItem
  // below) -- a real link when one exists (PROJECT), null when it honestly
  // doesn't (no fabricated link to nowhere). Absent (undefined) for every
  // ordinary run-driven item above, which still computes its own link the
  // original way (projectDeepLinkTo(item.id, ...)) in the component.
  linkTo?: string | null
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
      // A ResearchMission has no Keep Going liveWorkFeed of its own -- this
      // indicator is Keep Going-run-specific by construction (see its own
      // header); a research mission's activity is visible on HQ instead.
      if (!isResearchMissionWorkItem(p) && p.liveWorkFeed) {
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
// what needs them before what's merely progressing normally. Extended
// (Operator Attention V1, Wave 2) with the fleet-attention category
// vocabulary for items this file structurally cannot produce on its own --
// NEEDS_OWNER/FAILED_REQUIRES_ATTENTION tie with their closest run-driven
// equivalents (NEEDS_YOU/STALLED); READY_FOR_ADOPTION is already the same
// key. COMPLETED_RECENTLY intentionally excluded from selectExtraAttentionItems
// below, so no rank is needed for it here.
const URGENCY_RANK: Record<string, number> = {
  NEEDS_YOU: 0,
  NEEDS_OWNER: 0,
  STALLED: 1,
  FAILED_REQUIRES_ATTENTION: 1,
  WAITING_FOR_RESOURCES: 1,
  READY_FOR_ADOPTION: 2,
  REVISION: 3,
  VERIFYING: 4,
  WORKING: 5,
  WAITING: 6,
  PLANNING: 7,
  COMPLETED: 8
}

// Real route exists only for a PROJECT deep link (projectDeepLinkTo) --
// checked against App.tsx's actual route table: RESEARCH_MISSION/
// PLANNER_MISSION/SELF_IMPROVEMENT_FINDING/RESOURCE_PRESSURE have no
// standalone page yet. Honestly null rather than a link to nowhere -- the
// component renders a plain, non-clickable card for a null result.
export function resolveAttentionDeepLink(item: AttentionItem): string | null {
  if (item.deepLink.kind === 'PROJECT' && item.deepLink.id) {
    return projectDeepLinkTo(item.deepLink.id)
  }
  return null
}

// Items buildGlobalRunStatusItems (above) structurally cannot produce --
// no run/liveWorkFeed exists for a self-improvement finding at all (any
// category it can reach: NEEDS_OWNER, FAILED_REQUIRES_ATTENTION, or
// READY_FOR_ADOPTION), and the host-wide resource-pressure item has no
// project/run of its own either. Every OTHER attention category
// (project-level NEEDS_OWNER/STALLED/READY_FOR_ADOPTION/COMPLETED_RECENTLY)
// already reaches this indicator via its own real liveWorkFeed, so
// including it here too would double-count the same real fact.
export function selectExtraAttentionItems(items: AttentionItem[]): AttentionItem[] {
  return items.filter((i) => i.source.kind === 'SELF_IMPROVEMENT_FINDING' || i.category === 'WAITING_FOR_RESOURCES')
}

export function attentionItemToGlobalRunStatusItem(item: AttentionItem): GlobalRunStatusItem {
  return {
    id: item.id,
    displayName: item.project?.displayName ?? item.label,
    runId: null,
    state: item.category,
    reason: item.reason,
    lastCheckpointAt: item.changedAt,
    linkTo: resolveAttentionDeepLink(item)
  }
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

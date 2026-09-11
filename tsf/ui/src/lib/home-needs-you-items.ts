import { isResearchMissionWorkItem, type AttentionCategory, type AttentionItem, type ProjectDetail, type WorkItem, type WorkSummary } from './types.ts'

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
// ResearchMissions in needsYou/blocked are rendered separately (their own
// ResearchMissionCard, not a project card -- see HQPage.tsx) -- filtered
// out here rather than typed into HomeNeedsYouItem, which is project-only.
export function buildHomeNeedsYouItems(work: WorkSummary): HomeNeedsYouItem[] {
  return [
    ...work.needsYou.filter((p): p is WorkItem => !isResearchMissionWorkItem(p)).map((p) => ({ ...p, keyPrefix: 'needs-you' })),
    ...work.stalled.map((p) => ({ ...p, keyPrefix: 'stalled' })),
    ...work.blocked.filter((p): p is ProjectDetail => !isResearchMissionWorkItem(p)).map((p) => ({ ...p, keyPrefix: 'blocked' })),
    ...work.readyForAdoption.map((p) => ({ ...p, keyPrefix: 'ready-for-adoption' }))
  ]
}

export function homeNeedsYouItemKey(item: HomeNeedsYouItem): string {
  return `${item.keyPrefix}-${item.id}`
}

// Real-project adversarial-hardening finding (tsf-operator-hardening-v2):
// the same project can legitimately appear more than once in
// buildHomeNeedsYouItems' combined list (see its own header) -- a bare
// `.length` on that list counts ATTENTION REASONS, not distinct PROJECTS,
// so the Home page's "Needs you: N" number tile could read e.g. 2 for a
// SINGLE project that's both legacy-blocked and run-STALLED, misleading
// an operator into expecting two separate problems. The detail list below
// the tile still shows every real reason-card individually (unchanged,
// correct); only the summary count is deduplicated to what it visually
// claims to represent -- how many projects need you, not how many reasons
// exist across them.
export function countDistinctNeedsYouProjects(items: HomeNeedsYouItem[]): number {
  return new Set(items.map((item) => item.id)).size
}

// Operator Attention V1, Wave 2 + Operator Polish V1, Wave A: a NEEDS_OWNER
// item with no project-run correlation of its own -- a self-improvement
// finding the eligibility classifier declined to autofix, or a planner
// mission's own needsYou checkpoint (no project exists on a planner
// checkpoint at all -- fleet-attention-status.mjs). Neither is a WorkItem,
// so this is its own small shape rather than forced into HomeNeedsYouItem.
// `id` is the item's own real, content-derived attention id (never
// label-derived) so two items can never spuriously dedup/collide.
export type OtherNeedsYouItem = {
  id: string
  label: string
  reason: string
  projectId: string | null
  kind: 'SELF_IMPROVEMENT_FINDING' | 'PLANNER_MISSION_NEEDS_YOU'
  // Manual Self-Improvement Finding Disposition V1: which real action(s)
  // the card should offer -- READY_FOR_ADOPTION means a real verified
  // candidate exists (Apply verified fix); NEEDS_OWNER/
  // FAILED_REQUIRES_ATTENTION mean no candidate exists yet (Start Fix).
  // Always 'NEEDS_OWNER' for a planner item (the only category it can
  // ever carry).
  category: AttentionCategory
  // Pre-UI Productization V1, Priority 5: the real missionId (deepLink.id)
  // and raw needsYouId (source.id) a real resolve action needs -- only
  // ever non-null for kind === 'PLANNER_MISSION_NEEDS_YOU' (the real
  // deepLink.kind for that source), never fabricated for any other kind.
  plannerMissionId: string | null
  plannerNeedsYouId: string | null
  // Manual Self-Improvement Finding Disposition V1: the real, raw
  // findingId a disposition action needs -- only ever non-null for
  // kind === 'SELF_IMPROVEMENT_FINDING' (source.id already carries the
  // raw, unprefixed findingId, unlike this item's own doubly-prefixed id).
  findingId: string | null
}

// Self-improvement findings surface under THREE real categories (see
// domain/fleet-attention-status.mjs's selfImprovementItems) -- all three
// are now real, actionable Needs-You cards (Manual Self-Improvement
// Finding Disposition V1), not just the NEEDS_OWNER one. A planner
// Needs-You item is always NEEDS_OWNER by construction, so its own filter
// is unaffected.
export function buildOtherNeedsYouItems(attentionItems: AttentionItem[]): OtherNeedsYouItem[] {
  return attentionItems
    .filter(
      (i) =>
        i.source.kind === 'PLANNER_MISSION_NEEDS_YOU' ||
        (i.source.kind === 'SELF_IMPROVEMENT_FINDING' &&
          (i.category === 'NEEDS_OWNER' || i.category === 'READY_FOR_ADOPTION' || i.category === 'FAILED_REQUIRES_ATTENTION'))
    )
    .map((i) => ({
      id: i.id,
      label: i.label,
      reason: i.reason,
      projectId: i.project?.id ?? null,
      kind: i.source.kind as OtherNeedsYouItem['kind'],
      category: i.category,
      plannerMissionId: i.source.kind === 'PLANNER_MISSION_NEEDS_YOU' ? (i.deepLink.id ?? null) : null,
      plannerNeedsYouId: i.source.kind === 'PLANNER_MISSION_NEEDS_YOU' ? i.source.id : null,
      findingId: i.source.kind === 'SELF_IMPROVEMENT_FINDING' ? i.source.id : null
    }))
}

import { isResearchMissionWorkItem, type AttentionItem, type ProjectDetail, type WorkItem, type WorkSummary } from './types.ts'

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

// Operator Attention V1, Wave 2: a self-improvement finding the eligibility
// classifier declined to autofix (real gap -- previously invisible on Home
// entirely, only reachable via chat). Not a WorkItem (no project may exist
// -- `project` is honestly null when a finding has none), so this is its
// own small shape rather than forced into HomeNeedsYouItem.
export type SelfImprovementNeedsYouItem = {
  findingId: string
  label: string
  reason: string
  projectId: string | null
}

export function buildSelfImprovementNeedsYouItems(attentionItems: AttentionItem[]): SelfImprovementNeedsYouItem[] {
  return attentionItems
    .filter((i) => i.category === 'NEEDS_OWNER' && i.source.kind === 'SELF_IMPROVEMENT_FINDING')
    .map((i) => ({ findingId: i.source.id ?? i.id, label: i.label, reason: i.reason, projectId: i.project?.id ?? null }))
}

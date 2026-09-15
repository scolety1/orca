import type { AttentionItem, ProjectCard, ResearchMissionWorkItem } from './types'

// HQ Snapshot Migration (finish item A) -- mirrors tsf/domain/owner-work-
// model.mjs's real output field-for-field (see that file for the
// authoritative shape). The owner's own reconciled vocabulary: never
// independently reclassified here or by any consumer -- `state` is
// consumed as-is. Split into its own file (not appended to types.ts) to
// keep that file under the repo's max-lines cap, mirroring fleet-status-
// types.ts/capacity-types.ts/prepare-for-work-types.ts's own precedent.
export type OwnerWorkState =
  | 'PLANNING'
  | 'WORKING'
  | 'WAITING'
  | 'VERIFYING'
  | 'NEEDS_YOU'
  | 'READY'
  | 'DONE'
  | 'FAILED'
  | 'PAUSED'

// TSF UI FINDINGS #2-#16 RECONCILE & UPGRADE, Finding #5/#6/#7: the
// settled primary owner-facing state model -- mirrors
// tsf/domain/owner-primary-state.mjs's own OWNER_PRIMARY_STATES exactly.
// Every surface showing ONE top-level status word for a work item must use
// `primaryState`/`primaryReasonLabel`, never re-derive its own reading of
// `state` (the richer, still-real internal vocabulary, unchanged and still
// consumed by HQ's own more granular sections).
export type OwnerPrimaryState = 'WORKING' | 'WAITING' | 'NEEDS_YOU' | 'DONE'

export type OwnerWorkItem = {
  id: string
  projectId: string | null
  goalId: string | null
  kind: 'KEEP_GOING_RUN' | 'RESEARCH_MISSION' | 'PROJECT'
  parentId: string | null
  state: OwnerWorkState
  reason: string
  primaryState: OwnerPrimaryState
  primaryReasonLabel: string | null
  progress: Record<string, number> | null
  startedAt: string | null
  updatedAt: string | null
  availableActions: string[]
  // KEEP_GOING_RUN only.
  runId?: string
  // RESEARCH_MISSION only -- the same real fields ResearchMissionCard.tsx
  // already reads off ResearchMissionWorkItem/ResearchMissionSummary.
  missionId?: string
  phase?: ResearchMissionWorkItem['phase']
  researchQuestion?: string | null
  entityType?: string | null
  expectedCount?: number | null
  freePathOnly?: boolean
  // TSF Final Pre-UI P1 Closure V1, P1 #1: the real, unresolved question(s)
  // -- same real filter server/research-mission-driver.mjs's own
  // readResearchMissionReviewItems already applies. Lets ResearchNeedsYouCard
  // render/answer the real question directly off this item.
  openNeedsYou?: { id: string; question: string }[]
}

// TSF Final Pre-UI P1 Closure V1, P1 #2 -- mirrors tsf/domain/owner-goal-
// model.mjs's real output field-for-field. `sourceId` is the real, durable
// Keep Going run id / ResearchMission id this goal was derived from
// (never itself the goal's identity -- see that file's own header for
// why). A real Goal type now exists for a future UI to consume; the
// visual presentation of Goals is deliberately NOT built here (subjective
// UI/IA decision, out of this bounded backend-completion task's scope).
export type OwnerGoal = {
  id: string
  projectId: string | null
  kind: 'KEEP_GOING_RUN' | 'RESEARCH_MISSION'
  title: string | null
  description: string | null
  criteria: string[] | null
  sourceId: string
  updatedAt: string
}

// GET /api/operator-snapshot -- mirrors tsf/server/operator-snapshot.mjs's
// real buildOperatorSnapshot output field-for-field. `needsYou`/`capacity`
// are typed loosely (the capacity/needs-you panels have their own
// dedicated fetches today, unrelated to this migration) -- widen these
// only when a real consumer needs a precise shape, never speculatively.
export type OperatorSnapshot = {
  revision: number
  generatedAt: string
  projects: ProjectCard[]
  goals: OwnerGoal[]
  work: OwnerWorkItem[]
  waiting: AttentionItem[]
  needsYou: unknown[]
  recentlyDone: OwnerWorkItem[]
  capacity: unknown
  attention: AttentionItem[]
}

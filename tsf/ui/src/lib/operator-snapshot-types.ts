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

export type OwnerWorkItem = {
  id: string
  projectId: string | null
  goalId: string | null
  kind: 'KEEP_GOING_RUN' | 'RESEARCH_MISSION' | 'PROJECT'
  parentId: string | null
  state: OwnerWorkState
  reason: string
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
}

// GET /api/operator-snapshot -- mirrors tsf/server/operator-snapshot.mjs's
// real buildOperatorSnapshot output field-for-field. `goals`/`needsYou`/
// `capacity` are typed loosely (Stage 6 and the capacity/needs-you panels
// have their own dedicated fetches today, unrelated to this migration) --
// widen these only when a real consumer needs a precise shape, never
// speculatively.
export type OperatorSnapshot = {
  revision: number
  generatedAt: string
  projects: ProjectCard[]
  goals: unknown[]
  work: OwnerWorkItem[]
  waiting: AttentionItem[]
  needsYou: unknown[]
  recentlyDone: OwnerWorkItem[]
  capacity: unknown
  attention: AttentionItem[]
}

// Mirrors server/prepare-for-work-http-routes.mjs's real per-project
// result shape -- POST /api/projects/prepare-for-work.
export type PrepareForWorkStage = {
  stage: 'REFRESH' | 'BASELINE' | 'AUTO_REPAIR'
  ok: boolean
  detail?: string
  baseline?: unknown
  actionsTaken?: { cause: string; ok: boolean; action: string }[]
}

export type PrepareForWorkResult = {
  projectId: string
  ok: boolean
  error?: string
  stages: PrepareForWorkStage[]
  causesAfter?: { cause: string; repairClass: string; summary: string }[]
  repairClass?: string
  readyForWork?: boolean
}

export type PrepareForWorkResponse = {
  ok: true
  results: PrepareForWorkResult[]
}

// Mirrors server/portfolio-membership-http-routes.mjs's real response
// shape -- POST /api/portfolio/active-fleet, /api/portfolio/work-set.
export type MembershipChangeResponse = {
  ok: true
  field: 'activeFleet' | 'workSet'
  applied: string[]
  skipped: { projectId: string; reason: string }[]
  activeFleet?: string[]
  workSet?: string[]
}

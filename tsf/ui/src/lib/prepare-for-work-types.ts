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

// Mirrors domain/prepare-for-work-operation.mjs's durable record -- V1
// live-use defect fix: Prepare for Work now runs as a durable, pollable
// operation instead of one long-lived fetch, so a browser reload or a TSF
// desktop restart no longer loses in-flight progress.
export type PrepareForWorkPhase =
  | 'RECONCILING'
  | 'REGISTERING_ORCA'
  | 'DISCOVERING_BASELINE'
  | 'RUNNING_BASELINE'
  | 'DIAGNOSING_HEALTH'
  | 'REPAIRING_SAFE_CAUSES'
  | 'VERIFYING'
  | 'READY_FOR_WORK'
  | 'NEEDS_YOU'
  | 'BLOCKED'
  | 'FAILED'

export type PrepareForWorkProjectProgress =
  | { phase: PrepareForWorkPhase; settled: false }
  | (PrepareForWorkResult & { phase: PrepareForWorkPhase; settled: true })

export type PrepareForWorkOperation = {
  schemaVersion: 'TSF_PREPARE_FOR_WORK_OPERATION_V1'
  operationId: string
  projectIds: string[]
  status: 'RUNNING' | 'COMPLETED' | 'INTERRUPTED'
  createdAt: string
  updatedAt: string
  results: Record<string, PrepareForWorkProjectProgress>
}

export type PrepareForWorkOperationResponse = { ok: true; operation: PrepareForWorkOperation }
export type PrepareForWorkOperationListResponse = {
  ok: true
  operations: PrepareForWorkOperation[]
}
export type PrepareForWorkStartResponse = {
  ok: true
  operationId: string
  operation: PrepareForWorkOperation
  reused?: boolean
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

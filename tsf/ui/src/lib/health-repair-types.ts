// Mirrors tsf/domain/health-repair.mjs (Health Cause Model) and
// tsf/server/health-repair-http-routes.mjs's real response shapes. Kept in
// its own file rather than lib/types.ts to avoid growing that file past
// the repo's max-lines lint limit.
export type HealthCause =
  | 'INCOMPLETE_ANALYSIS'
  | 'HANDOFF_RECONCILIATION_REQUIRED'
  | 'REPOSITORY_IDENTITY_AMBIGUOUS'
  | 'ORCA_NOT_REGISTERED'
  | 'ORCA_TEMPORARILY_UNAVAILABLE'
  | 'PLANNER_UNAVAILABLE'
  | 'BASELINE_UNKNOWN'
  | 'BASELINE_FAILING'
  | 'BUILD_FAILING'
  | 'TESTS_FAILING'
  | 'TYPECHECK_FAILING'
  | 'LINT_FAILING'
  | 'DEPENDENCY_HEALTH'
  | 'SECURITY_FINDINGS'
  | 'DIRTY_PRESERVE'
  | 'UNADOPTED_CANDIDATE'
  | 'STALE_PROJECT_STATE'
  | 'BLOCKED_PRODUCT_DECISION'
  | 'BLOCKED_ARCHITECTURAL_CONFLICT'
  | 'SENSITIVE_RESTRICTION'
  | 'PAUSED_BY_DESIGN'
  | 'UNKNOWN'

export type RepairClass =
  | 'AUTO_REPAIR_SAFE'
  | 'GOVERNED_REPAIR_MISSION'
  | 'TIM_REQUIRED'
  | 'NOT_A_DEFECT'

export type HealthCauseDiagnosis = {
  cause: HealthCause
  repairClass: RepairClass
  summary: string
  evidence: Record<string, unknown>
}

export type ProjectHealthDiagnosis = {
  projectId: string
  displayName: string
  repoPath: string
  causes: HealthCauseDiagnosis[]
  repairClass: RepairClass
  readyForWork: boolean
}

export type FleetHealthScanResult = { ok: true; projects: ProjectHealthDiagnosis[] }

export type BaselineCommandStatus = 'PASS' | 'FAIL' | 'UNKNOWN' | 'NOT_APPLICABLE'

export type BaselineVerification = {
  typecheck: BaselineCommandStatus
  test: BaselineCommandStatus
  build: BaselineCommandStatus
  lint: BaselineCommandStatus
}

export type BaselineCheckResult = {
  ok: true
  baseline: BaselineVerification
  causes: HealthCauseDiagnosis[]
  repairClass: RepairClass
  readyForWork: boolean
  priorCauses: HealthCauseDiagnosis[]
}

export type RepairActionResult = {
  ok: boolean
  repairResult: { ok: boolean; action: string; reason?: string; detail?: string }
  causesBefore: HealthCauseDiagnosis[]
  causesAfter: HealthCauseDiagnosis[]
  readyForWork: boolean
}

export type RepairMissionSpec = {
  projectDisplayName: string
  repoPath: string
  originalGoal: string
  acceptanceCriteria: string[]
  usageMode: string
  constraints: string[]
  stopConditions: string[]
}

export type PrepareMissionResult = { ok: true; spec: RepairMissionSpec }

export type RepairSelectedResult = {
  ok: true
  results: {
    projectId: string
    ok: boolean
    error?: string
    actionsTaken?: { cause: HealthCause; ok: boolean; action: string }[]
    readyForWork?: boolean
    remainingCauses?: HealthCauseDiagnosis[]
  }[]
}

export type HealthRepairApiError = { ok: false; error: string }

// Mirrors domain/health-repair.mjs's overallRepairClass -- kept in sync by
// hand (a plain string-ranked reduce, unlikely to drift, and duplicating
// the whole domain module client-side isn't worth it for one function).
const REPAIR_CLASS_RANK: Record<RepairClass, number> = {
  NOT_A_DEFECT: 0,
  AUTO_REPAIR_SAFE: 1,
  GOVERNED_REPAIR_MISSION: 2,
  TIM_REQUIRED: 3
}

export function overallRepairClass(causes: HealthCauseDiagnosis[]): RepairClass {
  return causes.reduce<RepairClass>(
    (worst, c) =>
      REPAIR_CLASS_RANK[c.repairClass] > REPAIR_CLASS_RANK[worst] ? c.repairClass : worst,
    'NOT_A_DEFECT'
  )
}

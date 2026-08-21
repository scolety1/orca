// Mirrors tsf/domain/evaluation-pack.mjs's real TSF_EVAL_PACK_V1/
// TSF_EVAL_RUN_RESULT_V1/TSF_EVAL_COMPARISON_V1 shapes as served by
// tsf/server/eval-http-routes.mjs. Kept in its own file rather than
// lib/types.ts to avoid growing that file past the repo's max-lines
// lint limit.
export type EvalCategory =
  | 'PLANNER'
  | 'WORKER'
  | 'VERIFIER'
  | 'ROUTING'
  | 'MEMORY'
  | 'AUTONOMY'
  | 'ESTIMATOR'

export type EvalPackSummary = {
  packId: string
  version: number
  category: EvalCategory
  description: string
  caseCount: number
}

export type EvalCaseResult = {
  caseId: string
  passed: boolean
  errored?: boolean
  assertionResults: { type: string; path: string; passed: boolean }[]
}

export type EvalRunResult = {
  schemaVersion: string
  packId: string
  packVersion: number
  category: EvalCategory
  runAt: string
  totalCases: number
  passedCases: number
  failedCases: number
  passRate: number
  results: EvalCaseResult[]
}

export type EvalComparison = {
  schemaVersion: string
  packId: string
  baselineRunAt: string
  candidateRunAt: string
  regressions: string[]
  improvements: string[]
  regressionCount: number
  improvementCount: number
  recommendation: 'PROMOTE' | 'DO_NOT_PROMOTE'
}

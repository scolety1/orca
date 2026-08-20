// Mirrors tsf/server/keep-going-controller.mjs's projectKeepGoingRun() view
// model, which reads every field directly off the real tsf/domain/
// keep-going.mjs run -- nothing here is fabricated in the server layer.
// Kept in its own file rather than lib/types.ts to avoid growing that file
// past the repo's max-lines lint limit.
export type KeepGoingRunState =
  | 'ACTIVE'
  | 'NEEDS_YOU'
  | 'PAUSED'
  | 'STALLED'
  | 'COMPLETE'
  | 'BLOCKED'

export type KeepGoingCheckpoint = {
  phase: string
  note: string | null
  evidence: unknown[]
  waveCount: number
  state: KeepGoingRunState
  at: string
  previousHash: string | null
  hash: string
}

export type KeepGoingNeedsYouEntry = {
  id: string
  question: string
  options: string[]
  raisedAt: string
}

export type KeepGoingGapAnalysis = {
  satisfiedCriteria: string[]
  remainingGaps: string[]
  decision: 'CONTINUE' | 'STOP_COMPLETE' | 'STOP_BLOCKED' | 'STOP_BUDGET_EXHAUSTED'
}

export type KeepGoingRunView =
  | { started: false }
  | {
      started: true
      runId: string
      revision: number
      state: KeepGoingRunState
      phase: string
      goal: string
      acceptanceCriteria: string[]
      usageMode: string
      budget: Record<string, number>
      constraints: string[]
      stopConditions: string[]
      wavesCompleted: number
      retryCounts: Record<string, number>
      gap: KeepGoingGapAnalysis
      workers: unknown[]
      verifierResults: unknown[]
      openNeedsYou: KeepGoingNeedsYouEntry[]
      lastCheckpoint: KeepGoingCheckpoint | null
      readyForAdoption: boolean
      createdAt: string
      updatedAt: string
    }

export type KeepGoingActiveRunView = Extract<KeepGoingRunView, { started: true }>

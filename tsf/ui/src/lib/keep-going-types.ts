// Mirrors tsf/server/keep-going-controller.mjs's projectKeepGoingRun() view
// model, which reads every field directly off the real tsf/domain/
// keep-going.mjs run -- nothing here is fabricated in the server layer.
// Kept in its own file rather than lib/types.ts to avoid growing that file
// past the repo's max-lines lint limit.
import type { UsageMode } from './usage-modes'
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

// BUG-15 (bug-ledger.json): real detail for a genuinely in-flight (incl.
// now-stalled) wave -- see keep-going-controller.mjs's own comment on
// exactly what is/isn't real here. workerIdentityAvailable is always
// false today (no agent/provider/model is ever persisted onto a dispatch
// record anywhere in this codebase) -- sent explicitly rather than simply
// omitting the field, so the UI has one clear place to read "not
// available" from instead of silently omitting the section.
export type KeepGoingInFlightWaveDetail = {
  dispatchedAt: string
  items: { workItemId: string; scope: string[]; taskId: string | null }[]
  workerIdentityAvailable: false
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
      usageMode: UsageMode
      budget: Record<string, number>
      constraints: string[]
      stopConditions: string[]
      wavesCompleted: number
      retryCounts: Record<string, number>
      gap: KeepGoingGapAnalysis
      workers: unknown[]
      inFlightWaveDetail: KeepGoingInFlightWaveDetail | null
      verifierResults: unknown[]
      openNeedsYou: KeepGoingNeedsYouEntry[]
      lastCheckpoint: KeepGoingCheckpoint | null
      readyForAdoption: boolean
      orchestrationRunId: string | null
      dispatchTickActive: boolean
      // BUG-14: mirrors domain/live-work-feed.mjs's own inFlightWave-still-
      // set-but-last-checkpointed-WAVE_STALLED override -- see keep-going-
      // controller.mjs's own comment on this field for why it's exposed as
      // a boolean rather than sending the raw inFlightWave/checkpoints.
      inFlightWaveStalled: boolean
      createdAt: string
      updatedAt: string
    }

export type KeepGoingActiveRunView = Extract<KeepGoingRunView, { started: true }>

// Mirrors keep-going-dispatch-loop.mjs's tickKeepGoingRun result shape --
// deliberately loose (unknown fields pass through) since the action union
// there is intentionally open-ended (NOOP/WAVE_DISPATCHED/WAVE_SETTLED/
// DISPATCH_FAILED/..._LOST_LOCK/etc.) and the UI only needs action/reason
// to render a result, not to branch on every possible value.
export type KeepGoingTickResult = {
  action: string
  reason?: string
  detail?: string
}

// One caller-supplied candidate work item for the manual "Run now" tick --
// deciding what candidates exist is a planning judgment tickKeepGoingRun
// itself refuses to make, so the operator supplies it here.
export type KeepGoingCandidateWorkItem = {
  id: string
  scope: string[]
  spec?: string
  worktree?: string
  agent?: string
  workerTerminal?: string
}

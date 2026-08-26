// Governed-adoption-review Stage F: the smallest correct mechanism for
// reconciling a settled Keep Going run -- one whose last dispatched wave
// finished but that nothing is currently executing (isRunExecuting is
// false), and where real, disk-based worktree evidence may exist that the
// run's own persisted state never captured (live evidence: WorldForge and
// Landing Page both had real commits after their last recorded checkpoint;
// NWR had real completed implementation waves but no independent
// verification of its acceptance criteria was ever dispatched).
//
// Every decision here is pure and driven entirely by real, externally-
// gathered evidence passed in -- this module never calls git, never
// dispatches Orca work, never reads a file. tsf/server/settled-run-
// reconciler.mjs is the I/O layer that gathers that evidence and acts on
// the decision using the REAL existing keep-going.mjs mutators
// (checkpointRun/completeRun/raiseNeedsYou/recordTaskAttempt) and the REAL
// existing dispatch pipeline (tickKeepGoingRun) -- no new schema, no new
// scheduler, no fabricated verifiedSatisfied.
import { isRunExecuting } from './live-work-feed.mjs'

// The one, real, dedicated work-item id this module ever dispatches under
// -- so its own retry/attempt history is trackable via the run's existing
// retryCounts (recordTaskAttempt), the same convention abandonStalledWave
// already uses for stalled implementation work.
export const RECONCILIATION_VERIFICATION_TASK_ID = 'tsf-reconciliation-verification'
export const LATE_COMMITS_CHECKPOINT_PHASE = 'RECONCILIATION_LATE_COMMITS_CAPTURED'

// A run is only ever a reconciliation candidate when it is genuinely
// settled: ACTIVE, has dispatched at least one real wave, nothing is
// currently executing it, and there's no already-open question a human
// needs to answer first (that's NEEDS_YOU's job, not this one's).
export function needsReconciliation(run) {
  return (
    run.state === 'ACTIVE' &&
    run.waves.length > 0 &&
    !isRunExecuting(run) &&
    run.needsYou.every((entry) => entry.resolvedAt)
  )
}

// Every commit SHA this run has already recorded as reconciled late-commit
// evidence, across every past reconciliation checkpoint -- so re-running
// reconciliation against an unchanged worktree never appends a duplicate
// checkpoint. Idempotency by real, comparable fact (a SHA either is or
// isn't already recorded), not by a manufactured "already ran" flag.
function alreadyCapturedShas(run) {
  const shas = new Set()
  for (const checkpoint of run.checkpoints) {
    if (checkpoint.phase === LATE_COMMITS_CHECKPOINT_PHASE) {
      for (const sha of checkpoint.evidence) {
        shas.add(sha)
      }
    }
  }
  return shas
}

// worktreeEvidence: real, externally-gathered facts about the run's real
//   worktree -- { headCommit, headCommitAt, clean, commitsSinceLastCheckpoint:
//   [{ sha, at, subject }] }. Never fabricated by this function.
// verdict: the real structured verification result read back from disk (see
//   settled-run-reconciler.mjs's readVerificationVerdict), or null if none
//   exists yet -- shape { criteria: [{ criterion, verified, evidence }] }.
//   Never invented here; a missing verdict always means "dispatch one",
//   never "assume passed".
//
// Returns exactly one of:
//   NOT_APPLICABLE      -- needsReconciliation(run) is false; nothing to do
//   ALREADY_RECONCILED  -- everything below is already captured/settled/idempotent no-op
//   CAPTURE_LATE_COMMITS -- real post-checkpoint commits exist, uncaptured
//   DISPATCH_VERIFICATION -- no verification has ever been run for this run
//   COMPLETE             -- verification confirms every acceptance criterion; safe to completeRun
//   NEEDS_DECISION        -- verification found real, unsatisfied criteria
export function decideReconciliationAction({ run, worktreeEvidence, verdict }) {
  if (!needsReconciliation(run)) {
    return { action: 'NOT_APPLICABLE', reason: 'run is not in a settled, unowned state' }
  }

  const captured = alreadyCapturedShas(run)
  const uncaptured = (worktreeEvidence?.commitsSinceLastCheckpoint ?? []).filter(
    (commit) => !captured.has(commit.sha)
  )
  if (uncaptured.length > 0) {
    return {
      action: 'CAPTURE_LATE_COMMITS',
      commits: uncaptured,
      reason: `${uncaptured.length} real commit(s) exist in the worktree after this run's last checkpoint and were never recorded`
    }
  }

  if (!verdict) {
    return {
      action: 'DISPATCH_VERIFICATION',
      reason: "no independent verification has ever run against this run's real acceptance criteria"
    }
  }

  const failed = verdict.criteria.filter((entry) => !entry.verified)
  if (failed.length === 0) {
    return {
      action: 'COMPLETE',
      verifiedSatisfied: verdict.criteria.map((entry) => entry.criterion),
      reason: 'independent verification confirms every acceptance criterion is satisfied'
    }
  }

  const priorAttempts = run.retryCounts[RECONCILIATION_VERIFICATION_TASK_ID] ?? 0
  return {
    action: 'NEEDS_DECISION',
    reason: `independent verification found ${failed.length} unsatisfied criterion(criteria): ${failed
      .map((entry) => entry.criterion)
      .join('; ')}`,
    failed,
    // Whether this has already exhausted this run's own declared retry
    // budget for the verification task -- settled-run-reconciler.mjs uses
    // this to decide checkpoint-and-continue vs raiseNeedsYou, reusing the
    // exact same budget convention abandonStalledWave already applies to
    // stalled implementation work, rather than inventing a second one.
    retryBudgetExceeded: priorAttempts >= run.budget.maxRetriesPerTask
  }
}

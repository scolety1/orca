// Stage F I/O layer: gathers REAL evidence (git log, a real disk-read
// verdict file) and acts on tsf/domain/settled-run-reconciliation.mjs's
// decision using ONLY existing, real primitives -- keep-going-run-store.mjs
// for the CAS-safe checkpoint/complete mutations, and the existing
// tickKeepGoingRun dispatch pipeline (keep-going-dispatch-loop.mjs) for the
// one new dispatched work item this module ever asks for: a real,
// verification-only wave. Never fabricates verifiedSatisfied -- the only
// path to COMPLETE is a real verdict file written by a real dispatched
// worker task and read back off disk.
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import {
  getCurrentCommit,
  isCleanWorkingTree,
  listCommitsSince
} from '../adapters/git-identity.mjs'
import {
  checkpointRun,
  completeRun,
  raiseNeedsYou,
  recordTaskAttempt
} from '../domain/keep-going.mjs'
import {
  decideReconciliationAction,
  needsReconciliation,
  RECONCILIATION_VERIFICATION_TASK_ID,
  LATE_COMMITS_CHECKPOINT_PHASE
} from '../domain/settled-run-reconciliation.mjs'
import { readKeepGoingRun, withKeepGoingRun } from './keep-going-run-store.mjs'
import { tickKeepGoingRun } from './keep-going-dispatch-loop.mjs'

// The one, conventional, project-relative path a dispatched verification
// task is instructed to write its real structured verdict to. Namespaced
// by runId so a project's successive Keep Going runs never collide.
export function verificationVerdictPath(runId) {
  return path.join('docs', 'tsf', 'verification', `${runId}.json`)
}

// The real worktree this run's work has actually been happening in --
// taken from its most recently recorded wave's own plan (real, already-
// dispatched evidence), never guessed or defaulted. Returns null (an
// honest "unknown", never a fabricated path) if the run has no waves with
// an identifiable worktree.
export function deriveWorktreePath(run) {
  for (let i = run.waves.length - 1; i >= 0; i -= 1) {
    const batches = run.waves[i]?.wavePlan?.batches ?? []
    for (const batch of batches) {
      for (const item of batch) {
        if (item.worktree) {
          return item.worktree
        }
      }
    }
  }
  return null
}

function lastKnownActivityAt(run) {
  return run.checkpoints.at(-1)?.at ?? run.waves.at(-1)?.waveResult?.settledAt ?? run.createdAt
}

// Real git facts about the run's real worktree -- never fabricated. `ok:
// false` (worktree missing/unreadable) is reported honestly, not treated
// as "no evidence" (that would silently hide a real problem, e.g. a
// worktree someone deleted out from under an active run).
export async function gatherWorktreeEvidence(run) {
  const worktreePath = deriveWorktreePath(run)
  if (!worktreePath) {
    return { ok: false, reason: 'NO_KNOWN_WORKTREE' }
  }
  const since = lastKnownActivityAt(run)
  const [head, clean, commits] = await Promise.all([
    getCurrentCommit(worktreePath),
    isCleanWorkingTree(worktreePath),
    listCommitsSince(worktreePath, since)
  ])
  if (!head.ok || !clean.ok || !commits.ok) {
    return {
      ok: false,
      reason: 'GIT_EVIDENCE_GATHERING_FAILED',
      detail: [head, clean, commits].find((r) => !r.ok)
    }
  }
  return {
    ok: true,
    worktreePath,
    headCommit: head.commit,
    clean: clean.clean,
    commitsSinceLastCheckpoint: commits.commits
  }
}

// Reads back the real, structured verification verdict a dispatched
// verification wave was instructed to write. Any failure to find or parse
// it (not yet written, malformed, criteria that don't match the run's own
// acceptanceCriteria) is treated as "no real verdict yet" -- honestly
// re-triggers DISPATCH_VERIFICATION rather than crashing or guessing.
export async function readVerificationVerdict(run, worktreePath) {
  if (!worktreePath) {
    return null
  }
  const filePath = path.join(worktreePath, verificationVerdictPath(run.id))
  let raw
  try {
    raw = await readFile(filePath, 'utf8')
  } catch {
    return null
  }
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!Array.isArray(parsed?.criteria)) {
    return null
  }
  const knownCriteria = new Set(run.originalGoal.acceptanceCriteria)
  const criteria = parsed.criteria.filter(
    (entry) =>
      typeof entry?.criterion === 'string' &&
      knownCriteria.has(entry.criterion) &&
      typeof entry?.verified === 'boolean'
  )
  // Every real acceptance criterion must have a real verdict entry -- a
  // verdict that only covers some criteria is not a complete, trustworthy
  // read; treat it the same as no verdict rather than deciding COMPLETE on
  // a partial picture.
  if (criteria.length !== run.originalGoal.acceptanceCriteria.length) {
    return null
  }
  return { criteria }
}

function buildVerificationWorkItem(run, worktreePath) {
  const criteriaList = run.originalGoal.acceptanceCriteria.map((c) => `- ${c}`).join('\n')
  return {
    id: RECONCILIATION_VERIFICATION_TASK_ID,
    scope: ['**/*'],
    worktree: worktreePath,
    agent: 'codex',
    spec: [
      "This is an autonomous, VERIFICATION-ONLY dispatch from TSF's settled-run reconciler.",
      'Do NOT modify any code, config, or data file. Do not commit anything.',
      `Original goal: ${run.originalGoal.statement}`,
      'For EACH of the following acceptance criteria, independently verify (by actually',
      'running the real commands/checks this project already uses -- do not take any prior',
      'claim of success on faith) whether it is genuinely satisfied right now:',
      criteriaList,
      'Write your findings as a single JSON file at exactly this path (relative to the',
      `repo root): ${verificationVerdictPath(run.id)}`,
      `Its shape must be exactly: {"schemaVersion":"TSF_VERIFICATION_VERDICT_V1","runId":"${run.id}","criteria":[{"criterion":"<verbatim criterion text>","verified":true|false,"evidence":"<real, specific evidence -- command run, output observed>"}],"verifiedAt":"<ISO timestamp>"}`,
      'Include exactly one entry per criterion listed above, using the criterion text verbatim.',
      'Be honest: if a criterion cannot be verified true, mark it false with real evidence why.'
    ].join('\n')
  }
}

// The one entry point: given a projectId, real project row, and clock,
// gathers real evidence, decides the correct action per
// settled-run-reconciliation.mjs, and performs exactly that action using
// only existing, safe primitives. Safe to call repeatedly (idempotent --
// each action either is a genuine no-op on replay or naturally converges:
// capturing already-captured commits is a no-op via alreadyCapturedShas,
// dispatching verification when one is already in flight is refused by
// tickKeepGoingRun's own claimTick, and completing an already-COMPLETE run
// is refused by transitionRun's RUN_ALLOWED table).
export async function reconcileSettledRun(projectId, clock, deps = {}) {
  const store = deps.store ?? { readRun: readKeepGoingRun, withRun: withKeepGoingRun }
  const run = await store.readRun(projectId)
  if (!run) {
    return { action: 'NOT_APPLICABLE', reason: 'no Keep Going run exists for this project' }
  }
  if (!needsReconciliation(run)) {
    return { action: 'NOT_APPLICABLE', reason: 'run is not in a settled, unowned state' }
  }

  const worktreeEvidence = await gatherWorktreeEvidence(run)
  if (!worktreeEvidence.ok) {
    return {
      action: 'EVIDENCE_UNAVAILABLE',
      reason: worktreeEvidence.reason,
      detail: worktreeEvidence.detail
    }
  }
  const verdict = await readVerificationVerdict(run, worktreeEvidence.worktreePath)
  const decision = decideReconciliationAction({ run, worktreeEvidence, verdict })

  if (decision.action === 'CAPTURE_LATE_COMMITS') {
    await store.withRun(projectId, (current) =>
      checkpointRun(
        current,
        {
          phase: LATE_COMMITS_CHECKPOINT_PHASE,
          note: `${decision.commits.length} real commit(s) found in the worktree after this run's last checkpoint, captured by the settled-run reconciler`,
          evidence: decision.commits.map((c) => c.sha)
        },
        clock,
        current.revision
      )
    )
    return { ...decision, performed: true }
  }

  if (decision.action === 'DISPATCH_VERIFICATION') {
    const result = await tickKeepGoingRun(
      projectId,
      [buildVerificationWorkItem(run, worktreeEvidence.worktreePath)],
      clock,
      deps.tickDeps ?? {}
    )
    return { ...decision, performed: true, dispatch: result }
  }

  if (decision.action === 'COMPLETE') {
    await store.withRun(projectId, (current) => completeRun(current, clock))
    return { ...decision, performed: true }
  }

  if (decision.action === 'NEEDS_DECISION') {
    await (decision.retryBudgetExceeded
      ? store.withRun(projectId, (current) =>
          raiseNeedsYou(
            current,
            {
              question: `Independent verification found unsatisfied acceptance criteria after exhausting the retry budget: ${decision.failed
                .map((f) => f.criterion)
                .join('; ')}. How should I proceed?`,
              options: ['DISPATCH_ANOTHER_ATTEMPT', 'REVISE_ACCEPTANCE_CRITERIA', 'ABANDON_RUN']
            },
            clock,
            current.revision
          )
        )
      : store.withRun(projectId, (current) => {
          let next = recordTaskAttempt(
            current,
            RECONCILIATION_VERIFICATION_TASK_ID,
            'RETRY',
            clock,
            current.revision
          )
          next = checkpointRun(
            next,
            {
              phase: 'RECONCILIATION_VERIFICATION_FOUND_GAPS',
              note: decision.reason,
              evidence: decision.failed.map((f) => f.criterion)
            },
            clock,
            next.revision
          )
          return next
        }))
    return { ...decision, performed: true }
  }

  return {
    action: 'NOT_APPLICABLE',
    reason: 'no evidence gap and no decision needed',
    performed: false
  }
}

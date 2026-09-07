// Real mutating implementations for the worktree/branch action classes.
// Every function returns { steps, result } on success or throws (with
// `.code` set) on failure -- server/cleanup-executor.mjs's orchestration
// wrapper is what actually records these as durable execution steps/
// receipts; these functions have no knowledge of the request/receipt store.
import {
  gitBranchDeleteForce,
  gitBranchDeleteSafe,
  gitWorktreeRemove,
  isBranchCheckedOutAnywhere,
  isBranchMergedInto
} from './cleanup-git-worktree-inventory.mjs'
import { moveToQuarantine } from './cleanup-quarantine-store.mjs'

// Quarantines a full COPY of the worktree directory first (preserving any
// untracked/gitignored content `git worktree remove` would otherwise
// destroy irretrievably -- git's own clean-tree requirement only covers
// TRACKED changes), then lets `git worktree remove` perform the real,
// git-consistent removal (administrative metadata + directory) in one
// atomic git operation, rather than this code trying to hand-roll `git
// worktree prune` semantics itself.
export async function executeRemoveDisposableWorktree(resolvedRealPath, { requestId, repoRoot }, { clock } = {}) {
  const steps = []
  const manifest = moveToQuarantine(
    { requestId, actionClass: 'REMOVE_DISPOSABLE_WORKTREE', originalPath: resolvedRealPath, mode: 'COPY' },
    { clock }
  )
  steps.push({ name: 'QUARANTINE_COPY', status: 'COMPLETED', detail: { quarantineId: manifest.quarantineId } })

  const removed = await gitWorktreeRemove(repoRoot, resolvedRealPath)
  if (!removed.ok) {
    const error = new Error(`git worktree remove failed: ${removed.detail}`)
    error.code = 'TSF_CLEANUP_WORKTREE_REMOVE_FAILED'
    error.stepsCompleted = steps
    throw error
  }
  steps.push({ name: 'GIT_WORKTREE_REMOVE', status: 'COMPLETED' })
  return { steps, result: { quarantineId: manifest.quarantineId, removedPath: resolvedRealPath } }
}

// `git branch -d` (lowercase) is itself a real safety mechanism -- git
// refuses if the branch is not fully merged. This function adds two
// belt-and-suspenders pre-checks (not checked out anywhere; independently
// re-verified merged via merge-base) so a caller gets a structured,
// specific reason rather than only git's own stderr text.
export async function executeDeleteLocalMergedBranch(resolvedRealPath, { repoRoot, branch, canonicalBranch = 'main' }) {
  const steps = []
  const checkedOut = await isBranchCheckedOutAnywhere(repoRoot, branch)
  if (checkedOut !== false) {
    const error = new Error(`branch ${branch} checked-out status is not confirmed clear (${checkedOut})`)
    error.code = 'TSF_CLEANUP_BRANCH_CHECKED_OUT_OR_UNKNOWN'
    throw error
  }
  steps.push({ name: 'VERIFY_NOT_CHECKED_OUT', status: 'COMPLETED' })

  const merged = await isBranchMergedInto(repoRoot, branch, canonicalBranch)
  if (merged !== true) {
    const error = new Error(`branch ${branch} is not confirmed merged into ${canonicalBranch} (${merged})`)
    error.code = 'TSF_CLEANUP_BRANCH_NOT_MERGED'
    throw error
  }
  steps.push({ name: 'VERIFY_MERGED', status: 'COMPLETED' })

  const deleted = await gitBranchDeleteSafe(repoRoot, branch)
  if (!deleted.ok) {
    const error = new Error(`git branch -d failed: ${deleted.detail}`)
    error.code = 'TSF_CLEANUP_BRANCH_DELETE_FAILED'
    error.stepsCompleted = steps
    throw error
  }
  steps.push({ name: 'GIT_BRANCH_DELETE_SAFE', status: 'COMPLETED' })
  return { steps, result: { deletedBranch: branch } }
}

// ELEVATED tier -- a real V0 executor exists here deliberately, to PROVE
// the tier distinction in domain/cleanup-action-taxonomy.mjs is structural
// (routed, tested, refused-without-the-gate) rather than only a label. It
// still runs through the exact same runGovernedCleanupAction pipeline
// (same owner gate, same fresh blocker re-checks) as every STANDARD class
// for V0 -- a stronger/separate elevated-only grant is explicitly deferred
// to a future phase (see the taxonomy module's header comment).
export async function executeDeleteBranchWithUniqueUnpushedCommits(resolvedRealPath, { repoRoot, branch }) {
  const steps = []
  const checkedOut = await isBranchCheckedOutAnywhere(repoRoot, branch)
  if (checkedOut !== false) {
    const error = new Error(`branch ${branch} checked-out status is not confirmed clear (${checkedOut})`)
    error.code = 'TSF_CLEANUP_BRANCH_CHECKED_OUT_OR_UNKNOWN'
    throw error
  }
  steps.push({ name: 'VERIFY_NOT_CHECKED_OUT', status: 'COMPLETED' })

  const deleted = await gitBranchDeleteForce(repoRoot, branch)
  if (!deleted.ok) {
    const error = new Error(`git branch -D failed: ${deleted.detail}`)
    error.code = 'TSF_CLEANUP_BRANCH_DELETE_FORCE_FAILED'
    error.stepsCompleted = steps
    throw error
  }
  steps.push({ name: 'GIT_BRANCH_DELETE_FORCE', status: 'COMPLETED' })
  return { steps, result: { deletedBranch: branch, forced: true } }
}

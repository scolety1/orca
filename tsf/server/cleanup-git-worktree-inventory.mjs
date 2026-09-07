// Real, read-only git evidence collection for Cleanup V1's worktree/branch
// action classes. Every function runs exactly one bounded git subprocess
// via execFile with an args array (no shell, matching resource-auditor-
// git-object-store.mjs's own no-injection-surface discipline) and never
// throws -- failures come back as a structured { ok: false } result, the
// same honest-failure convention repository-identity.mjs established.
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const exec = promisify(execFile)
const GIT_TIMEOUT_MS = 15000

function slash(value) {
  return String(value ?? '').replaceAll('\\', '/')
}

async function git(cwd, args) {
  return exec('git', ['-c', `safe.directory=${slash(cwd)}`, '-C', cwd, ...args], {
    timeout: GIT_TIMEOUT_MS,
    windowsHide: true,
    maxBuffer: 4 * 1024 * 1024,
    encoding: 'utf8'
  })
}

// Parses `git worktree list --porcelain` into structured rows. Each record
// separated by a blank line; fields are `key value` or bare flags
// (bare/detached/locked/prunable).
function parseWorktreeListPorcelain(stdout) {
  const rows = []
  let current = null
  for (const line of String(stdout ?? '').split('\n')) {
    if (!line.trim()) {
      if (current) {
        rows.push(current)
      }
      current = null
      continue
    }
    if (!current) {
      current = { path: null, head: null, branch: null, bare: false, detached: false, locked: false, prunable: false }
    }
    const [key, ...rest] = line.split(' ')
    const value = rest.join(' ')
    if (key === 'worktree') {
      current.path = value
    } else if (key === 'HEAD') {
      current.head = value
    } else if (key === 'branch') {
      current.branch = value.replace(/^refs\/heads\//, '')
    } else if (key === 'bare') {
      current.bare = true
    } else if (key === 'detached') {
      current.detached = true
    } else if (key === 'locked') {
      current.locked = true
    } else if (key === 'prunable') {
      current.prunable = true
    }
  }
  if (current) {
    rows.push(current)
  }
  return rows
}

export async function listGitWorktrees(repoPath) {
  try {
    const { stdout } = await git(repoPath, ['worktree', 'list', '--porcelain'])
    return { ok: true, worktrees: parseWorktreeListPorcelain(stdout) }
  } catch (error) {
    return { ok: false, reason: 'GIT_COMMAND_FAILED', detail: error.message }
  }
}

// True/false/null (null = unverifiable, e.g. path isn't a real repo) --
// never a guess.
export async function isWorktreeClean(worktreePath) {
  try {
    const { stdout } = await git(worktreePath, ['status', '--porcelain'])
    return stdout.trim().length === 0
  } catch {
    return null
  }
}

// `git merge-base --is-ancestor <branch> <intoBranch>` -- exit 0 means
// every commit on `branch` is already reachable from `intoBranch` (safe to
// `git branch -d`). Exit 1 means not merged. Any other failure is
// unverifiable (null), never assumed merged.
export async function isBranchMergedInto(repoPath, branch, intoBranch) {
  try {
    await git(repoPath, ['merge-base', '--is-ancestor', branch, intoBranch])
    return true
  } catch (error) {
    if (typeof error.code === 'number' && error.code === 1) {
      return false
    }
    return null
  }
}

// Real unpushed-commit count. With a configured upstream, ahead-count is
// authoritative; without one, counts commits unreachable from ANY remote
// tracking ref (mirrors Orca core's own documented fallback, per
// docs/tsf/TSF_RESOURCE_AUDITOR_V0.md's reconciliation notes). Returns null
// (never 0) on any git failure.
export async function countUnpushedCommits(repoPath, branch) {
  try {
    const { stdout: upstream } = await git(repoPath, ['rev-parse', '--abbrev-ref', `${branch}@{upstream}`]).catch(() => ({ stdout: '' }))
    if (upstream.trim()) {
      const { stdout } = await git(repoPath, ['rev-list', '--count', `${upstream.trim()}..${branch}`])
      return Number.parseInt(stdout.trim(), 10)
    }
    const { stdout } = await git(repoPath, ['rev-list', '--count', branch, '--not', '--remotes'])
    return Number.parseInt(stdout.trim(), 10)
  } catch {
    return null
  }
}

// True if `branch` is checked out in ANY worktree of this repository
// (including the main one) -- git itself also refuses to delete a branch
// checked out elsewhere, this is a belt-and-suspenders pre-check so the
// caller gets a structured reason rather than parsing git's own error text.
export async function isBranchCheckedOutAnywhere(repoPath, branch) {
  const inventory = await listGitWorktrees(repoPath)
  if (!inventory.ok) {
    return null
  }
  return inventory.worktrees.some((w) => w.branch === branch)
}

export async function gitBranchDeleteSafe(repoPath, branch) {
  try {
    await git(repoPath, ['branch', '-d', branch])
    return { ok: true }
  } catch (error) {
    return { ok: false, reason: 'GIT_BRANCH_DELETE_FAILED', detail: error.message }
  }
}

export async function gitBranchDeleteForce(repoPath, branch) {
  try {
    await git(repoPath, ['branch', '-D', branch])
    return { ok: true }
  } catch (error) {
    return { ok: false, reason: 'GIT_BRANCH_DELETE_FORCE_FAILED', detail: error.message }
  }
}

export async function gitWorktreeRemove(repoPath, worktreePath) {
  try {
    await git(repoPath, ['worktree', 'remove', worktreePath])
    return { ok: true }
  } catch (error) {
    return { ok: false, reason: 'GIT_WORKTREE_REMOVE_FAILED', detail: error.message }
  }
}

export async function gitWorktreeAdd(repoPath, worktreePath, branch) {
  try {
    await git(repoPath, ['worktree', 'add', worktreePath, branch])
    return { ok: true }
  } catch (error) {
    return { ok: false, reason: 'GIT_WORKTREE_ADD_FAILED', detail: error.message }
  }
}

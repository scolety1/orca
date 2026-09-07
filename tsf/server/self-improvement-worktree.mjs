// Native Self-Improvement Loop V1, Phase 4: real, isolated git worktree
// creation for a repair worker -- mirrors this program's own established
// worktree-per-wave shape (`git worktree add -q --detach <path> HEAD &&
// git checkout -q -b <branch>`) and cleanup-git-worktree-inventory.mjs's
// own execFile/promisify/no-shell git() convention (REUSE_PATTERN). A
// fresh worktree per repair ATTEMPT (not per mission) -- see
// self-improvement-worker-dispatch.mjs -- so a retried attempt never
// reuses a possibly-dirty prior attempt's tree.
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { resolve } from 'node:path'

const exec = promisify(execFile)
const GIT_TIMEOUT_MS = 30000

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

// Real fresh worktree, detached at canonical HEAD then checked out onto a
// brand-new branch -- never the canonical repo root itself (asserted here,
// not just assumed by callers): worktreePath is always a caller-supplied
// path OUTSIDE canonicalRepoPath.
export async function createIsolatedRepairWorktree({ canonicalRepoPath, worktreePath, branch }) {
  if (resolve(worktreePath).toLowerCase() === resolve(canonicalRepoPath).toLowerCase()) {
    const error = new Error('refusing to create an isolated repair worktree at the canonical repo path itself')
    error.code = 'TSF_SELF_IMPROVEMENT_WORKTREE_TARGETS_CANONICAL_REPO'
    throw error
  }
  await git(canonicalRepoPath, ['worktree', 'add', '-q', '--detach', worktreePath, 'HEAD'])
  await git(worktreePath, ['checkout', '-q', '-b', branch])
  const { stdout: sha } = await git(worktreePath, ['rev-parse', 'HEAD'])
  return { worktreePath, branch, baseSha: sha.trim() }
}

// Real removal, used only by an explicit operational cleanup call (never
// auto-invoked by the repair/verify/adopt cycle itself -- a candidate
// worktree IS the rollback boundary until adoption, see
// self-improvement-authority-envelope.mjs's rollbackExpectations). `force`
// mirrors `git worktree remove --force`'s own real semantics: required
// when the worktree has uncommitted changes, which a genuinely-finished
// repair worker's committed tree should never have.
export async function removeIsolatedRepairWorktree(canonicalRepoPath, worktreePath, { force = false } = {}) {
  const args = ['worktree', 'remove', worktreePath]
  if (force) { args.splice(2, 0, '--force') }
  await git(canonicalRepoPath, args)
}

// Real `git diff --name-only` between the worktree's own base and its
// current HEAD -- the verifier's mechanical forbidden-surface/scope
// evidence. Returns a sorted, deduped, real relative-path list.
export async function listChangedFiles(worktreePath, baseSha) {
  const { stdout } = await git(worktreePath, ['diff', '--name-only', `${baseSha}..HEAD`])
  return [...new Set(stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean))].sort()
}

export async function currentHeadSha(worktreePath) {
  const { stdout } = await git(worktreePath, ['rev-parse', 'HEAD'])
  return stdout.trim()
}

export async function isWorktreeClean(worktreePath) {
  const { stdout } = await git(worktreePath, ['status', '--porcelain'])
  return stdout.trim().length === 0
}

// Real `git diff --name-status`, filtered to newly-added paths only -- the
// verifier's evidence for the duplicate-architecture heuristic (only a NEW
// file can "duplicate" something that already exists; a modified existing
// file cannot).
export async function listAddedFiles(worktreePath, baseSha) {
  const { stdout } = await git(worktreePath, ['diff', '--name-status', `${baseSha}..HEAD`])
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith('A\t'))
    .map((line) => line.slice(2).trim())
    .filter(Boolean)
    .sort()
}

// Real full tracked-file basename list for the CANONICAL repo (not the
// worktree) -- what the duplicate-architecture heuristic compares a
// worker's new files against.
export async function listCanonicalFileBasenames(canonicalRepoPath) {
  const { stdout } = await git(canonicalRepoPath, ['ls-files'])
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((path) => path.split('/').pop())
}

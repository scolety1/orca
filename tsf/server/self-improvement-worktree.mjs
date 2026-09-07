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
import { basename, dirname, resolve } from 'node:path'
import { resolveCanonicalPath } from './resource-auditor-path-identity.mjs'
import { listGitWorktrees } from './cleanup-git-worktree-inventory.mjs'

const exec = promisify(execFile)
const GIT_TIMEOUT_MS = 30000

function slash(value) {
  return String(value ?? '').replaceAll('\\', '/')
}

// SECURITY (Phase 8 adversarial review, scenario 5): a plain resolve()
// string comparison does NOT follow a Windows junction/symlink alias --
// the same class of gap Finding Phase 14 found and fixed for Cleanup V1's
// protected-path registry via resolveCanonicalPath (real OS-level
// realpath, not string normalization). Reused directly here. Unlike that
// registry's targets, worktreePath legitimately does NOT exist yet at
// check time (it is about to be created by `git worktree add`) so
// fs.realpath alone would throw -- this walks up to the deepest EXISTING
// ancestor, canonicalizes THAT (defeating an alias on any real directory),
// then re-appends the not-yet-created tail segments.
async function canonicalizeAllowingMissingTail(candidatePath) {
  let current = resolve(candidatePath)
  const missingTail = []
  for (;;) {
    const real = await resolveCanonicalPath(current)
    if (real !== null) {
      return missingTail.length > 0 ? resolve(real, ...missingTail.toReversed()) : real
    }
    const parent = dirname(current)
    if (parent === current) { return resolve(candidatePath) } // nothing on this path exists -- fall back to plain resolve
    missingTail.push(basename(current))
    current = parent
  }
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
  const [canonicalReal, worktreeReal] = await Promise.all([
    canonicalizeAllowingMissingTail(canonicalRepoPath),
    canonicalizeAllowingMissingTail(worktreePath)
  ])
  const targetsCanonical =
    resolve(worktreePath).toLowerCase() === resolve(canonicalRepoPath).toLowerCase() ||
    worktreeReal.toLowerCase() === canonicalReal.toLowerCase()
  if (targetsCanonical) {
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

// Real `git status --porcelain` text, or null if unresolvable -- callers
// must treat null as "cannot verify", never coerce it to "clean" (same
// fail-closed discipline this module's own isWorktreeClean documents
// elsewhere, but this variant preserves the raw text for a real before/
// after content comparison, not just a clean/dirty boolean).
export async function worktreeStatusPorcelain(worktreePath) {
  try {
    const { stdout } = await git(worktreePath, ['status', '--porcelain'])
    return stdout
  } catch {
    return null
  }
}

// SECURITY (Phase 8 adversarial review, scenario 11): checkForbiddenSurfaceTouched
// is git-diff-based and can only see files inside THIS worktree's own
// tracked tree -- nothing stops a worker process, at the OS/filesystem
// level, from reading or writing a SIBLING worktree of the SAME repository
// (e.g. dataset-research-engine-v0) via an ordinary relative path, entirely
// outside this worktree's own git diff. `git worktree list` on the
// canonical repo is the one real, mechanically discoverable inventory of
// every such sibling -- this snapshots their status so a caller can compare
// before dispatch vs. after, catching a worker that reached outside its own
// worktree into another real worktree of this repo. A null return (the
// inventory call itself failed) or a null per-path status must both fail
// CLOSED downstream (self-improvement-verifier-checks.mjs's
// checkSiblingWorktreesUntouched), never be silently treated as untouched.
// Genuinely does NOT cover a completely separate repository the worker
// might discover some other way (e.g. NWR) -- honestly disclosed, not
// oversold, matching this module's own duplicate-architecture-heuristic
// disclosure discipline.
export async function snapshotSiblingWorktreeStatuses(canonicalRepoPath, excludeWorktreePaths) {
  const inventory = await listGitWorktrees(canonicalRepoPath)
  if (!inventory.ok) { return null }
  // Real OS-level canonicalization (not plain resolve()) on BOTH sides --
  // git itself can report a worktree path in a different string form (e.g.
  // Windows short/8.3 vs. long form) than the literal string this caller
  // passed in, and a plain string compare would then fail to exclude the
  // caller's own paths, misreporting them as "siblings".
  const excluded = new Set(await Promise.all(excludeWorktreePaths.map((p) => canonicalizeAllowingMissingTail(p).then((real) => real.toLowerCase()))))
  const statuses = {}
  for (const worktree of inventory.worktrees) {
    if (!worktree.path) { continue }
    const real = (await canonicalizeAllowingMissingTail(worktree.path)).toLowerCase()
    if (excluded.has(real)) { continue }
    statuses[worktree.path] = await worktreeStatusPorcelain(worktree.path)
  }
  return statuses
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

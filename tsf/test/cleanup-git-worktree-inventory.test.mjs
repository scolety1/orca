// Real, disposable git repositories created under os.tmpdir() -- never a
// real machine path. Exercises the actual git subprocess calls, not mocks.
import assert from 'node:assert/strict'
import test from 'node:test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  countUnpushedCommits,
  gitBranchDeleteForce,
  gitBranchDeleteSafe,
  gitWorktreeAdd,
  gitWorktreeRemove,
  isBranchCheckedOutAnywhere,
  isBranchMergedInto,
  isWorktreeClean,
  listGitWorktrees
} from '../server/cleanup-git-worktree-inventory.mjs'

const ROOT = mkdtempSync(path.join(tmpdir(), 'tsf-cleanup-git-inventory-'))
test.after(() => rmSync(ROOT, { recursive: true, force: true }))

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}

function initMainRepo(name) {
  const dir = path.join(ROOT, name)
  git(ROOT, ['init', '-q', '-b', 'main', dir])
  git(dir, ['config', 'user.email', 'fixture@example.com'])
  git(dir, ['config', 'user.name', 'Fixture'])
  writeFileSync(path.join(dir, 'README.md'), 'root\n')
  git(dir, ['add', '.'])
  git(dir, ['commit', '-q', '-m', 'initial'])
  return dir
}

test('listGitWorktrees lists the main worktree for a fresh repo', async () => {
  const repo = initMainRepo('repo-list')
  const result = await listGitWorktrees(repo)
  assert.equal(result.ok, true)
  assert.equal(result.worktrees.length, 1)
  assert.equal(result.worktrees[0].branch, 'main')
})

test('listGitWorktrees fails structured (not a throw) for a non-repo path', async () => {
  const notARepo = path.join(ROOT, 'not-a-repo')
  const result = await listGitWorktrees(notARepo)
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'GIT_COMMAND_FAILED')
})

test('isWorktreeClean: true for a clean tree, false for a dirty one, null for a non-repo', async () => {
  const repo = initMainRepo('repo-clean')
  assert.equal(await isWorktreeClean(repo), true)
  writeFileSync(path.join(repo, 'dirty.txt'), 'uncommitted')
  assert.equal(await isWorktreeClean(repo), false)
  assert.equal(await isWorktreeClean(path.join(ROOT, 'nope')), null)
})

test('isBranchMergedInto: true for an ancestor branch, false for one with a unique commit, null for a bogus branch', async () => {
  const repo = initMainRepo('repo-merge')
  git(repo, ['checkout', '-q', '-b', 'feature/merged'])
  git(repo, ['checkout', '-q', 'main'])
  assert.equal(await isBranchMergedInto(repo, 'feature/merged', 'main'), true)

  git(repo, ['checkout', '-q', '-b', 'feature/ahead'])
  writeFileSync(path.join(repo, 'ahead.txt'), 'x')
  git(repo, ['add', '.'])
  git(repo, ['commit', '-q', '-m', 'ahead commit'])
  git(repo, ['checkout', '-q', 'main'])
  assert.equal(await isBranchMergedInto(repo, 'feature/ahead', 'main'), false)

  assert.equal(await isBranchMergedInto(repo, 'does-not-exist', 'main'), null)
})

test('countUnpushedCommits: no upstream configured falls back to "unreachable from any remote" (equals total commits with no remotes)', async () => {
  const repo = initMainRepo('repo-unpushed')
  const count = await countUnpushedCommits(repo, 'main')
  assert.equal(count, 1) // just the initial commit, no remote configured at all
})

test('worktree add/remove round-trip against a real linked worktree', async () => {
  const repo = initMainRepo('repo-worktree-roundtrip')
  git(repo, ['branch', 'feature/wt'])
  const worktreePath = path.join(ROOT, 'repo-worktree-roundtrip-linked')
  const added = await gitWorktreeAdd(repo, worktreePath, 'feature/wt')
  assert.equal(added.ok, true)
  assert.ok(existsSync(worktreePath))

  const inventory = await listGitWorktrees(repo)
  assert.equal(inventory.worktrees.length, 2)
  assert.equal(await isBranchCheckedOutAnywhere(repo, 'feature/wt'), true)

  const removed = await gitWorktreeRemove(repo, worktreePath)
  assert.equal(removed.ok, true)
  assert.equal(existsSync(worktreePath), false)
  assert.equal(await isBranchCheckedOutAnywhere(repo, 'feature/wt'), false)
})

test('gitBranchDeleteSafe succeeds for a merged branch and refuses a branch with a unique commit', async () => {
  const repo = initMainRepo('repo-branch-delete')
  git(repo, ['branch', 'feature/merged-del'])
  const safeDelete = await gitBranchDeleteSafe(repo, 'feature/merged-del')
  assert.equal(safeDelete.ok, true)

  git(repo, ['checkout', '-q', '-b', 'feature/unmerged-del'])
  writeFileSync(path.join(repo, 'unmerged.txt'), 'x')
  git(repo, ['add', '.'])
  git(repo, ['commit', '-q', '-m', 'unmerged commit'])
  git(repo, ['checkout', '-q', 'main'])
  const refused = await gitBranchDeleteSafe(repo, 'feature/unmerged-del')
  assert.equal(refused.ok, false, 'git branch -d must itself refuse a non-merged branch')
})

test('gitBranchDeleteForce succeeds even for a branch with a unique unpushed commit (the ELEVATED path)', async () => {
  const repo = initMainRepo('repo-branch-force-delete')
  git(repo, ['checkout', '-q', '-b', 'feature/force-me'])
  writeFileSync(path.join(repo, 'force.txt'), 'x')
  git(repo, ['add', '.'])
  git(repo, ['commit', '-q', '-m', 'unique commit'])
  git(repo, ['checkout', '-q', 'main'])
  const forced = await gitBranchDeleteForce(repo, 'feature/force-me')
  assert.equal(forced.ok, true)
})

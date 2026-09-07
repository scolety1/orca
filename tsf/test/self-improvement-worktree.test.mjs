// Real, disposable git repositories under os.tmpdir() -- never
// C:\TSF_ORCA or any other real worktree. Exercises the REAL git worktree
// creation mechanism (mirrors cleanup-git-worktree-inventory.test.mjs's
// own fixture pattern) since this is exactly the "documented real-
// mechanism code path proven safe with fakes first" case the mission
// brief allows: a genuinely isolated worktree THIS code creates, never
// written to further by the test itself.
import assert from 'node:assert/strict'
import test from 'node:test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createIsolatedRepairWorktree, isWorktreeClean, listAddedFiles, listCanonicalFileBasenames, listChangedFiles } from '../server/self-improvement-worktree.mjs'

const ROOT = mkdtempSync(path.join(tmpdir(), 'tsf-selfimprove-worktree-'))
test.after(() => rmSync(ROOT, { recursive: true, force: true }))

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}

function initFixtureRepo(name) {
  const dir = path.join(ROOT, name)
  git(ROOT, ['init', '-q', '-b', 'main', dir])
  git(dir, ['config', 'user.email', 'fixture@example.com'])
  git(dir, ['config', 'user.name', 'Fixture'])
  writeFileSync(path.join(dir, 'existing-file.mjs'), 'export const x = 1\n')
  git(dir, ['add', '.'])
  git(dir, ['commit', '-q', '-m', 'initial'])
  return dir
}

test('createIsolatedRepairWorktree creates a real, clean, detached-then-branched worktree', async () => {
  const canonicalRepoPath = initFixtureRepo('repo-create')
  const worktreePath = path.join(ROOT, 'attempt-worktree-1')
  const worktree = await createIsolatedRepairWorktree({ canonicalRepoPath, worktreePath, branch: 'tsf/self-improve/fixture/attempt-1' })
  assert.equal(worktree.worktreePath, worktreePath)
  assert.equal(worktree.branch, 'tsf/self-improve/fixture/attempt-1')
  assert.equal(await isWorktreeClean(worktreePath), true)
  const branch = git(worktreePath, ['branch', '--show-current']).trim()
  assert.equal(branch, 'tsf/self-improve/fixture/attempt-1')
})

test('createIsolatedRepairWorktree refuses to target the canonical repo path itself', async () => {
  const canonicalRepoPath = initFixtureRepo('repo-refuse')
  await assert.rejects(
    createIsolatedRepairWorktree({ canonicalRepoPath, worktreePath: canonicalRepoPath, branch: 'tsf/self-improve/fixture/x' }),
    (error) => error.code === 'TSF_SELF_IMPROVEMENT_WORKTREE_TARGETS_CANONICAL_REPO'
  )
})

// Phase 8 (adversarial security review, scenario 5): a real Windows
// junction aliasing the canonical repo under a different path string.
// resolve()-only comparison does not follow it -- proves the real-
// canonicalization defense (resolveCanonicalPath, same primitive Finding
// Phase 14 used for Cleanup V1's protected-path registry) actually fires.
test('createIsolatedRepairWorktree refuses a junction alias of the canonical repo path, not just the literal path', async () => {
  if (process.platform !== 'win32') { return } // junctions are a Windows-specific mechanism
  const canonicalRepoPath = initFixtureRepo('repo-refuse-junction')
  const aliasPath = path.join(ROOT, 'repo-refuse-junction-alias')
  symlinkSync(canonicalRepoPath, aliasPath, 'junction')
  await assert.rejects(
    createIsolatedRepairWorktree({ canonicalRepoPath, worktreePath: aliasPath, branch: 'tsf/self-improve/fixture/junction-alias' }),
    (error) => error.code === 'TSF_SELF_IMPROVEMENT_WORKTREE_TARGETS_CANONICAL_REPO'
  )
})

test('listChangedFiles/listAddedFiles reflect a real commit made inside the isolated worktree', async () => {
  const canonicalRepoPath = initFixtureRepo('repo-diff')
  const worktreePath = path.join(ROOT, 'attempt-worktree-diff')
  const worktree = await createIsolatedRepairWorktree({ canonicalRepoPath, worktreePath, branch: 'tsf/self-improve/fixture/attempt-diff' })

  writeFileSync(path.join(worktreePath, 'existing-file.mjs'), 'export const x = 2\n')
  writeFileSync(path.join(worktreePath, 'new-fixture-file.mjs'), 'export const y = 1\n')
  git(worktreePath, ['add', '.'])
  git(worktreePath, ['commit', '-q', '-m', 'a real repair commit'])

  const changed = await listChangedFiles(worktreePath, worktree.baseSha)
  assert.deepEqual(changed, ['existing-file.mjs', 'new-fixture-file.mjs'].sort())

  const added = await listAddedFiles(worktreePath, worktree.baseSha)
  assert.deepEqual(added, ['new-fixture-file.mjs'])
})

test('listCanonicalFileBasenames reads the CANONICAL repo, not a worktree', async () => {
  const canonicalRepoPath = initFixtureRepo('repo-basenames')
  const basenames = await listCanonicalFileBasenames(canonicalRepoPath)
  assert.ok(basenames.includes('existing-file.mjs'))
})

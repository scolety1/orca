// Real git operations against real, disposable temp repos -- same
// convention as http-onboarding.test.mjs's createTempRepo. Proves the
// Safe Update Manager's governed-adoption/rollback primitives against
// actual git behavior, not a mock.
import assert from 'node:assert/strict'
import test from 'node:test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'
import {
  getCurrentCommit,
  getSubtreeHash,
  isCleanWorkingTree,
  isAncestor,
  ffOnlyMerge,
  resetHardTo,
  listCommitsSince
} from '../adapters/git-identity.mjs'

function git(cwd, args) {
  execFileSync('git', args, { cwd, stdio: 'ignore' })
}

function commit(dir, file, content, message) {
  writeFileSync(path.join(dir, file), content)
  git(dir, ['add', '-A'])
  git(dir, ['commit', '-q', '-m', message])
}

// Two real repos: `origin` (the "accepted" side) and `clone`, a real clone
// that can genuinely diverge or fast-forward from it.
function setupRepoPair() {
  const origin = mkdtempSync(path.join(tmpdir(), 'tsf-git-identity-origin-'))
  git(origin, ['init', '-q'])
  git(origin, ['config', 'user.email', 'test@example.com'])
  git(origin, ['config', 'user.name', 'Test'])
  git(origin, ['symbolic-ref', 'HEAD', 'refs/heads/main'])
  commit(origin, 'README.md', '# origin\n', 'initial')
  const clone = mkdtempSync(path.join(tmpdir(), 'tsf-git-identity-clone-'))
  execFileSync('git', ['clone', '-q', origin, clone], { stdio: 'ignore' })
  git(clone, ['config', 'user.email', 'test@example.com'])
  git(clone, ['config', 'user.name', 'Test'])
  return { origin, clone }
}

const tempDirs = []
test.after(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('getCurrentCommit returns the real HEAD sha', async () => {
  const { origin } = setupRepoPair()
  tempDirs.push(origin)
  const result = await getCurrentCommit(origin)
  assert.equal(result.ok, true)
  assert.match(result.commit, /^[0-9a-f]{40}$/)
})

test('getSubtreeHash returns a real tree hash for a real subpath, and fails honestly for a path that does not exist', async () => {
  const { origin } = setupRepoPair()
  tempDirs.push(origin)
  const ok = await getSubtreeHash(origin, 'HEAD', 'README.md')
  assert.equal(ok.ok, true)
  assert.match(ok.treeHash, /^[0-9a-f]{40}$/)
  const bad = await getSubtreeHash(origin, 'HEAD', 'does-not-exist')
  assert.equal(bad.ok, false)
})

test('isCleanWorkingTree reports true for a clean repo and false once a file is modified', async () => {
  const { origin } = setupRepoPair()
  tempDirs.push(origin)
  const clean = await isCleanWorkingTree(origin)
  assert.equal(clean.ok, true)
  assert.equal(clean.clean, true)
  writeFileSync(path.join(origin, 'README.md'), '# dirty\n')
  const dirty = await isCleanWorkingTree(origin)
  assert.equal(dirty.clean, false)
})

test('isAncestor correctly distinguishes a real fast-forward candidate from a genuinely diverged one', async () => {
  const { origin, clone } = setupRepoPair()
  tempDirs.push(origin, clone)
  const before = await getCurrentCommit(origin)
  commit(origin, 'CHANGELOG.md', 'v2\n', 'a real fast-forward-able commit')
  const after = await getCurrentCommit(origin)

  // clone doesn't have the new commit yet, but origin (the same repo) does
  // -- verify ancestry within origin's own history first.
  const ff = await isAncestor(origin, before.commit, after.commit)
  assert.equal(ff.ok, true)
  assert.equal(ff.isAncestor, true)

  // Now diverge clone with its own independent commit -- neither is an
  // ancestor of the other. clone must actually have after.commit in its
  // own object database (a real `fetch`) before it can honestly answer an
  // ancestry question about it at all.
  git(clone, ['fetch', '-q', 'origin'])
  commit(clone, 'DIVERGED.md', 'diverged\n', 'a genuinely diverged commit')
  const clonedHead = await getCurrentCommit(clone)
  const notAncestor = await isAncestor(clone, after.commit, clonedHead.commit)
  assert.equal(notAncestor.ok, true)
  assert.equal(notAncestor.isAncestor, false)
})

test('ffOnlyMerge succeeds on a genuine fast-forward and refuses a diverged history rather than creating a merge commit', async () => {
  const { origin, clone } = setupRepoPair()
  tempDirs.push(origin, clone)

  // Real fast-forward: origin gets a new commit clone can cleanly adopt.
  commit(origin, 'CHANGELOG.md', 'v2\n', 'ff-able commit')
  git(clone, ['fetch', '-q', 'origin'])
  const ffResult = await ffOnlyMerge(clone, 'origin/main')
  assert.equal(ffResult.ok, true)
  const cloneHead = await getCurrentCommit(clone)
  const originHead = await getCurrentCommit(origin)
  assert.equal(
    cloneHead.commit,
    originHead.commit,
    'clone genuinely fast-forwarded to match origin'
  )

  // Now genuinely diverge and prove ff-only refuses rather than merging.
  commit(origin, 'CHANGELOG.md', 'v3-origin\n', 'origin diverges')
  commit(clone, 'LOCAL.md', 'local work\n', 'clone diverges independently')
  git(clone, ['fetch', '-q', 'origin'])
  const beforeRefused = await getCurrentCommit(clone)
  const refused = await ffOnlyMerge(clone, 'origin/main')
  assert.equal(refused.ok, false)
  assert.equal(refused.reason, 'FF_ONLY_MERGE_REFUSED')
  const afterRefused = await getCurrentCommit(clone)
  assert.equal(
    afterRefused.commit,
    beforeRefused.commit,
    'a refused ff-only merge must never leave the repo in a half-merged state'
  )
})

test('resetHardTo genuinely restores HEAD to a previously-recorded commit -- the real rollback primitive', async () => {
  const { origin } = setupRepoPair()
  tempDirs.push(origin)
  const goodCommit = await getCurrentCommit(origin)
  commit(origin, 'BAD.md', 'a bad change\n', 'a change that will be rolled back')
  const badCommit = await getCurrentCommit(origin)
  assert.notEqual(goodCommit.commit, badCommit.commit)

  const rollback = await resetHardTo(origin, goodCommit.commit)
  assert.equal(rollback.ok, true)
  const restored = await getCurrentCommit(origin)
  assert.equal(restored.commit, goodCommit.commit)
})

test("listCommitsSince finds real commits at/after a given time and excludes earlier ones -- Stage F reconciliation's evidence source", async () => {
  const { origin } = setupRepoPair()
  tempDirs.push(origin)
  // The repo's `initial` commit from setupRepoPair already exists before
  // this point. `--since` compares at second granularity, so a real gap
  // (not just a later Date.now()) is needed to reliably exclude it in a
  // fast-running test -- then two more real commits are added, and only
  // those two must be found.
  await new Promise((resolve) => setTimeout(resolve, 1100))
  const cutoff = new Date().toISOString()
  commit(origin, 'a.md', 'a\n', 'first late commit')
  commit(origin, 'b.md', 'b\n', 'second late commit')
  const result = await listCommitsSince(origin, cutoff)
  assert.equal(result.ok, true)
  assert.equal(result.commits.length, 2)
  assert.equal(result.commits[0].subject, 'first late commit')
  assert.equal(result.commits[1].subject, 'second late commit')
  assert.match(result.commits[0].sha, /^[0-9a-f]{40}$/)
})

test('listCommitsSince returns an empty list, never an error, when nothing happened since the cutoff', async () => {
  const { origin } = setupRepoPair()
  tempDirs.push(origin)
  const future = new Date(Date.now() + 60_000).toISOString()
  const result = await listCommitsSince(origin, future)
  assert.equal(result.ok, true)
  assert.deepEqual(result.commits, [])
})

// Real filesystem tests for resource-auditor-path-identity.mjs -- including
// a genuine Windows junction, created and resolved for real (not mocked),
// to prove fs.realpath actually closes the junction/reparse-point gap
// without any Orca-core dependency.
import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, mkdirSync, symlinkSync, rmSync, existsSync } from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'
import {
  resolveCanonicalPath,
  verifyWorkspacePathIdentity,
  resolveGitCommonDir,
  collectPathIdentityEvidence
} from '../server/resource-auditor-path-identity.mjs'

const ROOT = mkdtempSync(path.join(tmpdir(), 'tsf-resauditor-path-'))
test.after(() => rmSync(ROOT, { recursive: true, force: true }))

function git(cwd, args) {
  execFileSync('git', args, { cwd, stdio: 'ignore' })
}

test('resolveCanonicalPath returns null (unknown) for a path that does not exist -- never a false match', async () => {
  const result = await resolveCanonicalPath(path.join(ROOT, 'does-not-exist'))
  assert.equal(result, null)
})

test('resolveCanonicalPath returns null for an empty/absent input', async () => {
  assert.equal(await resolveCanonicalPath(''), null)
  assert.equal(await resolveCanonicalPath(undefined), null)
})

test('verifyWorkspacePathIdentity fails closed to unknown, not a match, when either side is unresolvable', async () => {
  const realDir = path.join(ROOT, 'real-target-1')
  mkdirSync(realDir)
  const missing = await verifyWorkspacePathIdentity(path.join(ROOT, 'nope'), realDir)
  assert.equal(missing.matchesExpected, null)
  assert.equal(missing.reason, 'CANDIDATE_PATH_UNRESOLVABLE')
})

test('verifyWorkspacePathIdentity confirms a match for the identical real path', async () => {
  const realDir = path.join(ROOT, 'real-target-2')
  mkdirSync(realDir)
  const result = await verifyWorkspacePathIdentity(realDir, realDir)
  assert.equal(result.matchesExpected, true)
})

test('case-different Windows path still resolves as the same real identity (case-insensitive on win32)', async (t) => {
  if (process.platform !== 'win32') {
    t.skip('case-insensitivity is a win32-specific filesystem behavior')
    return
  }
  const realDir = path.join(ROOT, 'CaseTarget')
  mkdirSync(realDir)
  const upper = realDir.toUpperCase()
  const lower = realDir.toLowerCase()
  const result = await verifyWorkspacePathIdentity(upper, lower)
  assert.equal(result.matchesExpected, true)
})

test('[junction] a real Windows junction resolves to its true target -- an alias is not mistaken for a different identity', async (t) => {
  if (process.platform !== 'win32') {
    t.skip('junctions are a win32-specific filesystem feature')
    return
  }
  const realTarget = path.join(ROOT, 'junction-real-target')
  mkdirSync(realTarget)
  const junctionPath = path.join(ROOT, 'junction-alias')
  try {
    symlinkSync(realTarget, junctionPath, 'junction')
  } catch (error) {
    t.skip(`could not create a real junction in this environment: ${error.message}`)
    return
  }
  assert.ok(existsSync(junctionPath), 'the junction itself must exist on disk')
  const resolved = await resolveCanonicalPath(junctionPath)
  const realResolved = await resolveCanonicalPath(realTarget)
  assert.equal(
    resolved,
    realResolved,
    'the junction must resolve to the SAME real path as its target, not stay a distinct alias'
  )

  // The identity check must therefore treat the junction alias as a match
  // against its real target, not flag it as an unexpected-path hazard.
  const identity = await verifyWorkspacePathIdentity(junctionPath, realTarget)
  assert.equal(identity.matchesExpected, true)
})

test('[junction] an unresolved junction (broken/dangling) fails closed to unknown, never a silent match', async (t) => {
  if (process.platform !== 'win32') {
    t.skip('junctions are a win32-specific filesystem feature')
    return
  }
  const willBeDeleted = path.join(ROOT, 'about-to-vanish')
  mkdirSync(willBeDeleted)
  const junctionPath = path.join(ROOT, 'dangling-junction')
  try {
    symlinkSync(willBeDeleted, junctionPath, 'junction')
  } catch (error) {
    t.skip(`could not create a real junction in this environment: ${error.message}`)
    return
  }
  rmSync(willBeDeleted, { recursive: true, force: true })
  const resolved = await resolveCanonicalPath(junctionPath)
  assert.equal(
    resolved,
    null,
    'a dangling junction must resolve to null (unknown), not to its now-missing target string'
  )
})

test('resolveGitCommonDir reads the real, shared .git directory for an actual repository', async () => {
  const repoDir = path.join(ROOT, 'real-repo')
  mkdirSync(repoDir)
  git(repoDir, ['init', '-q'])
  git(repoDir, ['config', 'user.email', 'a@b.com'])
  git(repoDir, ['config', 'user.name', 'A'])
  const commonDir = await resolveGitCommonDir(repoDir)
  assert.ok(commonDir, 'a real repository must resolve a real git-common-dir')
  const expectedGitDir = await resolveCanonicalPath(path.join(repoDir, '.git'))
  assert.equal(commonDir, expectedGitDir)
})

test('resolveGitCommonDir returns null (not a guess) for a non-repository directory', async () => {
  const plainDir = path.join(ROOT, 'not-a-repo')
  mkdirSync(plainDir)
  assert.equal(await resolveGitCommonDir(plainDir), null)
})

test('collectPathIdentityEvidence composes matchesExpected + containment + git-common-dir into the exact shape the classifier expects', async () => {
  const repoDir = path.join(ROOT, 'composed-repo')
  mkdirSync(repoDir)
  git(repoDir, ['init', '-q'])
  git(repoDir, ['config', 'user.email', 'a@b.com'])
  git(repoDir, ['config', 'user.name', 'A'])
  const expectedCommonDir = await resolveGitCommonDir(repoDir)

  const evidence = await collectPathIdentityEvidence({
    candidatePath: repoDir,
    expectedPath: repoDir,
    registeredWorktreePaths: [],
    expectedGitCommonDir: expectedCommonDir
  })
  assert.equal(evidence.matchesExpected, true)
  assert.equal(
    evidence.containsOtherRegisteredWorktree,
    null,
    'no other registered paths supplied -- must be unknown, not false'
  )
  assert.equal(evidence.gitCommonDirMatches, true)
  assert.ok(evidence.observedAt)
})

test('collectPathIdentityEvidence detects real nested containment against a registered path list', async () => {
  const parent = path.join(ROOT, 'containment-parent')
  const nested = path.join(parent, 'nested-child')
  mkdirSync(nested, { recursive: true })
  const evidence = await collectPathIdentityEvidence({
    candidatePath: parent,
    expectedPath: parent,
    registeredWorktreePaths: [nested]
  })
  assert.equal(evidence.containsOtherRegisteredWorktree, true)
})

test('collectPathIdentityEvidence gitCommonDirMatches is UNKNOWN-shaped (null) when the observed dir cannot be resolved', async () => {
  const notARepo = path.join(ROOT, 'not-a-repo-2')
  mkdirSync(notARepo)
  const evidence = await collectPathIdentityEvidence({
    candidatePath: notARepo,
    expectedPath: notARepo,
    expectedGitCommonDir: path.join(ROOT, 'some-expected-common-dir')
  })
  assert.equal(evidence.gitCommonDirMatches, null)
})

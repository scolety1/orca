// Real verifier mechanism: real git diff evidence (disposable fixture
// worktree), real reproduction/regression subprocess re-execution, and the
// real independence check against the committed routing config -- no
// fakes for the mechanism itself, only for the finding/envelope inputs.
import assert from 'node:assert/strict'
import test from 'node:test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { isPathContainedInDirectory, runIndependentVerification } from '../server/self-improvement-verifier-dispatch.mjs'
import { createIsolatedRepairWorktree, snapshotSiblingWorktreeStatuses } from '../server/self-improvement-worktree.mjs'

const ROOT = mkdtempSync(path.join(tmpdir(), 'tsf-selfimprove-verifier-'))
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

const baseFinding = {
  sourceDetector: 'RUNTIME_ASSERTION',
  affectedSurface: 'tsf/domain/fixture.mjs',
  candidateFixScope: { kind: 'BOUNDED_CODE_DEFECT', filesHint: ['fixture.mjs'] }
}
const baseEnvelope = { allowedScope: ['fixture.mjs'], forbiddenPathPrefixes: ['tsf/server/cleanup-owner-authorization-gate.mjs'] }

test('a real, genuinely passing worker diff (reproduction fixed, regression test passes, in-scope, no forbidden touch) -> VERIFIED_PASS', async () => {
  const canonicalRepoPath = initFixtureRepo('repo-verify-pass')
  const worktreePath = path.join(ROOT, 'attempt-verify-pass')
  const worktree = await createIsolatedRepairWorktree({ canonicalRepoPath, worktreePath, branch: 'tsf/self-improve/fixture/attempt-pass' })
  writeFileSync(path.join(worktreePath, 'fixture.mjs'), 'export const x = 2\n')
  writeFileSync(path.join(worktreePath, 'fixture.test.mjs'), "import test from 'node:test'\nimport assert from 'node:assert/strict'\ntest('x', () => assert.equal(1, 1))\n")
  git(worktreePath, ['add', '.'])
  git(worktreePath, ['commit', '-q', '-m', 'real fix'])

  const finding = { ...baseFinding, reproduction: { command: 'node -e "process.exit(0)"' }, candidateFixScope: { kind: 'BOUNDED_CODE_DEFECT', filesHint: ['fixture.mjs', 'fixture.test.mjs'] } }
  const result = await runIndependentVerification({
    finding,
    envelope: { ...baseEnvelope, allowedScope: ['fixture.mjs', 'fixture.test.mjs'] },
    worktreePath,
    branch: worktree.branch,
    baseSha: worktree.baseSha,
    canonicalRepoPath,
    workerProviderId: 'openai',
    deps: {}
  })
  assert.equal(result.verdict, 'VERIFIED_PASS')
  assert.deepEqual(result.reasons, [])
})

test('the forbidden-surface check genuinely catches a real worker diff that touches a forbidden path', async () => {
  const canonicalRepoPath = initFixtureRepo('repo-verify-forbidden')
  const worktreePath = path.join(ROOT, 'attempt-verify-forbidden')
  const worktree = await createIsolatedRepairWorktree({ canonicalRepoPath, worktreePath, branch: 'tsf/self-improve/fixture/attempt-forbidden' })
  // The forbidden path itself, genuinely touched: the nested directory
  // structure matches the envelope's forbiddenPathPrefixes exactly.
  const forbiddenDir = path.join(worktreePath, 'tsf', 'server')
  mkdirSync(forbiddenDir, { recursive: true })
  writeFileSync(path.join(forbiddenDir, 'cleanup-owner-authorization-gate.mjs'), '// tampered\n')
  git(worktreePath, ['add', '.'])
  git(worktreePath, ['commit', '-q', '-m', 'a worker that touched a forbidden surface'])

  const finding = { ...baseFinding, reproduction: { command: 'node -e "process.exit(0)"' } }
  const result = await runIndependentVerification({
    finding,
    envelope: baseEnvelope,
    worktreePath,
    branch: worktree.branch,
    baseSha: worktree.baseSha,
    canonicalRepoPath,
    workerProviderId: 'openai',
    deps: {}
  })
  assert.equal(result.verdict, 'VERIFIED_FAIL')
  assert.ok(result.reasons.some((r) => r.startsWith('FORBIDDEN_SURFACE_TOUCHED')))
  assert.equal(result.detail.forbiddenSurfaceCheck.pass, false)
})

test('reproduction still genuinely fails (real exit 1) -> VERIFIED_FAIL with REPRODUCTION_STILL_FAILS', async () => {
  const canonicalRepoPath = initFixtureRepo('repo-verify-repro-fail')
  const worktreePath = path.join(ROOT, 'attempt-verify-repro-fail')
  const worktree = await createIsolatedRepairWorktree({ canonicalRepoPath, worktreePath, branch: 'tsf/self-improve/fixture/attempt-repro-fail' })
  writeFileSync(path.join(worktreePath, 'fixture.mjs'), 'export const x = 2\n')
  git(worktreePath, ['add', '.'])
  git(worktreePath, ['commit', '-q', '-m', 'an incomplete fix'])

  const finding = { ...baseFinding, reproduction: { command: 'node -e "process.exit(1)"' } }
  const result = await runIndependentVerification({
    finding,
    envelope: baseEnvelope,
    worktreePath,
    branch: worktree.branch,
    baseSha: worktree.baseSha,
    canonicalRepoPath,
    workerProviderId: 'openai',
    deps: {}
  })
  assert.equal(result.verdict, 'VERIFIED_FAIL')
  assert.ok(result.reasons.includes('REPRODUCTION_STILL_FAILS'))
})

test('the verifier independence check is real: it requests/uses a genuinely different provider than the worker when the routing config allows it', async () => {
  const canonicalRepoPath = initFixtureRepo('repo-verify-independence')
  const worktreePath = path.join(ROOT, 'attempt-verify-independence')
  const worktree = await createIsolatedRepairWorktree({ canonicalRepoPath, worktreePath, branch: 'tsf/self-improve/fixture/attempt-independence' })
  writeFileSync(path.join(worktreePath, 'fixture.mjs'), 'export const x = 2\n')
  git(worktreePath, ['add', '.'])
  git(worktreePath, ['commit', '-q', '-m', 'real fix'])

  const finding = { ...baseFinding, reproduction: { command: 'node -e "process.exit(0)"' } }
  const result = await runIndependentVerification({
    finding,
    envelope: baseEnvelope,
    worktreePath,
    branch: worktree.branch,
    baseSha: worktree.baseSha,
    canonicalRepoPath,
    workerProviderId: 'openai', // WORKER_BALANCED's real provider
    deps: {}
  })
  assert.equal(result.detail.independence.divergent, true)
  assert.equal(result.detail.independence.resolution.requested.providerId, 'anthropic')
})

// Phase 8 (adversarial security review, scenario 3/4): a real, previously-
// exploitable gap. candidateFixScope.filesHint is detector-supplied,
// untrusted text, but was concatenated into a `node --test "${p}"` SHELL
// command string -- a hint containing an embedded quote plus a shell
// metacharacter escaped that quoting and ran an arbitrary command on the
// HOST, entirely outside the isolated worktree, regardless of the eventual
// verdict. Fixed by running regression targets via argv (runRegressionTests,
// never shell:true). Proves the fix: the malicious hint must NOT be able to
// create a file outside the worktree during verification.
test('a shell-metacharacter-laden filesHint entry cannot escape into host command execution during verification', async () => {
  const canonicalRepoPath = initFixtureRepo('repo-verify-injection')
  const worktreePath = path.join(ROOT, 'attempt-verify-injection')
  const worktree = await createIsolatedRepairWorktree({ canonicalRepoPath, worktreePath, branch: 'tsf/self-improve/fixture/attempt-injection' })
  writeFileSync(path.join(worktreePath, 'fixture.mjs'), 'export const x = 2\n')
  git(worktreePath, ['add', '.'])
  git(worktreePath, ['commit', '-q', '-m', 'a worker diff'])

  const markerPath = path.join(ROOT, 'PWNED_MARKER.txt')
  const maliciousHint = `x" & echo pwned > "${markerPath}" & rem .test.mjs`
  const finding = {
    ...baseFinding,
    reproduction: { command: 'node -e "process.exit(0)"' },
    candidateFixScope: { kind: 'BOUNDED_CODE_DEFECT', filesHint: [maliciousHint] }
  }
  const result = await runIndependentVerification({
    finding,
    envelope: { ...baseEnvelope, allowedScope: [maliciousHint] },
    worktreePath,
    branch: worktree.branch,
    baseSha: worktree.baseSha,
    canonicalRepoPath,
    workerProviderId: 'openai',
    deps: {}
  })
  assert.equal(existsSync(markerPath), false, 'the malicious hint must never reach a real shell -- no marker file should be created outside the worktree')
  assert.equal(result.detail.regressionCheck.passed, false, 'the bogus target should just fail to resolve as a real test, not execute as a command')
})

// Scenario 4 (path traversal): a filesHint entry using `../` to name a file
// outside the worktree must never be treated as a real regression target.
test('a filesHint entry that traverses outside the worktree is rejected, not treated as a real regression target', async () => {
  const canonicalRepoPath = initFixtureRepo('repo-verify-traversal')
  const worktreePath = path.join(ROOT, 'attempt-verify-traversal')
  const worktree = await createIsolatedRepairWorktree({ canonicalRepoPath, worktreePath, branch: 'tsf/self-improve/fixture/attempt-traversal' })
  writeFileSync(path.join(worktreePath, 'fixture.mjs'), 'export const x = 2\n')
  git(worktreePath, ['add', '.'])
  git(worktreePath, ['commit', '-q', '-m', 'a worker diff'])

  // A real file OUTSIDE the worktree that, if ever executed as a "test",
  // would prove containment was NOT enforced (it would report VERIFIED_PASS
  // via a fake, out-of-scope regression run).
  const outsideTestPath = path.join(ROOT, 'outside.test.mjs')
  writeFileSync(outsideTestPath, "import test from 'node:test'\ntest('always passes', () => {})\n")
  const traversalHint = '../../outside.test.mjs'

  const finding = { ...baseFinding, reproduction: { command: 'node -e "process.exit(0)"' }, candidateFixScope: { kind: 'BOUNDED_CODE_DEFECT', filesHint: [traversalHint] } }
  const result = await runIndependentVerification({
    finding,
    envelope: { ...baseEnvelope, allowedScope: [traversalHint] },
    worktreePath,
    branch: worktree.branch,
    baseSha: worktree.baseSha,
    canonicalRepoPath,
    workerProviderId: 'openai',
    deps: {}
  })
  assert.equal(result.detail.regressionCheck.targets.includes(traversalHint), false, 'the traversal hint must never be selected as a real regression target')
  assert.equal(result.reasons.includes('NO_TARGETED_REGRESSION_TEST_RESOLVABLE'), true, 'with the only hint rejected, this fails closed rather than silently passing')
})

// Scenario 11: a worker that reaches OUTSIDE its own isolated worktree into
// a SIBLING worktree of the same repository (e.g. dataset-research-engine-v0)
// via an ordinary filesystem write -- something the worker's own `git diff`
// can never see -- must still be caught by the independent sibling-
// worktree-status check.
test('a worker that writes into a SIBLING worktree (not its own) is caught by the sibling-worktree-untouched check', async () => {
  const canonicalRepoPath = initFixtureRepo('repo-verify-sibling')
  const siblingWorktreePath = path.join(ROOT, 'sibling-worktree-dataset-research')
  git(canonicalRepoPath, ['worktree', 'add', '-q', '--detach', siblingWorktreePath, 'HEAD'])

  const worktreePath = path.join(ROOT, 'attempt-verify-sibling')
  const worktree = await createIsolatedRepairWorktree({ canonicalRepoPath, worktreePath, branch: 'tsf/self-improve/fixture/attempt-sibling' })

  const siblingStatusesBefore = await snapshotSiblingWorktreeStatuses(canonicalRepoPath, [canonicalRepoPath, worktreePath])
  assert.equal(Object.keys(siblingStatusesBefore).length, 1, 'the sibling worktree (and only the sibling) must be discovered via git worktree list')

  // A committed, in-scope, forbidden-clean diff inside the repair worktree
  // itself -- otherwise unrelated checks would also fail and mask this one.
  writeFileSync(path.join(worktreePath, 'fixture.mjs'), 'export const x = 2\n')
  git(worktreePath, ['add', '.'])
  git(worktreePath, ['commit', '-q', '-m', 'an in-scope fix'])

  // The "attack": modifies a file in the SIBLING worktree, entirely outside
  // the repair worktree's own tracked tree -- simulates a worker (or an
  // injected instruction) reaching out via a relative path.
  writeFileSync(path.join(siblingWorktreePath, 'existing-file.mjs'), 'export const x = "tampered"\n')

  const finding = { ...baseFinding, reproduction: { command: 'node -e "process.exit(0)"' }, candidateFixScope: { kind: 'BOUNDED_CODE_DEFECT', filesHint: ['fixture.mjs'] } }
  const result = await runIndependentVerification({
    finding,
    envelope: { ...baseEnvelope, allowedScope: ['fixture.mjs'] },
    worktreePath,
    branch: worktree.branch,
    baseSha: worktree.baseSha,
    canonicalRepoPath,
    workerProviderId: 'openai',
    siblingStatusesBefore,
    deps: {}
  })
  assert.equal(result.verdict, 'VERIFIED_FAIL')
  assert.ok(result.reasons.some((r) => r.startsWith('SIBLING_WORKTREE_TOUCHED')), `expected a SIBLING_WORKTREE_TOUCHED reason, got: ${result.reasons.join(', ')}`)
  assert.equal(result.detail.siblingWorktreeCheck.pass, false)
})

test('a genuinely untouched sibling worktree does not fail the check', async () => {
  const canonicalRepoPath = initFixtureRepo('repo-verify-sibling-clean')
  const siblingWorktreePath = path.join(ROOT, 'sibling-worktree-clean')
  git(canonicalRepoPath, ['worktree', 'add', '-q', '--detach', siblingWorktreePath, 'HEAD'])

  const worktreePath = path.join(ROOT, 'attempt-verify-sibling-clean')
  const worktree = await createIsolatedRepairWorktree({ canonicalRepoPath, worktreePath, branch: 'tsf/self-improve/fixture/attempt-sibling-clean' })
  const siblingStatusesBefore = await snapshotSiblingWorktreeStatuses(canonicalRepoPath, [canonicalRepoPath, worktreePath])

  writeFileSync(path.join(worktreePath, 'fixture.mjs'), 'export const x = 2\n')
  git(worktreePath, ['add', '.'])
  git(worktreePath, ['commit', '-q', '-m', 'an in-scope fix, sibling left alone'])

  const finding = { ...baseFinding, reproduction: { command: 'node -e "process.exit(0)"' }, candidateFixScope: { kind: 'BOUNDED_CODE_DEFECT', filesHint: ['fixture.mjs'] } }
  const result = await runIndependentVerification({
    finding,
    envelope: { ...baseEnvelope, allowedScope: ['fixture.mjs'] },
    worktreePath,
    branch: worktree.branch,
    baseSha: worktree.baseSha,
    canonicalRepoPath,
    workerProviderId: 'openai',
    siblingStatusesBefore,
    deps: {}
  })
  assert.equal(result.detail.siblingWorktreeCheck.pass, true)
  assert.equal(result.reasons.some((r) => r.startsWith('SIBLING_WORKTREE')), false)
})

test('isPathContainedInDirectory: real containment boundary', () => {
  const dir = path.join(ROOT, 'containment-check')
  mkdirSync(dir, { recursive: true })
  assert.equal(isPathContainedInDirectory(dir, 'a.test.mjs'), true)
  assert.equal(isPathContainedInDirectory(dir, 'sub/a.test.mjs'), true)
  assert.equal(isPathContainedInDirectory(dir, '../outside.test.mjs'), false)
  assert.equal(isPathContainedInDirectory(dir, '../../../../etc/passwd'), false)
})

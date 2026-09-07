// Real verifier mechanism: real git diff evidence (disposable fixture
// worktree), real reproduction/regression subprocess re-execution, and the
// real independence check against the committed routing config -- no
// fakes for the mechanism itself, only for the finding/envelope inputs.
import assert from 'node:assert/strict'
import test from 'node:test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { runIndependentVerification } from '../server/self-improvement-verifier-dispatch.mjs'
import { createIsolatedRepairWorktree } from '../server/self-improvement-worktree.mjs'

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

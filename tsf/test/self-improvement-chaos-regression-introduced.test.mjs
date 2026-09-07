// Wave D Phase 10, chaos scenario 7: a repair "fixes" the named reproduction
// but breaks a DIFFERENT real regression test -- the real verifier's
// regression check must catch this (REGRESSION_TESTS_FAILED), never
// silently pass. Real fixture repo, real runIndependentVerification, no
// fakes for the mechanism itself (mirrors self-improvement-verifier-
// dispatch.test.mjs's own established real-fixture-repo pattern).
import assert from 'node:assert/strict'
import test from 'node:test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { runIndependentVerification } from '../server/self-improvement-verifier-dispatch.mjs'
import { createIsolatedRepairWorktree } from '../server/self-improvement-worktree.mjs'

const ROOT = mkdtempSync(path.join(tmpdir(), 'tsf-selfimprove-chaos-regression-'))
test.after(() => rmSync(ROOT, { recursive: true, force: true }))

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}

test('a repair that fixes the named defect but breaks a DIFFERENT existing test -> VERIFIED_FAIL / REGRESSION_TESTS_FAILED', async () => {
  const canonicalRepoPath = path.join(ROOT, 'repo-regression')
  git(ROOT, ['init', '-q', '-b', 'main', canonicalRepoPath])
  git(canonicalRepoPath, ['config', 'user.email', 'fixture@example.com'])
  git(canonicalRepoPath, ['config', 'user.name', 'Fixture'])
  // The real defect target.
  writeFileSync(path.join(canonicalRepoPath, 'target.mjs'), 'export function target() { return 1 }\n')
  writeFileSync(
    path.join(canonicalRepoPath, 'target.test.mjs'),
    "import test from 'node:test'\nimport assert from 'node:assert/strict'\nimport { target } from './target.mjs'\ntest('target returns 2', () => assert.equal(target(), 2))\n"
  )
  // A COMPLETELY SEPARATE, already-passing piece of the codebase the repair
  // has no business touching.
  writeFileSync(path.join(canonicalRepoPath, 'sibling.mjs'), 'export function sibling() { return 42 }\n')
  writeFileSync(
    path.join(canonicalRepoPath, 'sibling.test.mjs'),
    "import test from 'node:test'\nimport assert from 'node:assert/strict'\nimport { sibling } from './sibling.mjs'\ntest('sibling returns 42', () => assert.equal(sibling(), 42))\n"
  )
  git(canonicalRepoPath, ['add', '.'])
  git(canonicalRepoPath, ['commit', '-q', '-m', 'initial'])

  const worktreePath = path.join(ROOT, 'attempt-regression')
  const worktree = await createIsolatedRepairWorktree({ canonicalRepoPath, worktreePath, branch: 'tsf/self-improve/fixture/attempt-regression' })
  // Fixes target.mjs (the named defect)... but also breaks sibling.mjs, an
  // unrelated real regression -- exactly the "fixed the wrong thing's
  // symptom while breaking something else" failure mode.
  writeFileSync(path.join(worktreePath, 'target.mjs'), 'export function target() { return 2 }\n')
  writeFileSync(path.join(worktreePath, 'sibling.mjs'), 'export function sibling() { return "broken" }\n')
  git(worktreePath, ['add', '.'])
  git(worktreePath, ['commit', '-q', '-m', 'fixes target.mjs, silently breaks sibling.mjs'])

  const finding = {
    sourceDetector: 'RUNTIME_ASSERTION',
    affectedSurface: 'target.mjs#target',
    reproduction: { command: 'node -e "process.exit(0)"' }, // the NAMED defect genuinely now passes
    candidateFixScope: { kind: 'BOUNDED_CODE_DEFECT', filesHint: ['target.test.mjs', 'sibling.test.mjs'] }
  }
  const envelope = { allowedScope: ['target.mjs', 'target.test.mjs'], forbiddenPathPrefixes: [] }

  const result = await runIndependentVerification({
    finding,
    envelope,
    worktreePath,
    branch: worktree.branch,
    baseSha: worktree.baseSha,
    canonicalRepoPath,
    workerProviderId: 'openai',
    deps: {}
  })

  assert.equal(result.verdict, 'VERIFIED_FAIL')
  assert.ok(result.reasons.includes('REGRESSION_TESTS_FAILED'), `expected REGRESSION_TESTS_FAILED, got: ${result.reasons.join(', ')}`)
  assert.equal(result.detail.reproductionCheck.passed, true, 'the named defect really was fixed -- this is specifically a NEW regression, not a failure to fix the original')
  assert.equal(result.detail.regressionCheck.passed, false)
})

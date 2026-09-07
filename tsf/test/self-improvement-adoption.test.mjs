// Real, gated adoption proof. GATE CLOSED (real process.env/real default
// flag path -- the only state that exists in production today): must
// block, no git I/O attempted, finding stays READY_FOR_ADOPTION. GATE OPEN
// (a FABRICATED env object + FABRICATED flag file, never the real global
// signal): a real fast-forward merge against a disposable fixture repo
// pair (mirrors cleanup-git-worktree-inventory.test.mjs's own fixture
// pattern) -- never C:\TSF_ORCA.
import assert from 'node:assert/strict'
import test from 'node:test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const ROOT = mkdtempSync(path.join(tmpdir(), 'tsf-selfimprove-adoption-'))
// Wave D: attemptRepairAdoption now records a real ADOPTION_DECISION
// receipt -- isolates this suite's state file from the shared default
// (same convention every other self-improvement test file already uses)
// so it never collides with a concurrently-running suite. Set BEFORE the
// dynamic imports below -- data-store.mjs captures TSF_UI_STATE_FILE into
// a module-level const at import time, so a static top-of-file import
// here would be too late.
process.env.TSF_UI_STATE_FILE = path.join(ROOT, 'operator-state.json')
test.after(() => rmSync(ROOT, { recursive: true, force: true }))

const { attemptRepairAdoption } = await import('../server/self-improvement-adoption.mjs')
const { createIsolatedRepairWorktree } = await import('../server/self-improvement-worktree.mjs')
const { ADOPTION_AUTHORIZATION_MARKER, defaultAdoptionAuthorizationFlagPath } = await import('../server/self-improvement-adoption-authorization-gate.mjs')
const { readReceipts } = await import('../server/self-improvement-receipt-store.mjs')

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

const finding = { status: 'READY_FOR_ADOPTION', findingId: 'finding:fixture' }

test('GATE CLOSED (real process.env, real default flag path): adoption is blocked, no repo paths needed at all', async () => {
  assert.equal(process.env.TSF_SELF_IMPROVEMENT_ADOPTION_AUTHORIZATION, undefined)
  assert.equal(existsSync(defaultAdoptionAuthorizationFlagPath()), false)
  const result = await attemptRepairAdoption({
    finding,
    missionId: 'mission:selfimprove:fixture',
    worktreePath: 'this-path-does-not-exist',
    branch: 'does-not-matter',
    canonicalRepoPath: 'this-path-does-not-exist-either',
    verifierVerdict: 'VERIFIED_PASS',
    deps: {}
  })
  assert.equal(result.adopted, false)
  assert.equal(result.reason, 'GATE_CLOSED')
  assert.equal(result.gateState.open, false)

  // Wave D real gap: ADOPTION_DECISION existed in the receipt-chain enum
  // since Wave B but no code path ever wrote one, for ANY outcome.
  const receipts = readReceipts('mission:selfimprove:fixture')
  assert.equal(receipts.length, 1)
  assert.equal(receipts[0].kind, 'ADOPTION_DECISION')
  assert.equal(receipts[0].detail.reason, 'GATE_CLOSED')
})

test('GATE OPEN (fabricated env + fabricated flag file only): real ff-only merge against a disposable fixture repo pair', async () => {
  const canonicalRepoPath = initFixtureRepo('canonical-fixture')
  const worktreePath = path.join(ROOT, 'candidate-worktree')
  const candidate = await createIsolatedRepairWorktree({ canonicalRepoPath, worktreePath, branch: 'tsf/self-improve/fixture/attempt-1' })
  writeFileSync(path.join(worktreePath, 'existing-file.mjs'), 'export const x = 2\n')
  git(worktreePath, ['add', '.'])
  git(worktreePath, ['commit', '-q', '-m', 'a real, verified fix'])

  const fakeFlagPath = path.join(ROOT, 'FAKE_ADOPTION.flag')
  writeFileSync(fakeFlagPath, ADOPTION_AUTHORIZATION_MARKER, 'utf8')
  const fakeEnv = { TSF_SELF_IMPROVEMENT_ADOPTION_AUTHORIZATION: ADOPTION_AUTHORIZATION_MARKER }

  const result = await attemptRepairAdoption({
    finding,
    missionId: 'mission:selfimprove:fixture',
    worktreePath,
    branch: candidate.branch,
    canonicalRepoPath,
    verifierVerdict: 'VERIFIED_PASS',
    deps: { env: fakeEnv, flagFilePath: fakeFlagPath }
  })

  assert.equal(result.adopted, true)
  assert.equal(result.gateState.open, true)
  const canonicalHeadAfter = git(canonicalRepoPath, ['rev-parse', 'HEAD']).trim()
  assert.equal(canonicalHeadAfter, result.adoptedHead)
  assert.equal(git(canonicalRepoPath, ['log', '-1', '--format=%s']).trim(), 'a real, verified fix')
})

test('GATE OPEN but verifierVerdict is not VERIFIED_PASS: readiness blocks it, no merge attempted', async () => {
  const canonicalRepoPath = initFixtureRepo('canonical-fixture-blocked')
  const worktreePath = path.join(ROOT, 'candidate-worktree-blocked')
  const candidate = await createIsolatedRepairWorktree({ canonicalRepoPath, worktreePath, branch: 'tsf/self-improve/fixture/attempt-blocked' })

  const fakeFlagPath = path.join(ROOT, 'FAKE_ADOPTION_2.flag')
  writeFileSync(fakeFlagPath, ADOPTION_AUTHORIZATION_MARKER, 'utf8')
  const fakeEnv = { TSF_SELF_IMPROVEMENT_ADOPTION_AUTHORIZATION: ADOPTION_AUTHORIZATION_MARKER }

  const result = await attemptRepairAdoption({
    finding,
    missionId: 'mission:selfimprove:fixture-blocked',
    worktreePath,
    branch: candidate.branch,
    canonicalRepoPath,
    verifierVerdict: 'VERIFIED_FAIL',
    deps: { env: fakeEnv, flagFilePath: fakeFlagPath }
  })
  assert.equal(result.adopted, false)
  assert.equal(result.reason, 'NOT_READY')
  assert.ok(result.blockers.some((b) => b.includes('VERIFIED_PASS')))
})

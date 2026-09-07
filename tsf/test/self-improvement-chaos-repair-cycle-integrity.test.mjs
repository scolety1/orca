// Wave D Phase 10, chaos scenarios 2/3/5/8: real runRepairAttempt
// (integration level, not just the unit-level verifier/dispatch checks
// already proven elsewhere) against REAL fixture git repos -- proves the
// full cycle never silently treats a crashed worker, a crashed verifier, a
// blocked-by-resource-pressure dispatch, or a worker's own false "success"
// report as a genuine pass.
import assert from 'node:assert/strict'
import test from 'node:test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const ROOT = mkdtempSync(path.join(tmpdir(), 'tsf-selfimprove-chaos-repair-cycle-'))
const STATE_FILE = path.join(ROOT, 'operator-state.json')
process.env.TSF_UI_STATE_FILE = STATE_FILE // set BEFORE any dynamic import below -- data-store.mjs captures this at import time
test.after(() => rmSync(ROOT, { recursive: true, force: true }))

const { createFinding, transitionFinding } = await import('../domain/self-improvement-finding.mjs')
const { applyAutofixEligibility } = await import('../domain/self-improvement-autofix-eligibility.mjs')
const { originateRepairMission } = await import('../server/self-improvement-mission-origination.mjs')
const { runRepairAttempt } = await import('../server/self-improvement-repair-cycle.mjs')
const { readFinding } = await import('../server/self-improvement-finding-store.mjs')
const { deriveRepairAttemptBranch, deriveRepairAttemptWorktreePath } = await import('../server/self-improvement-worker-dispatch.mjs')
const { createIsolatedRepairWorktree } = await import('../server/self-improvement-worktree.mjs')

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}

function initFixtureRepo(name) {
  const dir = path.join(ROOT, name)
  git(ROOT, ['init', '-q', '-b', 'main', dir])
  git(dir, ['config', 'user.email', 'fixture@example.com'])
  git(dir, ['config', 'user.name', 'Fixture'])
  writeFileSync(path.join(dir, 'fixture.mjs'), 'export const x = 1\n')
  git(dir, ['add', '.'])
  git(dir, ['commit', '-q', '-m', 'initial'])
  return dir
}

const GB = 1024 ** 3
const fakeHealthyMemory = () => ({ totalBytes: 16 * GB, freeBytes: 8 * GB, availableBytes: 8 * GB, usedPercent: 50 })
const fakeCriticalMemory = () => ({ totalBytes: 16 * GB, freeBytes: 0.1 * GB, availableBytes: 0.1 * GB, usedPercent: 99 })

async function setUp(name) {
  const canonicalRepoPath = initFixtureRepo(name)
  let finding = createFinding(
    {
      sourceDetector: 'RUNTIME_ASSERTION',
      severity: 'P1',
      evidence: { x: 1 },
      reproduction: { command: 'node -e "process.exit(1)"' },
      affectedSurface: `${name}#fixture`, // distinct per scenario -> distinct content-addressed findingId, no collisions in the shared state file
      confidence: 0.95,
      verificationMethod: 'RECHECK',
      candidateFixScope: { kind: 'BOUNDED_CODE_DEFECT', summary: 'fix', filesHint: ['fixture.mjs'] }
    },
    () => new Date()
  )
  finding = transitionFinding(finding, 'VERIFIED', { reason: 'RECHECKED' }, () => new Date())
  finding = applyAutofixEligibility(finding, () => new Date())

  const originationResult = await originateRepairMission(finding, {
    canonicalRepoPath,
    clock: () => new Date(),
    deps: { lifecycleDeps: { collectHostMemoryEvidence: fakeHealthyMemory } }
  })
  return { canonicalRepoPath, finding, missionId: originationResult.missionId }
}

test('scenario 2: worker crashes after edit -- the worktree is real but gone before verification -- never a silent success', async () => {
  const { canonicalRepoPath, finding, missionId } = await setUp('repo-worker-crash')
  const worktreePath = deriveRepairAttemptWorktreePath({ canonicalRepoPath, missionId, attemptNumber: 1 })
  await createIsolatedRepairWorktree({ canonicalRepoPath, worktreePath, branch: deriveRepairAttemptBranch({ missionId, attemptNumber: 1 }) })
  writeFileSync(path.join(worktreePath, 'fixture.mjs'), 'export const x = 2\n')
  git(worktreePath, ['add', '.'])
  git(worktreePath, ['commit', '-q', '-m', 'worker edit before crash'])
  // Real worker-gone simulation: the worktree directory itself vanishes
  // (e.g. a killed worker's sandbox was torn down, a disk issue, ...).
  git(canonicalRepoPath, ['worktree', 'remove', '--force', worktreePath])
  assert.equal(existsSync(worktreePath), false)

  const fakeDispatch = async () => ({ workerId: 'crashed-worker', providerId: 'openai', agentId: 'codex', exitCode: 0, timedOut: false })
  await assert.rejects(
    runRepairAttempt({ finding, missionId, canonicalRepoPath, clock: () => new Date(), deps: { dispatchWorker: fakeDispatch, lifecycleDeps: { collectHostMemoryEvidence: fakeHealthyMemory } } }),
    'a genuinely missing/gone worktree must throw, never resolve as a verified pass'
  )
})

test('scenario 3: verifier crashes (throws) -- finding never silently transitions as verified', async () => {
  const { canonicalRepoPath, finding, missionId } = await setUp('repo-verifier-crash')
  const worktreePath = deriveRepairAttemptWorktreePath({ canonicalRepoPath, missionId, attemptNumber: 1 })
  await createIsolatedRepairWorktree({ canonicalRepoPath, worktreePath, branch: deriveRepairAttemptBranch({ missionId, attemptNumber: 1 }) })
  writeFileSync(path.join(worktreePath, 'fixture.mjs'), 'export const x = 2\n')
  git(worktreePath, ['add', '.'])
  git(worktreePath, ['commit', '-q', '-m', 'a real worker commit, then the verifier itself crashes'])

  const fakeDispatch = async () => ({ workerId: 'w1', providerId: 'openai', agentId: 'codex', exitCode: 0, timedOut: false })
  const throwingVerifier = async () => { throw new Error('verifier process crashed') }

  await assert.rejects(
    runRepairAttempt({
      finding,
      missionId,
      canonicalRepoPath,
      clock: () => new Date(),
      deps: { dispatchWorker: fakeDispatch, runIndependentVerification: throwingVerifier, lifecycleDeps: { collectHostMemoryEvidence: fakeHealthyMemory } }
    }),
    /verifier process crashed/
  )
  assert.equal(readFinding(finding.findingId).status, 'FIX_IN_PROGRESS', 'a crashed verifier must never advance the finding past FIX_IN_PROGRESS')
})

test('scenario 5: resource pressure turns CRITICAL between origination and dispatch -- no worker dispatch attempted mid-cycle', async () => {
  const { canonicalRepoPath, finding, missionId } = await setUp('repo-pressure-mid-cycle')
  await assert.rejects(
    runRepairAttempt({
      finding,
      missionId,
      canonicalRepoPath,
      clock: () => new Date(),
      deps: { lifecycleDeps: { collectHostMemoryEvidence: fakeHealthyMemory }, workerDeps: { collectHostMemoryEvidence: fakeCriticalMemory } }
    }),
    (error) => error.code === 'TSF_SELF_IMPROVEMENT_DISPATCH_BLOCKED_BY_RESOURCE_PRESSURE'
  )
  // Blocked so early that dispatch never even starts -- the finding must
  // stay at its pre-attempt status, never falsely advance to FIX_IN_PROGRESS.
  assert.equal(readFinding(finding.findingId).status, 'FIX_MISSION_CREATED')
})

test('scenario 8: worker self-reports success but the real reproduction still fails -- REPRODUCTION_STILL_FAILS, never a false READY_FOR_ADOPTION', async () => {
  const { canonicalRepoPath, finding, missionId } = await setUp('repo-repro-still-fails')
  const worktreePath = deriveRepairAttemptWorktreePath({ canonicalRepoPath, missionId, attemptNumber: 1 })
  const branch = deriveRepairAttemptBranch({ missionId, attemptNumber: 1 })
  await createIsolatedRepairWorktree({ canonicalRepoPath, worktreePath, branch })
  // A commit that changes something irrelevant, NOT the real defect --
  // the worker's own exitCode: 0 below is a false self-report.
  writeFileSync(path.join(worktreePath, 'unrelated.mjs'), 'export const y = 1\n')
  git(worktreePath, ['add', '.'])
  git(worktreePath, ['commit', '-q', '-m', 'a no-op commit that does not fix the real defect'])

  const fakeDispatch = async () => ({ workerId: 'over-confident-worker', providerId: 'openai', agentId: 'codex', exitCode: 0, timedOut: false })
  const result = await runRepairAttempt({
    finding,
    missionId,
    canonicalRepoPath,
    clock: () => new Date(),
    deps: { dispatchWorker: fakeDispatch, lifecycleDeps: { collectHostMemoryEvidence: fakeHealthyMemory } }
  })
  assert.equal(result.outcome, 'VERIFIED_FAIL_WILL_RETRY_OR_ESCALATE_NEXT_TICK')
  assert.equal(result.verification.verdict, 'VERIFIED_FAIL')
  assert.ok(result.verification.reasons.includes('REPRODUCTION_STILL_FAILS'))
  assert.equal(result.finding.status, 'FIX_IN_PROGRESS')
})

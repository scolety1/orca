// Real, disposable git repositories/worktrees under os.tmpdir() only --
// never any real machine path. Runs the FULL runGovernedCleanupAction
// pipeline end-to-end against them. `gateCheck` is faked ONLY to open the
// gate for the "should proceed" fixtures (never touching the real global
// env var/flag file); the "must refuse" fixtures either omit gateCheck
// entirely (proving the REAL default gate) or prove a blocker refuses
// authorization even with the gate open.
import assert from 'node:assert/strict'
import test from 'node:test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const HERE = import.meta.dirname
const STATE_FILE = path.join(HERE, '..', 'server', '.local-state', `operator-state.test-cleanup-executor-worktree-${process.pid}.json`)
process.env.TSF_UI_STATE_FILE = STATE_FILE
const QUARANTINE_DIR = path.join(HERE, '..', 'server', '.local-state', `cleanup-quarantine-test-worktree-${process.pid}`)
process.env.TSF_CLEANUP_QUARANTINE_DIR = QUARANTINE_DIR

const { runGovernedCleanupAction } = await import('../server/cleanup-executor.mjs')
const { mutateCheckpoint, acquirePlannerLease } = await import('../server/planner-mission-store.mjs')
const { createPlannerMissionCheckpoint, registerDispatchedWorker } = await import('../domain/planner-mission-checkpoint.mjs')
const { resolveCanonicalPath } = await import('../server/resource-auditor-path-identity.mjs')

function cleanupIsolatedState() {
  for (const suffix of ['', '.tmp', '.planner-mission.lock', '.cleanup-request.lock']) {
    rmSync(`${STATE_FILE}${suffix}`, { force: true })
  }
  rmSync(QUARANTINE_DIR, { recursive: true, force: true })
}
cleanupIsolatedState()
test.after(cleanupIsolatedState)

const ROOT = mkdtempSync(path.join(tmpdir(), 'tsf-cleanup-executor-worktree-'))
test.after(() => rmSync(ROOT, { recursive: true, force: true }))
const clock = () => new Date('2026-09-06T12:00:00.000Z')
const openGate = () => ({ open: true, reason: 'test-injected open gate (real global gate never touched)' })

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

function addWorktree(repo, dirName, branch, { fromNewBranch = true } = {}) {
  const worktreePath = path.join(ROOT, dirName)
  if (fromNewBranch) {
    git(repo, ['worktree', 'add', '-q', '-b', branch, worktreePath])
  } else {
    git(repo, ['worktree', 'add', '-q', worktreePath, branch])
  }
  return worktreePath
}

test('HAPPY PATH: REMOVE_DISPOSABLE_WORKTREE against a clean, unreferenced worktree -- COMPLETED, git actually removed it, quarantine copy preserves gitignored content', async () => {
  const repo = initMainRepo('repo-happy-remove')
  const worktreePath = addWorktree(repo, 'repo-happy-remove-linked', 'tsf/feature/disposable-happy')
  // A gitignored file: real, present in the working tree, but `git
  // status --porcelain` correctly reports the tree as clean regardless --
  // exactly the untracked/gitignored content `git worktree remove` would
  // otherwise destroy irretrievably, which is why the quarantine COPY step
  // exists at all.
  writeFileSync(path.join(worktreePath, '.gitignore'), 'untracked-scratch.txt\n')
  git(worktreePath, ['add', '.gitignore'])
  git(worktreePath, ['commit', '-q', '-m', 'ignore scratch file'])
  writeFileSync(path.join(worktreePath, 'untracked-scratch.txt'), 'untracked but valuable')

  const outcome = await runGovernedCleanupAction({
    actionClass: 'REMOVE_DISPOSABLE_WORKTREE',
    targetIdentity: { realPath: worktreePath, branch: 'tsf/feature/disposable-happy' },
    rationale: 'confirmed disposable by fixture audit',
    grantedBy: 'test-owner',
    mutationParams: { repoRoot: repo },
    safetyOptions: { checkGit: true },
    gateCheck: openGate,
    clock
  })

  assert.equal(outcome.status, 'COMPLETED')
  assert.equal(existsSync(worktreePath), false, 'git worktree remove must have actually run')
  const quarantineId = outcome.execution.result.quarantineId
  assert.ok(quarantineId)
  const quarantinedFile = path.join(QUARANTINE_DIR, quarantineId, path.basename(worktreePath), 'untracked-scratch.txt')
  assert.equal(readFileSync(quarantinedFile, 'utf8'), 'untracked but valuable', 'the untracked file git would have destroyed is preserved in quarantine')
})

test('DIRTY WORKTREE fixture: uncommitted changes present -- AUTHORIZATION_REFUSED, worktree left completely untouched', async () => {
  const repo = initMainRepo('repo-dirty')
  const worktreePath = addWorktree(repo, 'repo-dirty-linked', 'tsf/feature/dirty-target')
  writeFileSync(path.join(worktreePath, 'uncommitted.txt'), 'not committed')

  const outcome = await runGovernedCleanupAction({
    actionClass: 'REMOVE_DISPOSABLE_WORKTREE',
    targetIdentity: { realPath: worktreePath, branch: 'tsf/feature/dirty-target' },
    rationale: 'attempted removal of a dirty worktree',
    mutationParams: { repoRoot: repo },
    safetyOptions: { checkGit: true },
    gateCheck: openGate,
    clock
  })

  assert.equal(outcome.status, 'AUTHORIZATION_REFUSED')
  assert.equal(existsSync(worktreePath), true, 'a dirty worktree must never be removed')
  assert.equal(existsSync(path.join(worktreePath, 'uncommitted.txt')), true)
})

test('CLEAN FULLY-MERGED WORKTREE/BRANCH fixture: DELETE_LOCAL_MERGED_BRANCH happy path -- COMPLETED, branch actually deleted', async () => {
  const repo = initMainRepo('repo-merged-branch')
  git(repo, ['branch', 'tsf/feature/cleanly-merged'])

  const outcome = await runGovernedCleanupAction({
    actionClass: 'DELETE_LOCAL_MERGED_BRANCH',
    targetIdentity: { realPath: repo, branch: 'tsf/feature/cleanly-merged' },
    rationale: 'fully merged into main, confirmed disposable',
    mutationParams: { repoRoot: repo, branch: 'tsf/feature/cleanly-merged', canonicalBranch: 'main' },
    gateCheck: openGate,
    clock
  })

  assert.equal(outcome.status, 'COMPLETED')
  const branches = git(repo, ['branch', '--list', 'tsf/feature/cleanly-merged'])
  assert.equal(branches.trim(), '')
})

test('UNIQUE UNPUSHED COMMIT fixture: DELETE_LOCAL_MERGED_BRANCH refuses at the git level -- EXECUTION_FAILED, branch still exists', async () => {
  const repo = initMainRepo('repo-unpushed-branch')
  git(repo, ['checkout', '-q', '-b', 'tsf/feature/has-unique-commit'])
  writeFileSync(path.join(repo, 'unique.txt'), 'x')
  git(repo, ['add', '.'])
  git(repo, ['commit', '-q', '-m', 'a real unique commit'])
  git(repo, ['checkout', '-q', 'main'])

  const outcome = await runGovernedCleanupAction({
    actionClass: 'DELETE_LOCAL_MERGED_BRANCH',
    targetIdentity: { realPath: repo, branch: 'tsf/feature/has-unique-commit' },
    rationale: 'attempted safe delete of a non-merged branch',
    mutationParams: { repoRoot: repo, branch: 'tsf/feature/has-unique-commit', canonicalBranch: 'main' },
    gateCheck: openGate,
    clock
  })

  assert.equal(outcome.status, 'EXECUTION_FAILED')
  const branches = git(repo, ['branch', '--list', 'tsf/feature/has-unique-commit'])
  assert.notEqual(branches.trim(), '', 'the branch must survive a refused safe-delete attempt')
})

test('the SAME unique-unpushed-commit branch via the ELEVATED DELETE_BRANCH_WITH_UNIQUE_UNPUSHED_COMMITS class succeeds -- proving the tier distinction is real, not just labeled', async () => {
  const repo = initMainRepo('repo-elevated-branch-delete')
  git(repo, ['checkout', '-q', '-b', 'tsf/feature/elevated-target'])
  writeFileSync(path.join(repo, 'unique.txt'), 'x')
  git(repo, ['add', '.'])
  git(repo, ['commit', '-q', '-m', 'a real unique commit'])
  git(repo, ['checkout', '-q', 'main'])

  const outcome = await runGovernedCleanupAction({
    actionClass: 'DELETE_BRANCH_WITH_UNIQUE_UNPUSHED_COMMITS',
    targetIdentity: { realPath: repo, branch: 'tsf/feature/elevated-target' },
    rationale: 'owner explicitly wants this branch gone despite the unique commit',
    mutationParams: { repoRoot: repo, branch: 'tsf/feature/elevated-target' },
    gateCheck: openGate,
    clock
  })

  assert.equal(outcome.status, 'COMPLETED')
  const branches = git(repo, ['branch', '--list', 'tsf/feature/elevated-target'])
  assert.equal(branches.trim(), '')
})

test('PROTECTED CANONICAL-MAIN fixture: any attempt against branch "main" is refused even with the gate open, real state untouched', async () => {
  const repo = initMainRepo('repo-protect-main')
  const outcome = await runGovernedCleanupAction({
    actionClass: 'DELETE_BRANCH_WITH_UNIQUE_UNPUSHED_COMMITS',
    targetIdentity: { realPath: repo, branch: 'main' },
    rationale: 'a misguided attempt to delete main itself',
    mutationParams: { repoRoot: repo, branch: 'main' },
    gateCheck: openGate,
    clock
  })
  assert.equal(outcome.status, 'AUTHORIZATION_REFUSED')
  const branches = git(repo, ['branch', '--list', 'main'])
  assert.notEqual(branches.trim(), '')
})

test('PROTECTED-REGISTRY (NWR/TSF-style tagged) fixture: a fixture explicitly tagged protected refuses removal even though every other signal (clean, unreferenced, non-main) is perfect', async () => {
  const repo = initMainRepo('repo-tagged-protected')
  const worktreePath = addWorktree(repo, 'repo-tagged-protected-linked', 'tsf/feature/looks-disposable')
  // Registered by its OS-canonical form -- exactly how a real production
  // registry-seeding path resolves entries (resolveCanonicalPath), so this
  // proves the DENYLIST mechanism itself, not an incidental string match.
  const canonicalWorktreePath = await resolveCanonicalPath(worktreePath)

  const outcome = await runGovernedCleanupAction({
    actionClass: 'REMOVE_DISPOSABLE_WORKTREE',
    targetIdentity: { realPath: worktreePath, branch: 'tsf/feature/looks-disposable' },
    rationale: 'attempted removal of a path deliberately tagged protected',
    mutationParams: { repoRoot: repo },
    safetyOptions: { checkGit: true, callerProtectedRegistry: { paths: [canonicalWorktreePath], branches: [] } },
    gateCheck: openGate,
    clock
  })

  assert.equal(outcome.status, 'AUTHORIZATION_REFUSED')
  assert.equal(existsSync(worktreePath), true, 'a real protected-path denylist entry must actually refuse a real, otherwise-disposable-looking fixture')
})

test('SLEEPING LANE fixture: a non-COMPLETE planner mission (stale lease, but mission not complete) referencing this branch refuses the action -- "Sleep != complete"', async () => {
  const repo = initMainRepo('repo-sleeping-lane')
  const worktreePath = addWorktree(repo, 'repo-sleeping-lane-linked', 'tsf/feature/sleeping-lane-target')
  const missionId = 'mission:cleanup-executor-sleeping-lane'
  await mutateCheckpoint(
    missionId,
    () =>
      createPlannerMissionCheckpoint(
        { missionId, missionGoal: 'unfinished lane', phase: 'BUILD', repoState: { branch: 'tsf/feature/sleeping-lane-target', sha: 'f'.repeat(40), worktreePath } },
        clock
      ),
    clock
  )
  const staleClock = () => new Date('2026-09-06T11:00:00.000Z')
  await acquirePlannerLease(missionId, 'planner-gone-away', staleClock, { ttlMs: 1000 }) // already expired relative to `clock`

  const outcome = await runGovernedCleanupAction({
    actionClass: 'REMOVE_DISPOSABLE_WORKTREE',
    targetIdentity: { realPath: worktreePath, branch: 'tsf/feature/sleeping-lane-target' },
    rationale: 'looks stopped, mission is not actually complete',
    mutationParams: { repoRoot: repo },
    safetyOptions: { checkGit: true },
    gateCheck: openGate,
    clock
  })

  assert.equal(outcome.status, 'AUTHORIZATION_REFUSED')
  assert.equal(existsSync(worktreePath), true)
})

test('ACTIVE WORKER fixture: a mission with a currently DISPATCHED worker referencing this target refuses the action', async () => {
  const repo = initMainRepo('repo-active-worker')
  const worktreePath = addWorktree(repo, 'repo-active-worker-linked', 'tsf/feature/active-worker-target')
  const missionId = 'mission:cleanup-executor-active-worker'
  await mutateCheckpoint(
    missionId,
    () =>
      registerDispatchedWorker(
        createPlannerMissionCheckpoint(
          { missionId, missionGoal: 'a lane with a live worker', phase: 'BUILD', repoState: { branch: 'tsf/feature/active-worker-target', sha: 'a1'.repeat(20), worktreePath } },
          clock
        ),
        { workerId: 'worker-1', kind: 'IMPLEMENTATION', taskFingerprint: 'task-1' },
        clock
      ),
    clock
  )

  const outcome = await runGovernedCleanupAction({
    actionClass: 'REMOVE_DISPOSABLE_WORKTREE',
    targetIdentity: { realPath: worktreePath, branch: 'tsf/feature/active-worker-target' },
    rationale: 'attempted removal while a worker is actively dispatched',
    mutationParams: { repoRoot: repo },
    safetyOptions: { checkGit: true },
    gateCheck: openGate,
    clock
  })

  assert.equal(outcome.status, 'AUTHORIZATION_REFUSED')
  assert.equal(existsSync(worktreePath), true)
})

test('RACE-BETWEEN-AUDIT-AND-EXECUTION fixture: the state looks clear at plan+authorization time but a fresh blocker appears at the final race-recheck -- EXECUTION_FAILED with TSF_CLEANUP_RACE_BLOCKED, mutation never runs', async () => {
  const repo = initMainRepo('repo-race')
  const worktreePath = addWorktree(repo, 'repo-race-linked', 'tsf/feature/race-target')

  const CLEAR = { evidenceObservedAt: clock().toISOString(), protectedPath: false, protectedBranch: false, activeMissionReferenced: false, git: { clean: true } }
  const BLOCKED = { evidenceObservedAt: clock().toISOString(), protectedPath: false, protectedBranch: false, activeMissionReferenced: false, git: { clean: false } }
  let call = 0
  const revalidate = async () => {
    call += 1
    // call 1 = plan time, call 2 = authorization time, call 3 = the race
    // re-check immediately before mutation -- only THIS one reports a
    // blocker, proving it is genuinely independent from the first two.
    return { context: call < 3 ? CLEAR : BLOCKED, resolvedRealPath: worktreePath }
  }

  const outcome = await runGovernedCleanupAction({
    actionClass: 'REMOVE_DISPOSABLE_WORKTREE',
    targetIdentity: { realPath: worktreePath, branch: 'tsf/feature/race-target' },
    rationale: 'race-recheck proof fixture',
    mutationParams: { repoRoot: repo },
    gateCheck: openGate,
    revalidate,
    clock
  })

  assert.equal(outcome.status, 'EXECUTION_FAILED')
  assert.equal(outcome.execution.result.code, 'TSF_CLEANUP_RACE_BLOCKED')
  assert.equal(call, 3, 'the race re-check must be a genuinely separate third evaluation, not a reuse of the first two')
  assert.equal(existsSync(worktreePath), true, 'the mutating step must never run once the race re-check blocks')
})

test('REAL DEFAULT OWNER-AUTHORIZATION GATE (no override) refuses an otherwise-perfect fixture -- the actual, unset-by-default gate this whole phase is built behind', async () => {
  const repo = initMainRepo('repo-real-gate')
  const worktreePath = addWorktree(repo, 'repo-real-gate-linked', 'tsf/feature/real-gate-target')

  const outcome = await runGovernedCleanupAction({
    actionClass: 'REMOVE_DISPOSABLE_WORKTREE',
    targetIdentity: { realPath: worktreePath, branch: 'tsf/feature/real-gate-target' },
    rationale: 'proof that the real default gate blocks real execution',
    mutationParams: { repoRoot: repo },
    safetyOptions: { checkGit: true },
    clock
    // gateCheck deliberately OMITTED -- uses the real
    // cleanup-owner-authorization-gate.mjs against real process.env/flag file.
  })

  assert.equal(outcome.status, 'AUTHORIZATION_REFUSED')
  assert.equal(existsSync(worktreePath), true, 'nothing real may ever be mutated while the real gate is unset')
})

test('IDEMPOTENCY fixture: calling the exact same request twice returns the same terminal result and never mutates a second time', async () => {
  const repo = initMainRepo('repo-idempotent')
  const worktreePath = addWorktree(repo, 'repo-idempotent-linked', 'tsf/feature/idempotent-target')

  const request = {
    actionClass: 'REMOVE_DISPOSABLE_WORKTREE',
    targetIdentity: { realPath: worktreePath, branch: 'tsf/feature/idempotent-target' },
    rationale: 'idempotency proof',
    mutationParams: { repoRoot: repo },
    safetyOptions: { checkGit: true },
    gateCheck: openGate,
    clock
  }
  const first = await runGovernedCleanupAction(request)
  assert.equal(first.status, 'COMPLETED')

  const second = await runGovernedCleanupAction(request)
  assert.equal(second.status, 'IDEMPOTENT_REPLAY')
  assert.equal(second.execution.executionId, first.execution.executionId)
})

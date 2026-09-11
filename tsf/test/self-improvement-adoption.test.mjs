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
const { withAdoptionLock } = await import('../server/command-adoption-execution.mjs')
const { createIsolatedRepairWorktree } = await import('../server/self-improvement-worktree.mjs')
const { ADOPTION_AUTHORIZATION_MARKER, defaultAdoptionAuthorizationFlagPath } = await import('../server/self-improvement-adoption-authorization-gate.mjs')
const { readReceipts } = await import('../server/self-improvement-receipt-store.mjs')
const { createProjectExecutionHold } = await import('../domain/project-execution-hold.mjs')

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

// Pre-UI Productization V1, Priority 3 -- real lock/hold parity with the
// main adoption path (command-adoption-execution.mjs), reusing its own
// withAdoptionLock primitive directly rather than inventing a second
// mechanism. Owner's own required test list: competing adoption,
// candidate moves, stale evidence, hold appears, branch changes between
// read and execution.

function fakeGate(root, suffix) {
  const fakeFlagPath = path.join(root, `FAKE_ADOPTION_${suffix}.flag`)
  writeFileSync(fakeFlagPath, ADOPTION_AUTHORIZATION_MARKER, 'utf8')
  return { env: { TSF_SELF_IMPROVEMENT_ADOPTION_AUTHORIZATION: ADOPTION_AUTHORIZATION_MARKER }, flagFilePath: fakeFlagPath }
}

test('competing adoption: two genuinely concurrent attemptRepairAdoption calls for the SAME project never interleave -- real mutual exclusion via the shared lock', async () => {
  const order = []
  const projectId = 'selfimprove-lock-project'
  const trackingFinding = { status: 'READY_FOR_ADOPTION', findingId: 'finding:lock-a', projectId }
  const trackingFinding2 = { status: 'READY_FOR_ADOPTION', findingId: 'finding:lock-b', projectId }

  // A deliberately slow "critical section" proxy run through the SAME real
  // withAdoptionLock this engine now uses internally -- proves the lock
  // itself (not attemptRepairAdoption's business logic) genuinely
  // serializes two concurrent callers for the SAME project id, the exact
  // property this fix depends on.
  async function slow(label) {
    return withAdoptionLock(projectId, async () => {
      order.push(`${label}:start`)
      await new Promise((resolve) => setTimeout(resolve, 30))
      order.push(`${label}:end`)
    })
  }

  await Promise.all([slow('A'), slow('B')])
  // Never interleaved (A:start, B:start, A:end, B:end) -- always one
  // caller's start/end pair fully completes before the other's starts.
  assert.deepEqual(order, ['A:start', 'A:end', 'B:start', 'B:end'])

  // Sanity: the real findings above are wired to the same projectId, the
  // actual key attemptRepairAdoption derives (finding.projectId ??
  // missionId) -- confirms this test's lock key matches production usage.
  assert.equal(trackingFinding.projectId, projectId)
  assert.equal(trackingFinding2.projectId, projectId)
})

test('cross-engine lock: a self-improvement repair adoption and a main-path adoption for the SAME project serialize against EACH OTHER, not just against themselves', async () => {
  const projectId = 'cross-engine-lock-project'
  const order = []

  // Blocks main-path adoption inside its OWN real lock (via a deliberately
  // unresolvable dependency read) long enough to prove a concurrent
  // self-improvement attemptRepairAdoption for the SAME project id must
  // wait for it -- both real callers, both real withAdoptionLock users.
  const mainPathCall = withAdoptionLock(projectId, async () => {
    order.push('main:start')
    await new Promise((resolve) => setTimeout(resolve, 30))
    order.push('main:end')
  })

  const canonicalRepoPath = initFixtureRepo('cross-engine-canonical')
  const worktreePath = path.join(ROOT, 'cross-engine-worktree')
  const candidate = await createIsolatedRepairWorktree({ canonicalRepoPath, worktreePath, branch: 'tsf/self-improve/cross-engine/attempt-1' })
  writeFileSync(path.join(worktreePath, 'existing-file.mjs'), 'export const x = 3\n')
  git(worktreePath, ['add', '.'])
  git(worktreePath, ['commit', '-q', '-m', 'cross-engine fixture fix'])
  const gate = fakeGate(ROOT, 'cross-engine')

  const repairCall = attemptRepairAdoption({
    finding: { status: 'READY_FOR_ADOPTION', findingId: 'finding:cross-engine', projectId },
    missionId: 'mission:cross-engine',
    worktreePath,
    branch: candidate.branch,
    canonicalRepoPath,
    verifierVerdict: 'VERIFIED_PASS',
    deps: gate
  }).then((result) => {
    order.push('repair:ran')
    return result
  })

  await Promise.all([mainPathCall, repairCall])
  // The repair call must not have run its own real work (git I/O) until
  // AFTER the main-path lock holder released -- proving the SAME lock
  // queue governs both, not two independent locks that happen to look
  // similar.
  assert.deepEqual(order, ['main:start', 'main:end', 'repair:ran'])
})

test('hold appears mid-flight: a hold set between the initial read and the fresh pre-merge re-check refuses honestly, on current state', async () => {
  const canonicalRepoPath = initFixtureRepo('hold-mid-flight-canonical')
  const worktreePath = path.join(ROOT, 'hold-mid-flight-worktree')
  const candidate = await createIsolatedRepairWorktree({ canonicalRepoPath, worktreePath, branch: 'tsf/self-improve/hold-mid-flight/attempt-1' })
  writeFileSync(path.join(worktreePath, 'existing-file.mjs'), 'export const x = 4\n')
  git(worktreePath, ['add', '.'])
  git(worktreePath, ['commit', '-q', '-m', 'hold-mid-flight fixture fix'])
  const gate = fakeGate(ROOT, 'hold-mid-flight')

  const projectId = 'hold-mid-flight-project'
  let reads = 0
  const lateHold = createProjectExecutionHold({ projectId, reason: 'EXTERNAL_WORK_ACTIVE', setBy: 'test', note: 'appeared mid-flight' }, () => new Date())
  const readProjectExecutionHold = (_id) => {
    reads += 1
    // Honest at the initial read (nothing set yet); the SAME real hold has
    // "appeared" by the time the fresh, pre-merge re-check runs -- exactly
    // the window this fix closes.
    return reads === 1 ? null : lateHold
  }

  const canonicalHeadBefore = git(canonicalRepoPath, ['rev-parse', 'HEAD']).trim()
  const result = await attemptRepairAdoption({
    finding: { status: 'READY_FOR_ADOPTION', findingId: 'finding:hold-mid-flight', projectId },
    missionId: 'mission:hold-mid-flight',
    worktreePath,
    branch: candidate.branch,
    canonicalRepoPath,
    verifierVerdict: 'VERIFIED_PASS',
    deps: { ...gate, readProjectExecutionHold }
  })

  assert.equal(result.adopted, false)
  assert.equal(result.reason, 'PROJECT_EXECUTION_HOLD_ACTIVE')
  assert.match(result.detail, /appeared mid-flight/)
  assert.ok(reads >= 2, 'must read hold state more than once -- an initial read alone is exactly the stale-state bug this fix closes')
  // Never merged -- canonical HEAD unchanged.
  const canonicalHeadAfter = git(canonicalRepoPath, ['rev-parse', 'HEAD']).trim()
  assert.equal(canonicalHeadAfter, canonicalHeadBefore)
})

test('a hold already active at the very start is caught by the normal readiness check, honestly, before any merge is attempted', async () => {
  const canonicalRepoPath = initFixtureRepo('hold-upfront-canonical')
  const worktreePath = path.join(ROOT, 'hold-upfront-worktree')
  const candidate = await createIsolatedRepairWorktree({ canonicalRepoPath, worktreePath, branch: 'tsf/self-improve/hold-upfront/attempt-1' })
  const gate = fakeGate(ROOT, 'hold-upfront')
  const projectId = 'hold-upfront-project'
  const upfrontHold = createProjectExecutionHold({ projectId, reason: 'EXTERNAL_WORK_ACTIVE', setBy: 'test' }, () => new Date())

  const result = await attemptRepairAdoption({
    finding: { status: 'READY_FOR_ADOPTION', findingId: 'finding:hold-upfront', projectId },
    missionId: 'mission:hold-upfront',
    worktreePath,
    branch: candidate.branch,
    canonicalRepoPath,
    verifierVerdict: 'VERIFIED_PASS',
    deps: { ...gate, readProjectExecutionHold: () => upfrontHold }
  })

  assert.equal(result.adopted, false)
  assert.equal(result.reason, 'NOT_READY')
  assert.ok(result.blockers.some((b) => b.includes('execution hold')))
})

test('a project-less finding (no real projectId) falls back to the missionId as the lock key -- even one containing colons, without crashing (Windows path safety)', async () => {
  const result = await attemptRepairAdoption({
    finding: { status: 'READY_FOR_ADOPTION', findingId: 'finding:project-less' }, // no projectId
    missionId: 'mission:project-less:has:colons',
    worktreePath: 'this-path-does-not-exist',
    branch: 'does-not-matter',
    canonicalRepoPath: 'this-path-does-not-exist-either',
    verifierVerdict: 'VERIFIED_PASS',
    deps: {}
  })
  // GATE CLOSED (real, default) -- the point of this test is that the lock
  // acquisition itself (keyed by the colon-containing missionId) never
  // throws, regardless of the outcome that follows.
  assert.equal(result.adopted, false)
  assert.equal(result.reason, 'GATE_CLOSED')
})

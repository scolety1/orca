import assert from 'node:assert/strict'
import test from 'node:test'
import path from 'node:path'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'
import { createOvernightRun } from '../domain/keep-going.mjs'
import {
  deriveWorktreePath,
  gatherWorktreeEvidence,
  readVerificationVerdict,
  verificationVerdictPath,
  reconcileSettledRun,
  buildVerificationWorkItem
} from '../server/settled-run-reconciler.mjs'

// deps.capacity is never overridden below (only orchestration/store are) --
// it defaults to the real fetchCapacitySnapshot, which spawns the `orca`
// CLI. Pointing TSF_ORCA_CLI_COMMAND at the stub (same convention as
// keep-going-dispatch-loop.test.mjs) keeps every test here fast and
// hermetic instead of depending on a live account.
process.env.TSF_ORCA_CLI_COMMAND = path.join(import.meta.dirname, 'fixtures', 'stub-orca-cli.mjs')
process.env.STUB_ORCA_MODE = 'success'
// Main TSF Resource Pressure Governor integration review: forced HEALTHY,
// same seam http-resource-pressure-governor.test.mjs uses.
process.env.TSF_RESOURCE_PRESSURE_TEST_TOTAL_BYTES = String(16 * 1024 ** 3)
process.env.TSF_RESOURCE_PRESSURE_TEST_FREE_BYTES = String(8 * 1024 ** 3)

// A REAL-time clock, deliberately -- unlike most other test files in this
// suite, these tests compare domain checkpoint timestamps this clock
// produces against REAL git commit times (gatherWorktreeEvidence spawns
// real `git log --since`), so a historical fixed clock value would
// intermittently misclassify a real fixture commit as before/after the
// cutoff depending on when the test happens to run.
const clock = () => new Date()
const PROJECT_ID = 'fixture:proj'

const tempDirs = []
test.after(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function tempDir(prefix) {
  const dir = mkdtempSync(path.join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

function git(cwd, args) {
  execFileSync('git', args, { cwd, stdio: 'ignore' })
}

function commit(dir, file, content, message) {
  writeFileSync(path.join(dir, file), content)
  git(dir, ['add', '-A'])
  git(dir, ['commit', '-q', '-m', message])
}

function initRepo() {
  const dir = tempDir('tsf-reconciler-repo-')
  git(dir, ['init', '-q'])
  git(dir, ['config', 'user.email', 'test@example.com'])
  git(dir, ['config', 'user.name', 'Test'])
  commit(dir, 'README.md', '# x\n', 'initial')
  return dir
}

function baseRun(overrides = {}) {
  return createOvernightRun(
    {
      id: 'run-1',
      projectId: PROJECT_ID,
      originalGoal: 'Fix the thing.',
      acceptanceCriteria: ['CRITERION_A', 'CRITERION_B'],
      usageMode: 'BALANCED',
      ...overrides
    },
    clock
  )
}

function withSettledWave(run, worktree, settledAt) {
  return {
    ...run,
    waves: [
      {
        digest: 'd1',
        wavePlan: { waveNumber: 1, batches: [[{ id: 'w1', scope: ['**/*'], worktree }]] },
        waveResult: { outcomes: [{ workItemId: 'w1', outcome: 'COMPLETED' }], settledAt },
        recordedAt: settledAt
      }
    ],
    checkpoints: [
      {
        phase: 'WAVE_SETTLED',
        note: null,
        evidence: [],
        waveCount: 1,
        state: 'ACTIVE',
        at: settledAt
      }
    ]
  }
}

// --- deriveWorktreePath ---

test('deriveWorktreePath returns null (honest, not fabricated) when the run has no waves', () => {
  assert.equal(deriveWorktreePath(baseRun()), null)
})

test('deriveWorktreePath returns the real worktree from the most recent wave', () => {
  const run = withSettledWave(baseRun(), '/real/worktree', clock().toISOString())
  assert.equal(deriveWorktreePath(run), '/real/worktree')
})

// --- buildVerificationWorkItem ---

test("buildVerificationWorkItem carries the run's own real constraints into the dispatched spec -- real-production finding: reconciling NWR live dispatched a verification pass that ran the project's real pytest suite (a reasonable thing to do to independently verify) and hit the EXACT known, structural side effect NWR's own constraints warned about, because this spec never carried those constraints forward. Reverted by hand once found; this pins the fix.", () => {
  const run = baseRun({
    constraints: ['NEVER modify docs/model_v4/ -- a known pytest side effect has done this before']
  })
  const item = buildVerificationWorkItem(run, '/wt')
  assert.match(item.spec, /NEVER modify docs\/model_v4\//)
})

// --- readVerificationVerdict ---

test('readVerificationVerdict returns null when the file does not exist', async () => {
  const dir = initRepo()
  const run = withSettledWave(baseRun(), dir, clock().toISOString())
  assert.equal(await readVerificationVerdict(run, dir), null)
})

test('readVerificationVerdict returns null for malformed JSON, never throws', async () => {
  const dir = initRepo()
  const run = withSettledWave(baseRun(), dir, clock().toISOString())
  const verdictFile = path.join(dir, verificationVerdictPath(run.id))
  mkdirSync(path.dirname(verdictFile), { recursive: true })
  writeFileSync(verdictFile, 'not json{')
  assert.equal(await readVerificationVerdict(run, dir), null)
})

test('readVerificationVerdict returns null for a PARTIAL verdict (fewer criteria than the run declares) -- never decides COMPLETE on an incomplete picture', async () => {
  const dir = initRepo()
  const run = withSettledWave(baseRun(), dir, clock().toISOString())
  const verdictFile = path.join(dir, verificationVerdictPath(run.id))
  mkdirSync(path.dirname(verdictFile), { recursive: true })
  writeFileSync(
    verdictFile,
    JSON.stringify({ criteria: [{ criterion: 'CRITERION_A', verified: true, evidence: 'x' }] })
  )
  assert.equal(await readVerificationVerdict(run, dir), null)
})

test('readVerificationVerdict returns null when a verdict duplicates one criterion while omitting another -- adversarial-review finding: array length alone hid this exact gap', async () => {
  const dir = initRepo()
  const run = withSettledWave(baseRun(), dir, clock().toISOString())
  const verdictFile = path.join(dir, verificationVerdictPath(run.id))
  mkdirSync(path.dirname(verdictFile), { recursive: true })
  writeFileSync(
    verdictFile,
    JSON.stringify({
      criteria: [
        { criterion: 'CRITERION_A', verified: true, evidence: 'x' },
        { criterion: 'CRITERION_A', verified: true, evidence: 'x (duplicate)' }
      ]
    })
  )
  assert.equal(
    await readVerificationVerdict(run, dir),
    null,
    'CRITERION_B was never actually covered'
  )
})

test('readVerificationVerdict returns the real parsed verdict for a complete, well-formed file', async () => {
  const dir = initRepo()
  const run = withSettledWave(baseRun(), dir, clock().toISOString())
  const verdictFile = path.join(dir, verificationVerdictPath(run.id))
  mkdirSync(path.dirname(verdictFile), { recursive: true })
  writeFileSync(
    verdictFile,
    JSON.stringify({
      criteria: [
        { criterion: 'CRITERION_A', verified: true, evidence: 'ran real check, passed' },
        { criterion: 'CRITERION_B', verified: false, evidence: 'still failing' }
      ]
    })
  )
  const verdict = await readVerificationVerdict(run, dir)
  assert.equal(verdict.criteria.length, 2)
  assert.equal(verdict.criteria.find((c) => c.criterion === 'CRITERION_A').verified, true)
})

// --- gatherWorktreeEvidence (real git) ---

test("gatherWorktreeEvidence reports real, actual post-checkpoint commits -- WorldForge/Landing Page's exact real shape", async () => {
  const dir = initRepo()
  await new Promise((resolve) => setTimeout(resolve, 1100))
  const checkpointAt = new Date().toISOString()
  await new Promise((resolve) => setTimeout(resolve, 1100))
  commit(dir, 'late.md', 'x\n', 'a real post-checkpoint commit')
  const run = withSettledWave(baseRun(), dir, checkpointAt)
  const evidence = await gatherWorktreeEvidence(run)
  assert.equal(evidence.ok, true)
  assert.equal(evidence.commitsSinceLastCheckpoint.length, 1)
  assert.equal(evidence.commitsSinceLastCheckpoint[0].subject, 'a real post-checkpoint commit')
})

test('gatherWorktreeEvidence reports EVIDENCE_UNAVAILABLE (not a fabricated clean report) for an unknown worktree', async () => {
  const evidence = await gatherWorktreeEvidence(baseRun())
  assert.equal(evidence.ok, false)
  assert.equal(evidence.reason, 'NO_KNOWN_WORKTREE')
})

// --- reconcileSettledRun: full orchestration, fake store + fake orchestration deps ---

// readRun must be SYNCHRONOUS -- tickKeepGoingRun (keep-going-dispatch-
// loop.mjs) calls `store.readRun(projectId)` with no await, matching the
// real production store's own synchronous, unlocked, torn-read-tolerant
// contract (keep-going-run-store.mjs's readKeepGoingRun).
function makeFakeStore(run) {
  let current = run
  return {
    readRun: () => current,
    withRun: (_projectId, mutateFn) => {
      current = mutateFn(current)
      return current
    },
    get current() {
      return current
    }
  }
}

function okOrchestration() {
  return {
    createDispatcherTerminal: async () => ({
      ok: true,
      result: { terminal: { handle: 'fake-dispatcher-terminal' } }
    }),
    bindOrchestrationRun: async ({ id }) => ({ ok: true, result: { run: { id } } }),
    createOrchestrationRun: async () => ({ ok: true, result: { run: { id: 'orch-run-1' } } }),
    createOrchestrationTask: async () => ({ ok: true, result: { task: { id: 'task-verify' } } }),
    startOrchestrationWorker: async ({ task }) => ({
      ok: true,
      result: { taskId: task, dispatchId: `ctx-${task}`, state: 'ready', stage: 'input_accepted' }
    }),
    listOrchestrationTasks: async () => ({
      ok: true,
      result: { tasks: [{ id: 'task-verify', status: 'completed' }] }
    })
  }
}

test('reconcileSettledRun: CAPTURE_LATE_COMMITS actually checkpoints real evidence, and replay is a no-op', async () => {
  const dir = initRepo()
  const checkpointAt = new Date().toISOString()
  await new Promise((resolve) => setTimeout(resolve, 1100))
  commit(dir, 'late.md', 'x\n', 'unreconciled real commit')
  const run = withSettledWave(baseRun(), dir, checkpointAt)
  const store = makeFakeStore(run)
  delete process.env.ORCA_TERMINAL_HANDLE

  const first = await reconcileSettledRun(PROJECT_ID, clock, {
    store,
    tickDeps: { store, orchestration: okOrchestration() }
  })
  assert.equal(first.action, 'CAPTURE_LATE_COMMITS')
  assert.equal(first.performed, true)
  assert.equal(
    store.current.checkpoints.some((c) => c.phase === 'RECONCILIATION_LATE_COMMITS_CAPTURED'),
    true
  )

  // Second call: nothing new to capture -> falls through to the next real
  // gap (no verdict yet) instead of re-capturing the same commit.
  const second = await reconcileSettledRun(PROJECT_ID, clock, {
    store,
    tickDeps: { store, orchestration: okOrchestration() }
  })
  assert.notEqual(second.action, 'CAPTURE_LATE_COMMITS')
})

test('reconcileSettledRun: full lifecycle -- dispatches real verification, then COMPLETEs once a real verdict confirms everything', async () => {
  const dir = initRepo()
  await new Promise((resolve) => setTimeout(resolve, 1100))
  // A real (not fixed-clock) timestamp -- gatherWorktreeEvidence's `--since`
  // cutoff is compared against real git committer dates, not the fake
  // domain clock() used elsewhere for run mutations.
  const run = withSettledWave(baseRun(), dir, new Date().toISOString())
  const store = makeFakeStore(run)
  delete process.env.ORCA_TERMINAL_HANDLE
  const tickDeps = { store, orchestration: okOrchestration() }

  const dispatched = await reconcileSettledRun(PROJECT_ID, clock, { store, tickDeps })
  assert.equal(dispatched.action, 'DISPATCH_VERIFICATION')
  assert.equal(dispatched.dispatch.action, 'WAVE_DISPATCHED')
  assert.equal(store.current.inFlightWave !== null, true, 'a real wave is now genuinely in flight')

  // Nothing to reconcile while a real wave is in flight (needsReconciliation
  // gates this) -- proves this mechanism never redispatches over its own
  // in-flight verification wave.
  const whileInFlight = await reconcileSettledRun(PROJECT_ID, clock, { store, tickDeps })
  assert.equal(whileInFlight.action, 'NOT_APPLICABLE')

  // Settle the in-flight verification wave the same way any normal tick
  // would (a later, separate tickKeepGoingRun call) -- then simulate the
  // real dispatched worker having written its verdict file.
  const { tickKeepGoingRun } = await import('../server/keep-going-dispatch-loop.mjs')
  await tickKeepGoingRun(PROJECT_ID, [], clock, tickDeps)
  assert.equal(store.current.inFlightWave, null)

  mkdirSync(path.join(dir, 'docs', 'tsf', 'verification'), { recursive: true })
  writeFileSync(
    path.join(dir, verificationVerdictPath(run.id)),
    JSON.stringify({
      criteria: [
        { criterion: 'CRITERION_A', verified: true, evidence: 'real check A passed' },
        { criterion: 'CRITERION_B', verified: true, evidence: 'real check B passed' }
      ]
    })
  )

  const completed = await reconcileSettledRun(PROJECT_ID, clock, { store, tickDeps })
  assert.equal(completed.action, 'COMPLETE')
  assert.deepEqual([...completed.verifiedSatisfied].sort(), ['CRITERION_A', 'CRITERION_B'])
  assert.equal(
    store.current.state,
    'COMPLETE',
    'completeRun really transitioned the run -- never fabricated'
  )
})

// TSF Overnight Control-Plane Burn-In V2, real finding (not guessed),
// likely the most severe of the whole mission, LIVE-REPRODUCED HERE
// during independent red-team review of an earlier fix: this exact
// DISPATCH_VERIFICATION path -- fired on essentially every settled
// run's FIRST reconciliation pass (before any verdict file exists),
// arguably the single most common way a real wave gets dispatched
// anywhere in this codebase -- called tickKeepGoingRun with zero
// project-execution-hold awareness anywhere in the call chain. A real
// wave was genuinely dispatched into a project under an active hold.
// Fixed at tickKeepGoingRun/dispatchStep's own real choke point (see
// keep-going-dispatch-loop.mjs), so this call site needed no change of
// its own -- proving that fix's whole point: closing this exact gap
// without this file needing to know anything about holds at all.
test('reconcileSettledRun: DISPATCH_VERIFICATION honestly refuses for a project under an active execution hold, never dispatching a real wave into it', async () => {
  const dir = initRepo()
  await new Promise((resolve) => setTimeout(resolve, 1100))
  const run = withSettledWave(baseRun(), dir, new Date().toISOString())
  const store = makeFakeStore(run)
  delete process.env.ORCA_TERMINAL_HANDLE
  const readProjectExecutionHold = (projectId) =>
    projectId === PROJECT_ID
      ? { status: 'ACTIVE', reason: 'EXTERNAL_WORK_ACTIVE', note: 'another agent is on this repo', setBy: 'OPERATOR_CHAT' }
      : null
  const tickDeps = { store, orchestration: okOrchestration(), readProjectExecutionHold }

  const result = await reconcileSettledRun(PROJECT_ID, clock, { store, tickDeps })
  assert.equal(result.action, 'DISPATCH_VERIFICATION', 'reconciliation itself still honestly reports what it found')
  assert.equal(result.dispatch.action, 'DISPATCH_BLOCKED_BY_HOLD', 'but the real dispatch attempt is honestly refused')
  assert.match(result.dispatch.reason, /project execution hold active/)
  assert.equal(store.current.inFlightWave, null, 'no real wave may be dispatched into a held project')
})

test('reconcileSettledRun: a real verdict with a failing criterion raises NEEDS_YOU once the retry budget is exhausted, never silently completes', async () => {
  const dir = initRepo()
  await new Promise((resolve) => setTimeout(resolve, 1100))
  let run = withSettledWave(
    baseRun({ budget: { maxRetriesPerTask: 0 } }),
    dir,
    new Date().toISOString()
  )
  mkdirSync(path.join(dir, 'docs', 'tsf', 'verification'), { recursive: true })
  writeFileSync(
    path.join(dir, verificationVerdictPath(run.id)),
    JSON.stringify({
      criteria: [
        { criterion: 'CRITERION_A', verified: true, evidence: 'ok' },
        { criterion: 'CRITERION_B', verified: false, evidence: 'genuinely still broken' }
      ]
    })
  )
  const store = makeFakeStore(run)
  const result = await reconcileSettledRun(PROJECT_ID, clock, {
    store,
    tickDeps: { store, orchestration: okOrchestration() }
  })
  assert.equal(result.action, 'NEEDS_DECISION')
  assert.equal(store.current.state, 'NEEDS_YOU')
  assert.equal(store.current.needsYou.length, 1)
  assert.match(store.current.needsYou[0].question, /CRITERION_B/)
})

import assert from 'node:assert/strict'
import test from 'node:test'
import path from 'node:path'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'
import { createOvernightRun, planWave, dispatchWave, recordPendingDispatch } from '../domain/keep-going.mjs'
import { verificationVerdictPath } from '../server/settled-run-reconciler.mjs'
import {
  driveOneCycle,
  startKeepGoingFleetDriver,
  buildContinuationWorkItem,
  DEFAULT_MAX_CONCURRENT_TICKS
} from '../server/keep-going-fleet-driver.mjs'

process.env.TSF_ORCA_CLI_COMMAND = path.join(import.meta.dirname, 'fixtures', 'stub-orca-cli.mjs')
process.env.STUB_ORCA_MODE = 'success'
// Main TSF Resource Pressure Governor integration review: forced HEALTHY,
// same seam http-resource-pressure-governor.test.mjs uses.
process.env.TSF_RESOURCE_PRESSURE_TEST_TOTAL_BYTES = String(16 * 1024 ** 3)
process.env.TSF_RESOURCE_PRESSURE_TEST_FREE_BYTES = String(8 * 1024 ** 3)
delete process.env.ORCA_TERMINAL_HANDLE

const clock = () => new Date()

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

function initRepo() {
  const dir = tempDir('tsf-fleet-driver-repo-')
  git(dir, ['init', '-q'])
  git(dir, ['config', 'user.email', 'test@example.com'])
  git(dir, ['config', 'user.name', 'Test'])
  writeFileSync(path.join(dir, 'README.md'), '# x\n')
  git(dir, ['add', '-A'])
  git(dir, ['commit', '-q', '-m', 'initial'])
  return dir
}

// In-memory store matching the real production store's SYNCHRONOUS
// readRun / async withRun contract exactly (keep-going-run-store.mjs).
function makeFakeStore(runsById) {
  const runs = { ...runsById }
  return {
    readRun: (projectId) => runs[projectId] ?? null,
    withRun: (projectId, mutateFn) => {
      runs[projectId] = mutateFn(runs[projectId])
      return runs[projectId]
    },
    get all() {
      return runs
    }
  }
}

// A real, active hold record shape -- matches domain/project-execution-
// hold.mjs's own createProjectExecutionHold output exactly, injected via
// deps.readProjectExecutionHold (this file's own established DI
// convention, matching deps.store) rather than the real durable hold
// store -- this file has no TSF_UI_STATE_FILE isolation of its own (its
// static imports are hoisted before any env var this file could set
// would take effect), so touching the real store here would risk the
// shared default state file.
function activeHold(projectId, note) {
  return {
    schemaVersion: 'TSF_PROJECT_EXECUTION_HOLD_V1',
    projectId,
    status: 'ACTIVE',
    reason: 'EXTERNAL_WORK_ACTIVE',
    note,
    setBy: 'OPERATOR_CHAT',
    setAt: new Date().toISOString(),
    releasedBy: null,
    releasedAt: null,
    releaseReason: null
  }
}

// Stateful: tracks every task id this fake actually created via
// createOrchestrationTask, and reports each of them back as 'completed'
// from listOrchestrationTasks -- a fixed hardcoded task id would only ever
// match a real dispatch record by coincidence, silently leaving every
// wave stuck at WAVE_STILL_IN_FLIGHT instead of genuinely settling.
function okOrchestration() {
  let counter = 0
  // Pre-seeded with 'task-1' -- newRun() below manually constructs its
  // initial dispatch record with that fixed taskId (a real domain-level
  // dispatchWave call, bypassing this fake's own createOrchestrationTask),
  // so it must be recognized as completed too, not only ids this fake
  // itself allocated afterward.
  const createdTaskIds = new Set(['task-1'])
  return {
    createDispatcherTerminal: async () => ({
      ok: true,
      result: { terminal: { handle: 'fake-term' } }
    }),
    bindOrchestrationRun: async ({ id }) => ({ ok: true, result: { run: { id } } }),
    createOrchestrationRun: async () => ({ ok: true, result: { run: { id: 'orch-run-1' } } }),
    createOrchestrationTask: async () => {
      counter += 1
      const id = `task-${counter}`
      createdTaskIds.add(id)
      return { ok: true, result: { task: { id } } }
    },
    startOrchestrationWorker: async ({ task }) => ({
      ok: true,
      result: { taskId: task, dispatchId: `ctx-${task}`, state: 'ready', stage: 'input_accepted' }
    }),
    listOrchestrationTasks: async () => ({
      ok: true,
      result: { tasks: [...createdTaskIds].map((id) => ({ id, status: 'completed' })) }
    })
  }
}

function newRun(id, projectId, worktree) {
  let run = createOvernightRun(
    { id, projectId, originalGoal: 'Fix it.', acceptanceCriteria: ['A'], usageMode: 'BALANCED' },
    clock
  )
  const plan = planWave(run, [{ id: 'w1', scope: ['**/*'], worktree }], clock)
  run = dispatchWave(run, plan, [{ workItemId: 'w1', taskId: 'task-1' }], clock, run.revision)
  return run
}

// --- buildContinuationWorkItem ---

test('buildContinuationWorkItem produces a real, worktree-explicit item that instructs deleting the stale verdict', () => {
  const run = createOvernightRun(
    {
      id: 'run-1',
      projectId: 'p',
      originalGoal: 'Fix it.',
      acceptanceCriteria: ['A'],
      usageMode: 'BALANCED'
    },
    clock
  )
  const item = buildContinuationWorkItem(run, '/wt', [{ criterion: 'A', evidence: 'still fails' }])
  assert.equal(item.worktree, '/wt')
  assert.match(item.spec, /still fails/)
  assert.match(item.spec, /delete the file/i)
  assert.match(item.spec, new RegExp(verificationVerdictPath('run-1').replace(/\\/g, '\\\\')))
})

// --- driveOneCycle: routing ---

test("driveOneCycle skips a PLANNING run with no waves -- not this driver's job", async () => {
  const run = createOvernightRun(
    {
      id: 'r',
      projectId: 'p',
      originalGoal: 'x',
      acceptanceCriteria: ['A'],
      usageMode: 'BALANCED'
    },
    clock
  )
  const store = makeFakeStore({ p: run })
  const [result] = await driveOneCycle(['p'], clock, { store })
  assert.equal(result.action, 'SKIPPED')
  assert.match(result.reason, /awaiting an initial wave/)
})

test('driveOneCycle automatically resumes a run whose first-wave dispatch was refused by the Resource Pressure Governor, using the SAME durably-recorded candidateWorkItems -- no human re-supplies them', async () => {
  let run = createOvernightRun(
    { id: 'r', projectId: 'p', originalGoal: 'x', acceptanceCriteria: ['A'], usageMode: 'BALANCED' },
    clock
  )
  const pendingItems = [{ id: 'w1', scope: ['**/*'], worktree: '/wt' }]
  run = recordPendingDispatch(run, pendingItems, clock, 0)
  const store = makeFakeStore({ p: run })
  const tickDeps = { store, orchestration: okOrchestration() }

  const [result] = await driveOneCycle(['p'], clock, { store, tickDeps })
  assert.equal(result.action, 'RESUMED_PENDING_DISPATCH')
  // Real resources are HEALTHY in this test file (forced at top) -- the
  // resumed dispatch genuinely succeeds using the exact recorded items,
  // never a fabricated/different work item.
  assert.equal(result.tickResult.action, 'WAVE_DISPATCHED')
  const after = store.readRun('p')
  assert.equal(after.waves.length, 0, 'not settled yet, but a real wave is now in flight')
  assert.ok(after.inFlightWave)
  assert.equal(after.pendingDispatch, null, 'resolved the moment a real wave dispatched')
})

// TSF Overnight Control-Plane Burn-In V2, real finding (not guessed) --
// the most severe finding of the whole mission: this driver, the PRIMARY
// autonomous dispatch mechanism (ticks continuously for every ACTIVE
// project, independent of any chat/HTTP interaction), never checked
// project-execution-hold status at all. Live-reproduced before fixing
// (this exact scenario): the driver genuinely dispatched a real wave for
// a project under an active hold. Every other real dispatch-triggering
// surface (planAndDispatchFromChat, the adoption engine) already
// correctly refuses under a hold; this driver -- running far more
// frequently and requiring no human action to fire -- was a real, silent
// bypass of all of them.
test('real finding, FIXED: driveOneCycle refuses to resume a pending dispatch for a project under an active execution hold, never silently dispatching into it', async () => {
  let run = createOvernightRun(
    { id: 'r', projectId: 'p', originalGoal: 'x', acceptanceCriteria: ['A'], usageMode: 'BALANCED' },
    clock
  )
  const pendingItems = [{ id: 'w1', scope: ['**/*'], worktree: '/wt' }]
  run = recordPendingDispatch(run, pendingItems, clock, 0)
  const store = makeFakeStore({ p: run })
  const tickDeps = { store, orchestration: okOrchestration() }
  const readProjectExecutionHold = (projectId) => (projectId === 'p' ? activeHold('p', 'another agent is on this repo') : null)

  const [result] = await driveOneCycle(['p'], clock, { store, tickDeps, readProjectExecutionHold })
  assert.equal(result.action, 'SKIPPED')
  assert.match(result.reason, /project execution hold active/)
  assert.match(result.reason, /another agent is on this repo/)

  const after = store.readRun('p')
  assert.equal(after.inFlightWave, null, 'no real wave may be dispatched into a held project')
  assert.ok(after.pendingDispatch, 'the pending dispatch record must survive -- this is a deferral, not a loss of the durable retry record')
})

test('driveOneCycle still honestly skips a PLANNING run with no waves and no recorded pending dispatch -- never invents work to resume', async () => {
  const run = createOvernightRun(
    { id: 'r', projectId: 'p', originalGoal: 'x', acceptanceCriteria: ['A'], usageMode: 'BALANCED' },
    clock
  )
  assert.equal(run.pendingDispatch, null)
  const store = makeFakeStore({ p: run })
  const [result] = await driveOneCycle(['p'], clock, { store })
  assert.equal(result.action, 'SKIPPED')
  assert.match(result.reason, /awaiting an initial wave/)
})

test('driveOneCycle reports an unresolved Needs You question as the real skip reason, not a misleading "run state is ACTIVE" -- adversarial-review finding', async () => {
  const run = {
    ...createOvernightRun(
      {
        id: 'r',
        projectId: 'p',
        originalGoal: 'x',
        acceptanceCriteria: ['A'],
        usageMode: 'BALANCED'
      },
      clock
    ),
    needsYou: [{ id: 'q1', question: 'which way?', resolvedAt: null }]
  }
  const store = makeFakeStore({ p: run })
  const [result] = await driveOneCycle(['p'], clock, { store })
  assert.equal(result.action, 'SKIPPED')
  assert.match(result.reason, /Needs You/)
  assert.doesNotMatch(result.reason, /run state is ACTIVE/)
})

test('driveOneCycle settles a real in-flight wave', async () => {
  const dir = initRepo()
  const run = newRun('r', 'p', dir)
  const store = makeFakeStore({ p: run })
  const [result] = await driveOneCycle(['p'], clock, {
    store,
    tickDeps: { store, orchestration: okOrchestration() }
  })
  assert.equal(result.action, 'TICKED')
  assert.equal(result.tickResult.action, 'WAVE_SETTLED')
  assert.equal(store.all.p.inFlightWave, null)
})

// Deliberately the INVERSE of the two "real finding, FIXED" hold tests
// above: settling a wave already dispatched (possibly before any hold
// even existed) is never itself a new action a hold is meant to prevent
// -- only starting NEW work is gated. Proves the fix doesn't overreach.
test('an active execution hold does NOT block settling an already-in-flight wave -- only new dispatch decisions are gated', async () => {
  const dir = initRepo()
  const run = newRun('r', 'p', dir)
  const store = makeFakeStore({ p: run })
  const readProjectExecutionHold = (projectId) => (projectId === 'p' ? activeHold('p', 'another agent is on this repo') : null)

  const [result] = await driveOneCycle(['p'], clock, {
    store,
    tickDeps: { store, orchestration: okOrchestration() },
    readProjectExecutionHold
  })
  assert.equal(result.action, 'TICKED')
  assert.equal(result.tickResult.action, 'WAVE_SETTLED', 'settling already-in-flight work must proceed even while held')
  assert.equal(store.all.p.inFlightWave, null)
})

test('driveOneCycle reconciles a settled run and dispatches a real verification wave (Stage F handoff)', async () => {
  const dir = initRepo()
  // git --since compares at 1-second granularity -- without a real gap,
  // the repo's own 'initial' commit and this test's settle-checkpoint can
  // land in the same second and be misread as a late, unreconciled commit.
  await new Promise((resolve) => setTimeout(resolve, 1100))
  let run = newRun('r', 'p', dir)
  // Settle the initial wave synchronously first so this cycle finds a
  // genuinely settled, unowned run.
  const { tickKeepGoingRun } = await import('../server/keep-going-dispatch-loop.mjs')
  const tickDeps = { orchestration: okOrchestration() }
  const store = makeFakeStore({ p: run })
  tickDeps.store = store
  await tickKeepGoingRun('p', [], clock, tickDeps)
  assert.equal(store.all.p.inFlightWave, null)

  const [result] = await driveOneCycle(['p'], clock, { store, tickDeps })
  assert.equal(result.action, 'RECONCILED')
  assert.equal(result.reconciliation.action, 'DISPATCH_VERIFICATION')
  assert.equal(
    store.all.p.inFlightWave !== null,
    true,
    'a real verification wave is now genuinely in flight'
  )
})

test('driveOneCycle dispatches a real CONTINUATION wave when reconciliation finds unsatisfied criteria (not yet retry-exhausted)', async () => {
  const dir = initRepo()
  await new Promise((resolve) => setTimeout(resolve, 1100))
  let run = newRun('r', 'p', dir)
  const { tickKeepGoingRun } = await import('../server/keep-going-dispatch-loop.mjs')
  const store = makeFakeStore({ p: run })
  const tickDeps = { store, orchestration: okOrchestration() }
  await tickKeepGoingRun('p', [], clock, tickDeps) // settle initial wave

  // Simulate the real verification worker having already written a
  // verdict finding the criterion unsatisfied.
  mkdirSync(path.join(dir, 'docs', 'tsf', 'verification'), { recursive: true })
  writeFileSync(
    path.join(dir, verificationVerdictPath('r')),
    JSON.stringify({ criteria: [{ criterion: 'A', verified: false, evidence: 'still broken' }] })
  )

  const [result] = await driveOneCycle(['p'], clock, { store, tickDeps })
  assert.equal(result.action, 'RECONCILED_AND_CONTINUED')
  assert.equal(result.reconciliation.action, 'NEEDS_DECISION')
  assert.equal(result.continuationResult.action, 'WAVE_DISPATCHED')
  assert.equal(
    store.all.p.inFlightWave !== null,
    true,
    'a real continuation implementation wave is now in flight'
  )
})

test('real finding, FIXED: driveOneCycle refuses a real CONTINUATION wave for a project under an active execution hold, even though reconciliation itself still runs honestly', async () => {
  const dir = initRepo()
  await new Promise((resolve) => setTimeout(resolve, 1100))
  let run = newRun('r', 'p', dir)
  const { tickKeepGoingRun } = await import('../server/keep-going-dispatch-loop.mjs')
  const store = makeFakeStore({ p: run })
  const tickDeps = { store, orchestration: okOrchestration() }
  await tickKeepGoingRun('p', [], clock, tickDeps) // settle initial wave

  mkdirSync(path.join(dir, 'docs', 'tsf', 'verification'), { recursive: true })
  writeFileSync(
    path.join(dir, verificationVerdictPath('r')),
    JSON.stringify({ criteria: [{ criterion: 'A', verified: false, evidence: 'still broken' }] })
  )
  const readProjectExecutionHold = (projectId) => (projectId === 'p' ? activeHold('p', 'another agent is on this repo') : null)

  const [result] = await driveOneCycle(['p'], clock, { store, tickDeps, readProjectExecutionHold })
  // Reconciliation (real analysis of already-existing evidence, never a
  // new dispatch) still ran and reported the real, honest finding --
  // only the NEW dispatch that finding would otherwise trigger is
  // refused.
  assert.equal(result.action, 'RECONCILED')
  assert.equal(result.reconciliation.action, 'NEEDS_DECISION')
  assert.match(result.reason, /project execution hold active/)
  assert.equal(store.all.p.inFlightWave, null, 'no real continuation wave may be dispatched into a held project')
})

// REQUIRED PROOF (Main TSF integration review, admission-coverage
// inventory): this autonomous fleet driver's OWN heartbeat -- completely
// independent of chat, running on its own setInterval -- is exactly the
// path Job 1's original bounded correction missed (it only gated
// chat-dispatch-bridge.mjs directly). The gate now lives inside
// keep-going-dispatch-loop.mjs's own dispatchStep, so this driver's
// continuation dispatch is covered without this test file needing to know
// anything about HOW it's gated.
test('driveOneCycle: CRITICAL host memory defers a real CONTINUATION wave honestly -- WAITING_FOR_RESOURCES, never FAILED/STALLED, and the run stays ACTIVE for the very next cycle', async () => {
  const dir = initRepo()
  await new Promise((resolve) => setTimeout(resolve, 1100))
  let run = newRun('r', 'p', dir)
  const { tickKeepGoingRun } = await import('../server/keep-going-dispatch-loop.mjs')
  const store = makeFakeStore({ p: run })
  const tickDeps = { store, orchestration: okOrchestration() }
  await tickKeepGoingRun('p', [], clock, tickDeps) // settle initial wave

  mkdirSync(path.join(dir, 'docs', 'tsf', 'verification'), { recursive: true })
  writeFileSync(
    path.join(dir, verificationVerdictPath('r')),
    JSON.stringify({ criteria: [{ criterion: 'A', verified: false, evidence: 'still broken' }] })
  )

  const criticalTickDeps = {
    ...tickDeps,
    resourcePressure: { collectHostMemoryEvidence: () => ({ availableBytes: 1 * 1024 ** 3 }) } // EMERGENCY
  }
  const [result] = await driveOneCycle(['p'], clock, { store, tickDeps: criticalTickDeps })
  assert.equal(result.action, 'RECONCILED_AND_CONTINUED')
  assert.equal(result.continuationResult.action, 'DISPATCH_WAITING_FOR_RESOURCES')
  assert.equal(result.continuationResult.admitted, false)
  assert.equal(store.all.p.state, 'ACTIVE', 'the run itself is never paused or failed by a resource wait')
  assert.equal(store.all.p.inFlightWave, null, 'no wave was dispatched -- honestly nothing in flight, not a fabricated one')
  // Phase 12 (Durable State / Restart Gauntlet, category 8): the wait is now
  // durably checkpointed on the run itself -- a restarted backend (or an
  // operator reading recentCheckpointTrail) can see this run was genuinely
  // stuck on resource pressure, not merely un-ticked.
  assert.equal(store.all.p.checkpoints.at(-1)?.phase, 'DISPATCH_WAITING_FOR_RESOURCES')

  // Resources clear -- the very next cycle succeeds with no special resume
  // step, proving this is a per-tick condition, never a durable run state.
  const [recovered] = await driveOneCycle(['p'], clock, { store, tickDeps })
  assert.equal(recovered.continuationResult.action, 'WAVE_DISPATCHED')
})

// --- driveOneCycle: fleet properties ---

test('driveOneCycle: one project genuinely throwing never stops another from being processed', async () => {
  const dir = initRepo()
  const okRun = newRun('r-ok', 'ok-project', dir)
  // A genuinely malformed run (missing needsYou) makes isDriverEligible
  // itself throw a real TypeError -- proves driveOneCycle's per-project
  // try/catch actually isolates a real failure, not a contrived stub.
  const brokenRun = { ...newRun('r-broken', 'broken-project', dir), needsYou: undefined }
  const store = makeFakeStore({ 'ok-project': okRun, 'broken-project': brokenRun })
  const tickDeps = { store, orchestration: okOrchestration() }

  const results = await driveOneCycle(['broken-project', 'ok-project'], clock, { store, tickDeps })
  const byId = Object.fromEntries(results.map((r) => [r.projectId, r]))
  assert.equal(byId['ok-project'].action, 'TICKED')
  assert.equal(byId['broken-project'].action, 'ERROR')
  assert.match(byId['broken-project'].reason, /every/)
})

test('driveOneCycle respects a bounded concurrency cap, never running more than maxConcurrentTicks at once', async () => {
  // Five real in-flight runs, each settled via a real (fake-CLI-backed)
  // tick whose orchestration.listOrchestrationTasks call is artificially
  // slow and self-instrumenting -- this is where advanceOneProject
  // actually awaits real work, so it is the correct place to observe
  // genuine overlap (an eligibility-check-only fixture would return
  // synchronously and never exercise the pool's concurrency limiting at
  // all).
  let concurrent = 0
  let maxObserved = 0
  const projectIds = ['a', 'b', 'c', 'd', 'e']
  const runs = {}
  for (const id of projectIds) {
    runs[id] = newRun(`r-${id}`, id, initRepo())
  }
  const store = makeFakeStore(runs)
  const orchestration = {
    ...okOrchestration(),
    listOrchestrationTasks: async () => {
      concurrent += 1
      maxObserved = Math.max(maxObserved, concurrent)
      await new Promise((resolve) => setTimeout(resolve, 30))
      concurrent -= 1
      return { ok: true, result: { tasks: [{ id: 'task-1', status: 'completed' }] } }
    }
  }
  const results = await driveOneCycle(
    projectIds,
    clock,
    { store, tickDeps: { store, orchestration } },
    2
  )
  assert.equal(results.length, 5)
  assert.ok(maxObserved <= 2, `expected at most 2 concurrent, observed ${maxObserved}`)
  assert.ok(
    maxObserved >= 2,
    'the pool should genuinely use its full concurrency budget, not serialize unnecessarily'
  )
})

test('DEFAULT_MAX_CONCURRENT_TICKS is a real, small, deliberate fleet-wide throttle', () => {
  assert.equal(DEFAULT_MAX_CONCURRENT_TICKS, 2)
})

// --- startKeepGoingFleetDriver: the durable heartbeat itself ---

test('startKeepGoingFleetDriver fires on its own interval and can be stopped', async () => {
  let cycles = 0
  const driver = startKeepGoingFleetDriver({
    listEligibleProjectIds: () => [],
    intervalMs: 20,
    onCycle: () => {
      cycles += 1
    }
  })
  await new Promise((resolve) => setTimeout(resolve, 90))
  driver.stop()
  const countAtStop = cycles
  assert.ok(
    countAtStop >= 2,
    `expected multiple autonomous cycles with no external trigger, got ${countAtStop}`
  )
  await new Promise((resolve) => setTimeout(resolve, 60))
  assert.equal(cycles, countAtStop, 'no further cycles fire after stop()')
})

test('startKeepGoingFleetDriver never overlaps two cycles -- a slow cycle causes the next tick to be skipped, not queued', async () => {
  let started = 0
  let concurrentActive = 0
  let maxConcurrentActive = 0
  const driver = startKeepGoingFleetDriver({
    listEligibleProjectIds: async () => {
      started += 1
      concurrentActive += 1
      maxConcurrentActive = Math.max(maxConcurrentActive, concurrentActive)
      await new Promise((resolve) => setTimeout(resolve, 60))
      concurrentActive -= 1
      return []
    },
    intervalMs: 15
  })
  await new Promise((resolve) => setTimeout(resolve, 150))
  driver.stop()
  assert.equal(maxConcurrentActive, 1, 'overlapping cycles must never run concurrently')
  assert.ok(started >= 1)
})

test('startKeepGoingFleetDriver.fireNow runs one real cycle immediately, outside the interval schedule', async () => {
  let cycles = 0
  const driver = startKeepGoingFleetDriver({
    listEligibleProjectIds: () => [],
    intervalMs: 10_000_000, // effectively never fires on its own within this test
    onCycle: () => {
      cycles += 1
    }
  })
  await driver.fireNow()
  driver.stop()
  assert.equal(cycles, 1)
})

test('startKeepGoingFleetDriver reports listEligibleProjectIds failures via onError instead of throwing unhandled', async () => {
  let captured = null
  const driver = startKeepGoingFleetDriver({
    listEligibleProjectIds: () => {
      throw new Error('catalog unavailable')
    },
    intervalMs: 10_000_000,
    onError: (error) => {
      captured = error
    }
  })
  await driver.fireNow()
  driver.stop()
  assert.equal(captured.message, 'catalog unavailable')
})

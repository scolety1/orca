// Adversarial concurrency tests for the autonomous wave-dispatch loop's
// claim/commit primitive. Unlike keep-going-dispatch-loop.test.mjs's fast
// pure-logic tests (a fake in-memory store), these run against the REAL
// synchronous data-store.mjs (readFileSync/writeFileSync) via
// tsf/server/keep-going-run-store.mjs, isolated to a per-process temp file
// -- the atomicity claim ("a function with no await between load and save
// cannot be interleaved") is a claim about Node's real single-threaded
// event loop and real fs calls, not something a purely in-memory fake can
// prove on its own.
import assert from 'node:assert/strict'
import test from 'node:test'
import path from 'node:path'
import { rmSync } from 'node:fs'

const HERE = import.meta.dirname
const STATE_FILE = path.join(
  HERE,
  '..',
  'server',
  '.local-state',
  `operator-state.test-keep-going-concurrency-${process.pid}.json`
)
process.env.TSF_UI_STATE_FILE = STATE_FILE
// M5: see keep-going-dispatch-loop.test.mjs's own identical comment --
// dispatchStep's new real capacity check shares orca-orchestration-
// bridge.mjs's TSF_ORCA_CLI_COMMAND resolution; pointing it at the stub
// CLI keeps every test here fast and hermetic (and, since the capacity
// check runs strictly after claim() per dispatchStep's own ordering, adds
// no new timing hazard to the real claim/commit atomicity this file
// tests).
process.env.TSF_ORCA_CLI_COMMAND = path.join(HERE, 'fixtures', 'stub-orca-cli.mjs')
process.env.STUB_ORCA_MODE = 'success'

const { createOvernightRun, claimTick, releaseTick, dispatchWave, pauseRun, planWave } =
  await import('../domain/keep-going.mjs')
const { readKeepGoingRun, withKeepGoingRun } = await import('../server/keep-going-run-store.mjs')
const { tickKeepGoingRun } = await import('../server/keep-going-dispatch-loop.mjs')

const PROJECT_ID = 'fixture:concurrency-proj'
const clock = () => new Date('2026-08-20T06:00:00.000Z')

async function seedRun(overrides = {}) {
  const run = createOvernightRun(
    {
      id: 'run-concurrency-1',
      projectId: PROJECT_ID,
      originalGoal: 'Prove the concurrency model against the real store.',
      acceptanceCriteria: ['CRITERION_A'],
      usageMode: 'BALANCED',
      ...overrides
    },
    clock
  )
  await withKeepGoingRun(PROJECT_ID, () => run)
  return run
}

function okOrchestration(overrides = {}) {
  return {
    bindOrchestrationRun: async ({ id }) => ({ ok: true, result: { run: { id } } }),
    createOrchestrationRun: async () => ({ ok: true, result: { run: { id: 'orch-run-1' } } }),
    createOrchestrationTask: async ({ taskTitle }) => ({
      ok: true,
      result: { task: { id: `task-${taskTitle}` } }
    }),
    startOrchestrationWorker: async ({ task }) => ({
      ok: true,
      result: { taskId: task, dispatchId: `ctx-${task}`, state: 'ready', stage: 'input_accepted' }
    }),
    listOrchestrationTasks: async () => ({ ok: true, result: { tasks: [] } }),
    ...overrides
  }
}

// Explicit worktree -- there is no safe default (a real review finding:
// an omitted worktree used to silently fall back to 'current', the
// coordinator's own working directory).
const oneItem = [{ id: 't1', scope: ['src/a.mjs'], worktree: 'C:/repo/wt1' }]

test.afterEach(() => {
  rmSync(STATE_FILE, { force: true })
  rmSync(`${STATE_FILE}.tmp`, { force: true })
  rmSync(`${STATE_FILE}.lock`, { force: true })
})

// --- Requirement: test two ticks attempting to act on the same run ---

test('two ticks racing the real store: the second is rejected before touching orchestration, no duplicate dispatch', async () => {
  await seedRun()
  let taskCreateCalls = 0
  const orchestration = okOrchestration({
    createOrchestrationTask: async ({ taskTitle }) => {
      taskCreateCalls += 1
      return { ok: true, result: { task: { id: `task-${taskTitle}` } } }
    }
  })
  // The cross-process file lock's acquire phase is async (a real review
  // finding: the old fully-synchronous claim path made tickB's ordering
  // relative to tickA deterministic; the async lock reopened a real
  // timing window where tickB's claim could run AFTER tickA's entire
  // dispatch already committed, not just while tickA's lock was still
  // held). Either honest rejection reason is acceptable here -- what this
  // test actually requires is that exactly ONE real Orca task is ever
  // created, never two.
  const tickA = tickKeepGoingRun(PROJECT_ID, oneItem, clock, { orchestration })
  const resultB = await tickKeepGoingRun(PROJECT_ID, oneItem, clock, { orchestration })
  const resultA = await tickA

  assert.equal(resultB.action, 'DISPATCH_CLAIM_FAILED')
  assert.ok(
    resultB.reason === 'TSF_TICK_IN_PROGRESS' || resultB.reason === 'TSF_STALE_ROUTING_DECISION',
    `expected an honest claim rejection, got reason=${resultB.reason}`
  )
  assert.equal(resultA.action, 'WAVE_DISPATCHED')
  assert.equal(taskCreateCalls, 1, 'only the winning tick ever created a real Orca task')

  const persisted = readKeepGoingRun(PROJECT_ID)
  assert.equal(persisted.inFlightWave.dispatchRecords.length, 1)
  assert.equal(persisted.tickLock, null, 'the winner released the lock on commit')
})

test('two SETTLE ticks racing an already-in-flight wave: only one processes the real worker result', async () => {
  await seedRun()
  await tickKeepGoingRun(PROJECT_ID, oneItem, clock, { orchestration: okOrchestration() })
  let taskListCalls = 0
  const orchestration = okOrchestration({
    listOrchestrationTasks: async () => {
      taskListCalls += 1
      return { ok: true, result: { tasks: [{ id: 'task-t1', status: 'completed' }] } }
    }
  })
  // Either honest rejection reason is acceptable (see the DISPATCH-side
  // test above for why the async lock reopened this timing window) --
  // what actually matters is that only one tick ever polls task-list and
  // records the settlement.
  const tickA = tickKeepGoingRun(PROJECT_ID, oneItem, clock, { orchestration })
  const resultB = await tickKeepGoingRun(PROJECT_ID, oneItem, clock, { orchestration })
  const resultA = await tickA

  assert.equal(resultB.action, 'SETTLE_CLAIM_FAILED')
  assert.ok(
    resultB.reason === 'TSF_TICK_IN_PROGRESS' || resultB.reason === 'TSF_STALE_ROUTING_DECISION',
    `expected an honest claim rejection, got reason=${resultB.reason}`
  )
  assert.equal(resultA.action, 'WAVE_SETTLED')
  assert.equal(taskListCalls, 1, 'only the winning tick ever polled task-list')

  const persisted = readKeepGoingRun(PROJECT_ID)
  assert.equal(persisted.waves.length, 1, 'the completed wave was recorded exactly once')
})

// --- Requirement: test pause arriving mid-tick ---

test('a pause request arriving while a tick holds the lock is rejected, not silently dropped or silently overridden', async () => {
  await seedRun()
  // Claim the lock the same way dispatchStep's first step does, simulating
  // a tick that is mid-flight (holding the lock while awaiting real CLI
  // round-trips it hasn't finished yet).
  const claimed = await withKeepGoingRun(PROJECT_ID, (current) =>
    claimTick(current, 'DISPATCH', clock, current.revision)
  )

  // A pause request landing on the SAME real store while the lock is held
  // -- simulating what a hardened pause endpoint does: fresh read, apply
  // pauseRun, write back, all through the one synchronous CAS primitive.
  // withKeepGoingRun is async (the cross-process lock acquire), so the
  // domain-level TSF_TICK_IN_PROGRESS rejection now surfaces as a rejected
  // promise, not a synchronous throw -- assert.rejects, not assert.throws.
  await assert.rejects(
    () =>
      withKeepGoingRun(PROJECT_ID, (current) =>
        pauseRun(current, 'operator pause', clock, current.revision)
      ),
    (error) => error.code === 'TSF_TICK_IN_PROGRESS'
  )
  // The rejection must not have mutated persisted state at all.
  const stillLocked = readKeepGoingRun(PROJECT_ID)
  assert.equal(stillLocked.revision, claimed.revision, 'the rejected pause attempt wrote nothing')
  assert.equal(
    stillLocked.state,
    'ACTIVE',
    'still ACTIVE -- pause did not silently apply underneath the tick'
  )

  // The tick can still complete normally and release the lock afterward.
  const released = await withKeepGoingRun(PROJECT_ID, (current) =>
    releaseTick(current, clock, current.revision)
  )
  assert.equal(released.tickLock, null)

  // Now that the lock is clear, the SAME pause request succeeds -- it was
  // rejected, not permanently lost.
  const paused = await withKeepGoingRun(PROJECT_ID, (current) =>
    pauseRun(current, 'operator pause', clock, current.revision)
  )
  assert.equal(paused.state, 'PAUSED')
})

test('a full tick still completes correctly even after a concurrent pause attempt was rejected mid-flight', async () => {
  await seedRun()
  const orchestration = okOrchestration({
    createOrchestrationTask: async ({ taskTitle }) => {
      // Simulate a pause request arriving WHILE this tick's real CLI work
      // is in flight -- must be rejected without disturbing the tick.
      await assert.rejects(
        () =>
          withKeepGoingRun(PROJECT_ID, (current) =>
            pauseRun(current, 'operator pause', clock, current.revision)
          ),
        (error) => error.code === 'TSF_TICK_IN_PROGRESS'
      )
      return { ok: true, result: { task: { id: `task-${taskTitle}` } } }
    }
  })
  const result = await tickKeepGoingRun(PROJECT_ID, oneItem, clock, { orchestration })
  assert.equal(result.action, 'WAVE_DISPATCHED')
  const persisted = readKeepGoingRun(PROJECT_ID)
  assert.equal(
    persisted.state,
    'ACTIVE',
    'the tick completed as if the pause attempt never happened'
  )
  assert.equal(persisted.inFlightWave.dispatchRecords.length, 1)
})

// --- Requirement: test stale revision after an Orca Run/task has already
// been created, so cleanup/persistence remains correct ---

test("a tick that loses its lock to abandonment-recovery after creating real Orca resources reports the conflict honestly without corrupting the winner's state", async () => {
  await seedRun()
  const clockA = clock
  // Tick A claims the lock and (conceptually) goes on to do real CLI work
  // -- simulated here directly via the exported primitives, since we need
  // to hold A's claimed revision open across a controlled clock jump
  // rather than letting a real orchestration call resolve immediately.
  const claimedA = await withKeepGoingRun(PROJECT_ID, (current) =>
    claimTick(current, 'DISPATCH', clockA, current.revision)
  )
  const wavePlan = planWave({ ...claimedA, waves: [] }, oneItem, clockA)
  const dispatchRecordsA = [
    { workItemId: 't1', scope: ['src/a.mjs'], taskId: 'task-t1', dispatchId: 'ctx-1' }
  ]

  // A's lock is now old enough to be treated as abandoned -- tick B
  // legitimately recovers it (a crashed/hung-tick recovery, not a bug).
  const muchLater = () => new Date('2026-08-20T06:10:00.000Z') // 10 minutes later
  const claimedB = await withKeepGoingRun(PROJECT_ID, (current) =>
    claimTick(current, 'DISPATCH', muchLater, current.revision)
  )
  assert.ok(claimedB.revision > claimedA.revision)

  // Tick A, unaware it lost the lock, finally attempts its commit using
  // the revision IT claimed -- this must fail loudly (not silently
  // overwrite tick B's now-current claim), and must not touch persisted
  // state at all.
  await assert.rejects(
    () =>
      withKeepGoingRun(PROJECT_ID, (current) =>
        dispatchWave(current, wavePlan, dispatchRecordsA, clockA, claimedA.revision)
      ),
    (error) => error.code === 'TSF_STALE_REVISION'
  )

  // Persisted state must still reflect exactly what B established --
  // uncorrupted by A's failed, stale commit attempt. This is the
  // "cleanup/persistence remains correct" property: A's real Orca
  // resources (task-t1, ctx-1 in this scenario) are not silently adopted
  // into the run by a losing commit, and B's legitimate claim is not
  // clobbered either.
  const persisted = readKeepGoingRun(PROJECT_ID)
  assert.equal(persisted.revision, claimedB.revision)
  assert.equal(persisted.tickLock.kind, 'DISPATCH')
  assert.equal(persisted.tickLock.claimedAt, claimedB.tickLock.claimedAt)
  assert.equal(persisted.inFlightWave, null, "A's dispatch was never recorded onto the run")
})

test('tickKeepGoingRun itself reports a *_LOST_LOCK result (not a thrown exception) when its own commit loses the CAS race', async () => {
  await seedRun()
  // Drive a real tick, but have its orchestration fake steal the lock out
  // from under it mid-flight (simulating an abnormally slow tick whose
  // lock timed out and was recovered by another actor before this tick's
  // own commit ran).
  const orchestration = okOrchestration({
    createOrchestrationTask: async ({ taskTitle }) => {
      const muchLater = () => new Date('2026-08-20T06:10:00.000Z')
      await withKeepGoingRun(PROJECT_ID, (current) =>
        claimTick(current, 'DISPATCH', muchLater, current.revision)
      )
      return { ok: true, result: { task: { id: `task-${taskTitle}` } } }
    }
  })
  const result = await tickKeepGoingRun(PROJECT_ID, oneItem, clock, { orchestration })
  assert.equal(result.action, 'WAVE_DISPATCHED_LOST_LOCK')
  assert.equal(result.reason, 'TSF_STALE_REVISION')
  // The orphaned dispatch info is surfaced, not silently swallowed.
  assert.equal(result.dispatchRecords.length, 1)
  assert.equal(result.dispatchRecords[0].taskId, 'task-t1')

  // Persisted state reflects the recovering claim, not this tick's lost work.
  const persisted = readKeepGoingRun(PROJECT_ID)
  assert.equal(persisted.inFlightWave, null)
  assert.equal(persisted.tickLock.kind, 'DISPATCH')
})

// Mirrors the DISPATCH-side abandonment-recovery test above on the SETTLE
// path specifically -- a real, confirmed review finding was that the
// settle-side commit closures (recordTaskAttempt's first call,
// settleInFlightWave, markStalled) previously threaded a mutation's own
// self-consistent revision instead of the claim-time revision, which is a
// tautology that can never catch this exact scenario.
test('a SETTLE tick that loses its lock to abandonment-recovery reports *_LOST_LOCK instead of silently completing a stale settlement', async () => {
  await seedRun()
  await tickKeepGoingRun(PROJECT_ID, oneItem, clock, { orchestration: okOrchestration() })

  const orchestration = okOrchestration({
    listOrchestrationTasks: async () => {
      const muchLater = () => new Date('2026-08-20T06:10:00.000Z')
      await withKeepGoingRun(PROJECT_ID, (current) =>
        claimTick(current, 'SETTLE', muchLater, current.revision)
      )
      return { ok: true, result: { tasks: [{ id: 'task-t1', status: 'completed' }] } }
    }
  })
  const result = await tickKeepGoingRun(PROJECT_ID, oneItem, clock, { orchestration })
  assert.equal(result.action, 'WAVE_SETTLED_LOST_LOCK')
  assert.equal(result.reason, 'TSF_STALE_REVISION')

  // Persisted state reflects the recovering claim -- the wave was NOT
  // settled twice, and the recovering tick's own claim is intact.
  const persisted = readKeepGoingRun(PROJECT_ID)
  assert.equal(
    persisted.waves.length,
    0,
    'the stale settle attempt must not have recorded the wave'
  )
  assert.ok(persisted.inFlightWave, 'the wave is still in flight under the recovering claim')
  assert.equal(persisted.tickLock.kind, 'SETTLE')
})

// The WAVE_STALLED escalation path specifically -- markStalled previously
// had no expectedRevision parameter at all (zero protection, not even the
// tautological self-check the other paths had).
test("a stall escalation that loses its lock to abandonment-recovery reports *_LOST_LOCK instead of stealing the recovering tick's lock", async () => {
  await seedRun({ budget: { stallThresholdMs: 60_000 } })
  await tickKeepGoingRun(PROJECT_ID, oneItem, clock, { orchestration: okOrchestration() })

  const laterClock = () => new Date('2026-08-20T06:05:00.000Z') // past the stall threshold
  const orchestration = okOrchestration({
    listOrchestrationTasks: async () => {
      const muchLater = () => new Date('2026-08-20T06:10:00.000Z')
      await withKeepGoingRun(PROJECT_ID, (current) =>
        claimTick(current, 'SETTLE', muchLater, current.revision)
      )
      return { ok: true, result: { tasks: [{ id: 'task-t1', status: 'in_progress' }] } }
    }
  })
  const result = await tickKeepGoingRun(PROJECT_ID, oneItem, laterClock, { orchestration })
  assert.equal(result.action, 'WAVE_STALLED_LOST_LOCK')
  assert.equal(result.reason, 'TSF_STALE_REVISION')

  const persisted = readKeepGoingRun(PROJECT_ID)
  assert.equal(persisted.state, 'ACTIVE', 'the stale STALLED attempt must not have applied')
  assert.equal(persisted.tickLock.kind, 'SETTLE', "the recovering tick's lock must survive intact")
})

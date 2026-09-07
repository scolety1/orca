// Phase 8 (Planner Lifecycle Chaos Test): Finding F22's own crash-mid-dispatch
// test (planner-session-lifecycle-crash-mid-dispatch.test.mjs) proves the
// dispatch-attempt ledger against a SIMULATED crash -- it patches _mutate's
// call count to force the exact commit-order timing deterministically. That
// is a real, valid proof of the ledger's own logic, but it never exercises a
// genuinely different, organically-timed scenario the mission brief asks
// about: a real dispatchWorker() call that is still in flight -- planner A
// has NOT crashed, it is still alive and waiting -- exactly when its OWN
// lease genuinely expires (real TTL, real wall-clock time) and a real
// successor takes over. Does the ledger + lease enforcement combination
// still hold with no synthetic timing, or was F22's fix only proven against
// the narrower single-planner-crash shape?
import assert from 'node:assert/strict'
import test from 'node:test'
import { rmSync } from 'node:fs'
import path from 'node:path'

const HERE = import.meta.dirname
const STATE_FILE = path.join(HERE, '..', 'server', '.local-state', `operator-state.test-dispatch-lease-handoff-${process.pid}.json`)
process.env.TSF_UI_STATE_FILE = STATE_FILE

const { PlannerSessionLifecycle } = await import('../server/planner-session-lifecycle.mjs')
const { readPlannerMissionRecord } = await import('../server/planner-mission-store.mjs')
const { classifyPlannerDispatchAmbiguity } = await import('../domain/planner-mission-checkpoint.mjs')

function cleanupStateFile() {
  for (const suffix of ['', '.tmp', '.planner-mission.lock']) { rmSync(`${STATE_FILE}${suffix}`, { force: true }) }
}
cleanupStateFile()

const GB = 1024 ** 3
const fakeHealthyMemory = () => ({ totalBytes: 16 * GB, freeBytes: 8 * GB, availableBytes: 8 * GB, usedPercent: 50 })
const REPO_STATE = { branch: 'tsf/feature/fixture-dispatch-lease-handoff', sha: 'b'.repeat(40), worktreePath: 'C:/fixture/worktree' }
const wallClock = () => new Date()
const MISSION_ID = 'mission:dispatch-lease-handoff-fixture'

test('a real provider dispatch call still in flight exactly when its planner\'s lease genuinely expires and a real successor takes over: no double-spend, honest ambiguity, no silently-lost or silently-landed result', async (t) => {
  try {
    let dispatchCallCount = 0
    async function slowRealDispatcher({ taskId }) {
      dispatchCallCount += 1
      await new Promise((resolve) => setTimeout(resolve, 400)) // genuinely slow real provider call
      return { workerId: `worker-${taskId}-${dispatchCallCount}` }
    }

    const plannerA = new PlannerSessionLifecycle({
      missionId: MISSION_ID,
      plannerSessionId: 'planner-A',
      deps: { clock: wallClock, collectHostMemoryEvidence: fakeHealthyMemory, dispatchWorker: slowRealDispatcher, leaseTtlMs: 200 }
    })
    await plannerA.startMission({ missionGoal: 'dispatch lease handoff fixture', phase: 'BUILD', repoState: REPO_STATE })

    // A's real dispatch call starts NOW, while its lease is genuinely live --
    // it is still in flight when the lease's real 200ms TTL elapses (nothing
    // auto-renews a lease mid-dispatch).
    const aDispatchPromise = plannerA.dispatchWorkerForTask({ taskId: 'task-1', kind: 'FIXTURE_WORKER' })

    await t.test('a real successor takes over via genuine TTL expiry WHILE A\'s dispatch call is still in flight (A has not crashed -- it is still running, just no longer authoritative)', async () => {
      await new Promise((resolve) => setTimeout(resolve, 250)) // past A's 200ms TTL, before its 400ms dispatch call returns
      const plannerB = new PlannerSessionLifecycle({
        missionId: MISSION_ID,
        plannerSessionId: 'planner-B',
        deps: { clock: wallClock, collectHostMemoryEvidence: fakeHealthyMemory, dispatchWorker: slowRealDispatcher, observeRepoState: () => REPO_STATE }
      })
      await plannerB.acquireLeaseAndHydrate()

      // B sees A's durable, still-UNKNOWN attempt and correctly refuses to
      // redispatch the same task -- no double-spend under this realer timing.
      await assert.rejects(
        plannerB.dispatchWorkerForTask({ taskId: 'task-1', kind: 'FIXTURE_WORKER' }),
        (error) => error.code === 'TSF_PLANNER_DISPATCH_AMBIGUOUS'
      )
    })

    await t.test('A\'s own dispatch call -- whose real provider call genuinely succeeded -- is refused at the commit step: honest ambiguity, not a silently-lost or silently-landed result', async () => {
      await assert.rejects(aDispatchPromise, (error) => error.code === 'TSF_PLANNER_LEASE_NOT_HELD')
    })

    await t.test('the real dispatcher fired exactly once -- no double-spend under this timing either', () => {
      assert.equal(dispatchCallCount, 1)
    })

    await t.test('the durable record shows the honest crash-adjacent signature: one unresolved attempt, no registered worker', () => {
      const record = readPlannerMissionRecord(MISSION_ID)
      assert.equal(Object.keys(record.checkpoint.workers).length, 0)
      assert.equal(record.checkpoint.dispatchAttempts.length, 1)
      assert.equal(record.checkpoint.dispatchAttempts[0].outcome, 'UNKNOWN')
      const ambiguity = classifyPlannerDispatchAmbiguity(record.checkpoint, 'task-1')
      assert.equal(ambiguity.ambiguous, true)
    })
  } finally {
    cleanupStateFile()
  }
})

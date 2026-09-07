// Phase 11 (Provider/Worker Resilience) finding: the golden rollover test
// (planner-session-lifecycle-golden-rollover.test.mjs) only proves "no
// re-dispatch after a CLEAN rollover" -- a prior planner fully committed
// registerDispatchedWorker before retiring. It never exercised the window
// BETWEEN a real deps.dispatchWorker() call returning and that commit
// landing durably -- a real crash there left NO trace the call was ever
// attempted, so a successor session would call the real dispatcher again:
// a genuine double-spend of dispatch capacity/provider calls. Reproduced
// here directly against dispatchWorkerForTask (not a synthetic scenario),
// then proven fixed by the same real method.
import assert from 'node:assert/strict'
import test from 'node:test'
import { rmSync } from 'node:fs'
import path from 'node:path'

const HERE = import.meta.dirname
const STATE_FILE = path.join(HERE, '..', 'server', '.local-state', `operator-state.test-crash-mid-dispatch-${process.pid}.json`)
process.env.TSF_UI_STATE_FILE = STATE_FILE

const { PlannerSessionLifecycle } = await import('../server/planner-session-lifecycle.mjs')
const { readPlannerMissionRecord } = await import('../server/planner-mission-store.mjs')

function cleanupStateFile() {
  for (const suffix of ['', '.tmp', '.planner-mission.lock']) { rmSync(`${STATE_FILE}${suffix}`, { force: true }) }
}
cleanupStateFile()

const GB = 1024 ** 3
const clock = () => new Date('2026-09-06T12:00:00.000Z')
const fakeHealthyMemory = () => ({ totalBytes: 16 * GB, freeBytes: 8 * GB, availableBytes: 8 * GB, usedPercent: 50 })
const MISSION_ID = 'mission:crash-mid-dispatch-fixture'
const FIXTURE_REPO_STATE = { branch: 'tsf/feature/fixture-crash-mid-dispatch', sha: 'e'.repeat(40), worktreePath: 'C:/fixture/worktree' }

test('a real crash between dispatchWorker() returning and the durable commit is now detected as ambiguous, not blindly redispatched', async (t) => {
  try {
    let dispatchCallCount = 0
    // Models a real external dispatcher (e.g. Orca orchestration, or a
    // future direct invokeLiveStructuredAnalysis-backed worker dispatch)
    // that genuinely succeeds -- the process crashes AFTER this, simulated
    // below by patching _mutate to fail on the very next call only.
    async function realDispatcher() {
      dispatchCallCount += 1
      return { workerId: `worker-${dispatchCallCount}` }
    }

    const plannerA = new PlannerSessionLifecycle({
      missionId: MISSION_ID,
      plannerSessionId: 'planner-A',
      deps: { clock, collectHostMemoryEvidence: fakeHealthyMemory, dispatchWorker: realDispatcher }
    })
    await plannerA.startMission({ missionGoal: 'ship the fixture feature', phase: 'BUILD', repoState: FIXTURE_REPO_STATE })

    await t.test('the crash: the real dispatch call succeeds, but the post-dispatch commit never lands (simulated process death)', async () => {
      // Patches _mutate to fail on its SECOND call only within this one
      // dispatchWorkerForTask invocation -- the first call is the real,
      // pre-flight recordDispatchAttempt commit (this MUST still land
      // durably, exactly like a real crash a moment later would leave it);
      // the second is the post-dispatch resolve+register commit, which a
      // real crash right here would also never reach.
      const realMutate = plannerA._mutate.bind(plannerA)
      let mutateCalls = 0
      plannerA._mutate = async (fn) => {
        mutateCalls += 1
        if (mutateCalls === 2) { throw new Error('simulated process crash before the post-dispatch commit') }
        return realMutate(fn)
      }
      await assert.rejects(
        plannerA.dispatchWorkerForTask({ taskId: 'task-1', kind: 'FIXTURE_WORKER' }),
        /simulated process crash/
      )
      plannerA._mutate = realMutate
      assert.equal(dispatchCallCount, 1, 'the real dispatcher genuinely fired exactly once before the simulated crash')
    })

    await t.test('the durable record shows an unresolved attempt and no registered worker -- the honest crash signature', () => {
      const record = readPlannerMissionRecord(MISSION_ID)
      assert.equal(Object.keys(record.checkpoint.workers).length, 0, 'no worker was ever durably registered')
      assert.equal(record.checkpoint.dispatchAttempts.length, 1)
      assert.equal(record.checkpoint.dispatchAttempts[0].outcome, 'UNKNOWN')
    })

    await t.test('a successor session refuses to redispatch the same task -- ambiguous, not blindly retried', async () => {
      await plannerA.relinquish()
      const plannerB = new PlannerSessionLifecycle({
        missionId: MISSION_ID,
        plannerSessionId: 'planner-B',
        deps: {
          clock,
          collectHostMemoryEvidence: fakeHealthyMemory,
          dispatchWorker: realDispatcher,
          observeRepoState: () => FIXTURE_REPO_STATE
        }
      })
      await plannerB.acquireLeaseAndHydrate()
      await assert.rejects(
        plannerB.dispatchWorkerForTask({ taskId: 'task-1', kind: 'FIXTURE_WORKER' }),
        (error) => error.code === 'TSF_PLANNER_DISPATCH_AMBIGUOUS'
      )
      // THE closure proof: the real dispatcher was never called a second
      // time. Before this fix, this assertion would fail (count === 2) --
      // this is the real gap this finding closes, not a hypothetical.
      assert.equal(dispatchCallCount, 1, 'no double-dispatch: the real external dispatcher must never be called a second time for an ambiguous attempt')
    })

    await t.test('once a human reconciles it (e.g. relinquish + a fresh mission would be the real operator path), a genuinely NEW taskFingerprint is unaffected', async () => {
      const plannerC = new PlannerSessionLifecycle({
        missionId: MISSION_ID,
        plannerSessionId: 'planner-C-via-B-lease',
        deps: { clock, collectHostMemoryEvidence: fakeHealthyMemory, dispatchWorker: realDispatcher }
      })
      // Not a real lease holder for this mission -- proves the ambiguity
      // classification itself (not lease enforcement) is what this test
      // targets, by exercising the pure classifier directly against the
      // same durable checkpoint a fresh dispatch for an UNRELATED task
      // would see.
      const record = readPlannerMissionRecord(MISSION_ID)
      const { classifyPlannerDispatchAmbiguity } = await import('../domain/planner-mission-checkpoint.mjs')
      assert.equal(classifyPlannerDispatchAmbiguity(record.checkpoint, 'task-2-never-attempted'), null, 'a genuinely different task is never contaminated by another task\'s ambiguity')
      void plannerC
    })
  } finally {
    cleanupStateFile()
  }
})

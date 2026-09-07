// GOLDEN FORCED-ROLLOVER DOGFOOD -- the V0 acceptance proof for
// PLANNER_CONTEXT_LIFECYCLE_V0 ("the mission outlives the planner
// session"). A small synthetic/fixture mission (never a real NWR/production
// mission, per the phase instructions): "planner A" starts it, dispatches a
// real (fixture) worker, records a Needs-You item, checkpoints, and
// relinquishes -- simulating a forced rollover (context exhaustion/session
// end). "planner B" is a GENUINELY SEPARATE object -- its own
// PlannerSessionLifecycle instance, constructed fresh, sharing no in-memory
// reference with planner A except the fixture dispatcher function (which
// models a real external dispatch mechanism/provider, not planner state)
// and the wall clock. Planner B acquires the lease, hydrates entirely from
// the durable file-backed store, sees the dispatched worker and Needs-You
// item, proves it does NOT re-dispatch, and drives the mission to COMPLETE.
import assert from 'node:assert/strict'
import test from 'node:test'
import { rmSync } from 'node:fs'
import path from 'node:path'

const HERE = import.meta.dirname
const STATE_FILE = path.join(HERE, '..', 'server', '.local-state', `operator-state.test-golden-rollover-${process.pid}.json`)
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
const MISSION_ID = 'mission:golden-forced-rollover-fixture'
const FIXTURE_REPO_STATE = { branch: 'tsf/feature/fixture-golden-rollover', sha: 'f'.repeat(40), worktreePath: 'C:/fixture/worktree' }

test('golden forced-rollover dogfood: planner B resumes planner A\'s mission with zero re-dispatch, zero lost state', async (t) => {
  try {
    // The real dispatch/tracking mechanism the test proves against -- a
    // shared side-channel modeling an external worker provider (its call
    // count IS the "no duplicate dispatch" oracle), not shared planner state.
    let dispatchCallCount = 0
    const dispatchedTaskIds = []
    async function fixtureDispatchWorker({ taskId }) {
      dispatchCallCount += 1
      dispatchedTaskIds.push(taskId)
      return { workerId: `worker-${taskId}` }
    }

    let workerIdFromA
    let needsYouIdFromA

    await t.test('planner A starts the mission, dispatches a real fixture worker, raises a Needs-You item, checkpoints, and relinquishes', async () => {
      const plannerA = new PlannerSessionLifecycle({
        missionId: MISSION_ID,
        plannerSessionId: 'planner-A',
        deps: { clock, collectHostMemoryEvidence: fakeHealthyMemory, dispatchWorker: fixtureDispatchWorker }
      })

      const checkpoint = await plannerA.startMission({ missionGoal: 'ship the fixture feature', phase: 'BUILD', repoState: FIXTURE_REPO_STATE })
      assert.equal(checkpoint.missionState, 'ACTIVE')

      const dispatch = await plannerA.dispatchWorkerForTask({ taskId: 'task-1', kind: 'FIXTURE_WORKER' })
      assert.equal(dispatch.alreadyDispatched, false)
      assert.equal(dispatchCallCount, 1, 'exactly one real dispatch must have occurred')
      workerIdFromA = dispatch.worker.workerId

      await plannerA.raiseNeedsYou({ question: 'ok to proceed with the risky migration step?', category: 'DESTRUCTIVE_ACTION_CONFIRMATION' })
      needsYouIdFromA = plannerA.getNeedsYou()[0].id

      await plannerA.checkpoint({
        lastAction: { type: 'DISPATCHED_FIXTURE_WORKER_AND_RAISED_NEEDS_YOU' },
        nextIntendedAction: { type: 'AWAIT_WORKER_RESULT_THEN_RESOLVE_NEEDS_YOU', description: 'wait for task-1, then resolve the migration confirmation' }
      })

      const relinquished = await plannerA.relinquish()
      assert.equal(relinquished.released, true, 'planner A must be able to cleanly relinquish its own lease')
    })

    await t.test('the durable record on disk reflects planner A\'s work with no live lease holder', () => {
      const record = readPlannerMissionRecord(MISSION_ID)
      assert.equal(record.lease, null)
      assert.equal(Object.keys(record.checkpoint.workers).length, 1)
      assert.equal(record.checkpoint.needsYou.length, 1)
    })

    await t.test('a stale planner A can no longer mutate after relinquishing -- single-writer holds even against its own former holder', async () => {
      const staleA = new PlannerSessionLifecycle({
        missionId: MISSION_ID,
        plannerSessionId: 'planner-A',
        deps: { clock, collectHostMemoryEvidence: fakeHealthyMemory, dispatchWorker: fixtureDispatchWorker }
      })
      await assert.rejects(staleA.recordDecision({ summary: 'x', kind: 'ACCEPTED' }), (error) => error.code === 'TSF_PLANNER_LEASE_NOT_HELD')
    })

    await t.test('planner B -- a genuinely fresh, independent object with no shared in-memory state -- acquires the lease and hydrates', async () => {
      const plannerB = new PlannerSessionLifecycle({
        missionId: MISSION_ID,
        plannerSessionId: 'planner-B',
        deps: {
          clock,
          collectHostMemoryEvidence: fakeHealthyMemory,
          dispatchWorker: fixtureDispatchWorker,
          observeRepoState: () => FIXTURE_REPO_STATE // simulates planner B genuinely checking out the same canonical repo state
        }
      })

      const hydrated = await plannerB.acquireLeaseAndHydrate()
      assert.equal(hydrated.missionGoal, 'ship the fixture feature')
      assert.equal(hydrated.phase, 'BUILD')

      // Sees the worker planner A dispatched, without ever calling dispatchWorker itself yet.
      const workers = plannerB.getWorkers()
      assert.equal(workers.length, 1)
      assert.equal(workers[0].workerId, workerIdFromA)
      assert.equal(workers[0].status, 'DISPATCHED')
      assert.equal(dispatchCallCount, 1, 'hydrating must never itself trigger a dispatch')

      // The Needs-You item planner A raised survives into planner B's view.
      const needsYou = plannerB.getNeedsYou()
      assert.equal(needsYou.length, 1)
      assert.equal(needsYou[0].id, needsYouIdFromA)
      assert.equal(needsYou[0].resolvedAt, null)

      // Attempting to dispatch the SAME task again must be a no-op --
      // planner B recognizes it's already dispatched and never re-spends
      // dispatch capacity.
      const redispatch = await plannerB.dispatchWorkerForTask({ taskId: 'task-1', kind: 'FIXTURE_WORKER' })
      assert.equal(redispatch.alreadyDispatched, true)
      assert.equal(redispatch.worker.workerId, workerIdFromA)
      assert.equal(dispatchCallCount, 1, 'no duplicate dispatch must occur after rollover')

      // Planner B resolves the inherited Needs-You, records the fixture
      // worker's result, records a verifier pass, and completes the mission.
      await plannerB.resolveNeedsYou(needsYouIdFromA, 'approved by owner')
      await plannerB.recordWorkerResult(workerIdFromA, { status: 'COMPLETED', result: { summary: 'fixture worker finished cleanly' } })
      await plannerB.recordVerifierResult({ verifier: 'fixture-verifier', verdict: 'PASS' })
      const completed = await plannerB.completeMission()
      assert.equal(completed.missionState, 'COMPLETE')
    })

    await t.test('final durable state: one dispatch total, worker completed, Needs-You resolved, mission complete', () => {
      const record = readPlannerMissionRecord(MISSION_ID)
      assert.equal(dispatchCallCount, 1)
      assert.deepEqual(dispatchedTaskIds, ['task-1'])
      assert.equal(record.checkpoint.missionState, 'COMPLETE')
      assert.equal(record.checkpoint.workers[workerIdFromA].status, 'COMPLETED')
      assert.equal(record.checkpoint.needsYou[0].resolvedAt !== null, true)
      assert.equal(record.lease.holderPlannerSessionId, 'planner-B', 'planner B remains the lease holder of record for the completed mission')
    })

    await t.test('a would-be planner C is refused the lease while planner B still (momentarily) holds it live', async () => {
      const plannerC = new PlannerSessionLifecycle({
        missionId: MISSION_ID,
        plannerSessionId: 'planner-C',
        deps: { clock, collectHostMemoryEvidence: fakeHealthyMemory, observeRepoState: () => FIXTURE_REPO_STATE }
      })
      await assert.rejects(plannerC.acquireLeaseAndHydrate(), (error) => error.code === 'TSF_PLANNER_LEASE_DENIED')
    })
  } finally {
    cleanupStateFile()
  }
})

// 2F: creating a new planner session (startMission or acquireLeaseAndHydrate)
// must respect the existing Resource Pressure Governor -- fail closed, never
// race ahead and duplicate a mission when capacity is insufficient.
import assert from 'node:assert/strict'
import test from 'node:test'
import { rmSync } from 'node:fs'
import path from 'node:path'

const HERE = import.meta.dirname
const STATE_FILE = path.join(HERE, '..', 'server', '.local-state', `operator-state.test-planner-resource-gov-${process.pid}.json`)
process.env.TSF_UI_STATE_FILE = STATE_FILE

const { PlannerSessionLifecycle } = await import('../server/planner-session-lifecycle.mjs')
const { readPlannerMissionRecord } = await import('../server/planner-mission-store.mjs')

function cleanupStateFile() {
  for (const suffix of ['', '.tmp', '.planner-mission.lock']) { rmSync(`${STATE_FILE}${suffix}`, { force: true }) }
}
cleanupStateFile()

const GB = 1024 ** 3
const clock = () => new Date('2026-09-06T12:00:00.000Z')
const repoState = { branch: 'tsf/feature/x', sha: 'a'.repeat(40) }

test('Resource Pressure Governor gates planner session creation/hydration', async (t) => {
  try {
    await t.test('startMission refuses under CRITICAL pressure -- no duplicate mission created', async () => {
      const missionId = 'mission:resource-gov-start'
      const criticalMemory = () => ({ totalBytes: 16 * GB, freeBytes: 2 * GB, availableBytes: 2 * GB, usedPercent: 88 })
      const planner = new PlannerSessionLifecycle({ missionId, plannerSessionId: 'planner-under-pressure', deps: { clock, collectHostMemoryEvidence: criticalMemory } })

      await assert.rejects(
        planner.startMission({ missionGoal: 'g', phase: 'BUILD', repoState }),
        (error) => error.code === 'TSF_PLANNER_SESSION_BLOCKED_BY_RESOURCE_PRESSURE' && error.tier === 'CRITICAL'
      )
      assert.equal(readPlannerMissionRecord(missionId), null, 'no lease or checkpoint may be created when admission is refused -- fail closed, not a racing-ahead partial write')
    })

    await t.test('acquireLeaseAndHydrate refuses under EMERGENCY pressure -- never duplicates the mission by racing ahead', async () => {
      const missionId = 'mission:resource-gov-hydrate'
      const healthyMemory = () => ({ totalBytes: 16 * GB, freeBytes: 8 * GB, availableBytes: 8 * GB, usedPercent: 50 })
      const emergencyMemory = () => ({ totalBytes: 16 * GB, freeBytes: 0.1 * GB, availableBytes: 0.1 * GB, usedPercent: 99 })

      const plannerA = new PlannerSessionLifecycle({ missionId, plannerSessionId: 'planner-A', deps: { clock, collectHostMemoryEvidence: healthyMemory } })
      await plannerA.startMission({ missionGoal: 'g', phase: 'BUILD', repoState })
      await plannerA.relinquish()

      const plannerB = new PlannerSessionLifecycle({ missionId, plannerSessionId: 'planner-B', deps: { clock, collectHostMemoryEvidence: emergencyMemory, observeRepoState: () => repoState } })
      await assert.rejects(
        plannerB.acquireLeaseAndHydrate(),
        (error) => error.code === 'TSF_PLANNER_SESSION_BLOCKED_BY_RESOURCE_PRESSURE' && error.tier === 'EMERGENCY'
      )
      const record = readPlannerMissionRecord(missionId)
      assert.equal(record.lease, null, 'the lease must remain unheld -- planner B must not have acquired it while refused')
    })

    await t.test('once pressure clears, the previously-refused successor can hydrate normally', async () => {
      const missionId = 'mission:resource-gov-recovers'
      const healthyMemory = () => ({ totalBytes: 16 * GB, freeBytes: 8 * GB, availableBytes: 8 * GB, usedPercent: 50 })

      const plannerA = new PlannerSessionLifecycle({ missionId, plannerSessionId: 'planner-A', deps: { clock, collectHostMemoryEvidence: healthyMemory } })
      await plannerA.startMission({ missionGoal: 'g', phase: 'BUILD', repoState })
      await plannerA.relinquish()

      const plannerB = new PlannerSessionLifecycle({ missionId, plannerSessionId: 'planner-B', deps: { clock, collectHostMemoryEvidence: healthyMemory, observeRepoState: () => repoState } })
      const hydrated = await plannerB.acquireLeaseAndHydrate()
      assert.equal(hydrated.missionGoal, 'g')
    })

    // Phase 8 (Planner Lifecycle Chaos Test) reconciliation: _assertResourceAdmission
    // is a single up-front gate (called once, before the lease acquire/read/
    // continuity-check sequence), never re-consulted mid-hydration. Confirmed
    // deliberate, not a gap: (1) collectHostMemoryEvidence is called exactly
    // once per hydrate -- proven directly below, not assumed from a code read;
    // (2) everything AFTER the gate (acquirePlannerLease's file-lock read/
    // write, readPlannerMissionRecord's JSON parse, assertRepoStateContinuity's
    // string compare, observeRepoState's single `git rev-parse`) is cheap,
    // bounded, read-mostly work with no allocation proportional to mission
    // size or duration -- unlike dispatchWorkerForTask's real external
    // provider call, there is no long-running operation here for a pressure
    // spike to meaningfully interrupt. Per-task heavyweight-dispatch admission
    // (the actual unbounded-duration risk) is a DIFFERENT layer's job
    // (chat-dispatch-bridge.mjs, per ADMISSION_FIELD's own comment), not
    // duplicated in this lifecycle class.
    await t.test('resource pressure is gated once, up front -- a spike immediately after the check does not abort an already-admitted hydrate (single gate, not a continuous guard, by design)', async () => {
      const missionId = 'mission:resource-gov-single-gate'
      const healthyMemory = () => ({ totalBytes: 16 * GB, freeBytes: 8 * GB, availableBytes: 8 * GB, usedPercent: 50 })

      const plannerA = new PlannerSessionLifecycle({ missionId, plannerSessionId: 'planner-A', deps: { clock, collectHostMemoryEvidence: healthyMemory } })
      await plannerA.startMission({ missionGoal: 'g', phase: 'BUILD', repoState })
      await plannerA.relinquish()

      let calls = 0
      const criticalAfterFirstCall = () => {
        calls += 1
        // HEALTHY only for the one up-front admission check; every
        // subsequent call (there must be none) would see CRITICAL.
        return calls === 1
          ? { totalBytes: 16 * GB, freeBytes: 8 * GB, availableBytes: 8 * GB, usedPercent: 50 }
          : { totalBytes: 16 * GB, freeBytes: 1 * GB, availableBytes: 1 * GB, usedPercent: 92 }
      }
      const plannerB = new PlannerSessionLifecycle({ missionId, plannerSessionId: 'planner-B', deps: { clock, collectHostMemoryEvidence: criticalAfterFirstCall, observeRepoState: () => repoState } })
      const hydrated = await plannerB.acquireLeaseAndHydrate()
      assert.equal(hydrated.missionGoal, 'g', 'hydration completes on the single up-front HEALTHY reading')
      assert.equal(calls, 1, 'collectHostMemoryEvidence is consulted exactly once per hydrate -- confirms the single-gate design, not an assumption')
    })
  } finally {
    cleanupStateFile()
  }
})

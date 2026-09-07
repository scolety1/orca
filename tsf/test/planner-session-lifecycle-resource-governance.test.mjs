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
  } finally {
    cleanupStateFile()
  }
})

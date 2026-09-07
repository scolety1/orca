// Finding F4 (Autonomous Reliability Hardening Overnight V1, Phase 1):
// planner-mission-store.mjs had no schema-version guard at all. Mirrors
// research-mission-store-schema-version.test.mjs's own pattern exactly.
import assert from 'node:assert/strict'
import test from 'node:test'
import { rmSync } from 'node:fs'
import path from 'node:path'

const HERE = import.meta.dirname
const STATE_FILE = path.join(HERE, '..', 'server', '.local-state', `operator-state.test-planner-schema-version-${process.pid}.json`)
process.env.TSF_UI_STATE_FILE = STATE_FILE

const { readPlannerMissionRecord, withPlannerMissionRecord, mutateCheckpoint } = await import('../server/planner-mission-store.mjs')
const { createPlannerMissionCheckpoint } = await import('../domain/planner-mission-checkpoint.mjs')

function cleanupStateFile() {
  for (const suffix of ['', '.tmp', '.planner-mission.lock']) { rmSync(`${STATE_FILE}${suffix}`, { force: true }) }
}
cleanupStateFile()

const clock = () => new Date('2026-09-07T09:00:00.000Z')
const MISSION_ID = 'mission:schema-version-test'
const repoState = { branch: 'tsf/feature/x', sha: 'a'.repeat(40) }

test('planner mission store: schema-version guard on the checkpoint at the real durable read boundary', async (t) => {
  try {
    await t.test('a real checkpoint persists and re-reads cleanly (current version, no throw)', async () => {
      await mutateCheckpoint(MISSION_ID, () => createPlannerMissionCheckpoint({ missionId: MISSION_ID, missionGoal: 'ship it', phase: 'BUILD', repoState }, clock), clock)
      const reloaded = readPlannerMissionRecord(MISSION_ID)
      assert.ok(reloaded)
      assert.equal(reloaded.checkpoint.schemaVersion, 'TSF_PLANNER_MISSION_CHECKPOINT_V1')
    })

    await t.test('a hand-corrupted checkpoint schemaVersion on disk is refused at read time, not silently operated on', async () => {
      const { loadState, saveState } = await import('../server/data-store.mjs')
      const opState = loadState()
      opState.plannerMissions[MISSION_ID] = {
        ...opState.plannerMissions[MISSION_ID],
        checkpoint: { ...opState.plannerMissions[MISSION_ID].checkpoint, schemaVersion: 'TSF_PLANNER_MISSION_CHECKPOINT_V99_FROM_THE_FUTURE' }
      }
      saveState(opState)

      assert.throws(() => readPlannerMissionRecord(MISSION_ID), (error) => {
        assert.equal(error.code, 'TSF_UNSUPPORTED_PLANNER_MISSION_CHECKPOINT_SCHEMA_VERSION')
        return true
      })
      await assert.rejects(
        withPlannerMissionRecord(MISSION_ID, (r) => r),
        (error) => {
          assert.equal(error.code, 'TSF_UNSUPPORTED_PLANNER_MISSION_CHECKPOINT_SCHEMA_VERSION')
          return true
        }
      )
    })

    await t.test('a lease with no checkpoint yet is never checked (nothing to version-guard) and never throws', async () => {
      const emptyMissionId = 'mission:no-checkpoint-yet'
      const { acquirePlannerLease } = await import('../server/planner-mission-store.mjs')
      await acquirePlannerLease(emptyMissionId, 'planner-A', clock)
      const record = readPlannerMissionRecord(emptyMissionId)
      assert.equal(record.checkpoint, null)
      assert.ok(record.lease)
    })
  } finally {
    cleanupStateFile()
  }
})

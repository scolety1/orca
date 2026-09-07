// CAS-store-level proof, isolated state file (mirrors research-mission-
// store-schema-version.test.mjs's pattern). Covers what the pure domain
// tests can't: real cross-process-file-lock atomicity and the store's own
// wiring of lease + checkpoint into one durable record.
import assert from 'node:assert/strict'
import test from 'node:test'
import { rmSync } from 'node:fs'
import path from 'node:path'

const HERE = import.meta.dirname
const STATE_FILE = path.join(HERE, '..', 'server', '.local-state', `operator-state.test-planner-mission-store-${process.pid}.json`)
process.env.TSF_UI_STATE_FILE = STATE_FILE

const { acquirePlannerLease, mutateCheckpoint, readPlannerMissionRecord, relinquishPlannerLease, renewPlannerLease, withPlannerMissionRecord } = await import(
  '../server/planner-mission-store.mjs'
)
const { createPlannerMissionCheckpoint, recordDecision } = await import('../domain/planner-mission-checkpoint.mjs')

function cleanupStateFile() {
  for (const suffix of ['', '.tmp', '.planner-mission.lock']) { rmSync(`${STATE_FILE}${suffix}`, { force: true }) }
}
cleanupStateFile()

const clock = () => new Date('2026-09-06T12:00:00.000Z')
const MISSION_ID = 'mission:store-test'
const repoState = { branch: 'tsf/feature/x', sha: 'a'.repeat(40) }

test('planner mission store', async (t) => {
  try {
    await t.test('readPlannerMissionRecord returns null before anything is written', () => {
      assert.equal(readPlannerMissionRecord(MISSION_ID), null)
    })

    await t.test('acquirePlannerLease grants on an empty slot and persists durably', async () => {
      const outcome = await acquirePlannerLease(MISSION_ID, 'planner-A', clock)
      assert.equal(outcome.granted, true)
      const record = readPlannerMissionRecord(MISSION_ID)
      assert.equal(record.lease.holderPlannerSessionId, 'planner-A')
    })

    await t.test('a second session is refused while the lease is live', async () => {
      const outcome = await acquirePlannerLease(MISSION_ID, 'planner-B', clock)
      assert.equal(outcome.granted, false)
    })

    await t.test('renewPlannerLease extends the SAME holder, refuses a non-holder', async () => {
      const renewed = await renewPlannerLease(MISSION_ID, 'planner-A', clock)
      assert.equal(renewed.renewed, true)
      await assert.rejects(renewPlannerLease(MISSION_ID, 'planner-B', clock), (error) => error.code === 'TSF_PLANNER_LEASE_NOT_HELD')
    })

    await t.test('mutateCheckpoint applies a domain mutator against the current durable checkpoint', async () => {
      await mutateCheckpoint(MISSION_ID, () => createPlannerMissionCheckpoint({ missionId: MISSION_ID, missionGoal: 'ship it', phase: 'BUILD', repoState }, clock), clock)
      await mutateCheckpoint(MISSION_ID, (current) => recordDecision(current, { summary: 'use fixture worker', kind: 'ACCEPTED' }, clock), clock)
      const record = readPlannerMissionRecord(MISSION_ID)
      assert.equal(record.checkpoint.decisions.length, 1)
      assert.equal(record.checkpoint.missionGoal, 'ship it')
    })

    await t.test('relinquishPlannerLease: non-holder refused, then the real holder releases, freeing it for a new holder', async () => {
      const refused = await relinquishPlannerLease(MISSION_ID, 'planner-B', clock)
      assert.equal(refused.released, false)
      const released = await relinquishPlannerLease(MISSION_ID, 'planner-A', clock)
      assert.equal(released.released, true)
      const reacquired = await acquirePlannerLease(MISSION_ID, 'planner-B', clock)
      assert.equal(reacquired.granted, true, 'once released, a different session must be able to acquire it')
    })

    await t.test('the checkpoint survives lease changes -- it belongs to the mission record, not to whoever holds the lease', () => {
      const record = readPlannerMissionRecord(MISSION_ID)
      assert.equal(record.checkpoint.decisions.length, 1)
      assert.equal(record.lease.holderPlannerSessionId, 'planner-B')
    })

    await t.test('withPlannerMissionRecord: concurrent writers are serialized, not lost (no torn write)', async () => {
      const missionId = 'mission:concurrency-test'
      const writers = Array.from({ length: 10 }, () =>
        withPlannerMissionRecord(missionId, (current) => {
          const record = current ?? { lease: null, checkpoint: { count: 0 } }
          return { ...record, checkpoint: { count: record.checkpoint.count + 1 } }
        })
      )
      await Promise.all(writers)
      const record = readPlannerMissionRecord(missionId)
      assert.equal(record.checkpoint.count, 10, 'every one of 10 concurrent increments must land -- none silently lost to a torn read-modify-write')
    })
  } finally {
    cleanupStateFile()
  }
})

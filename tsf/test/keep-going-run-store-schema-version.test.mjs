// Finding F4 (Autonomous Reliability Hardening Overnight V1, Phase 1):
// keep-going-run-store.mjs had no schema-version guard at all. Mirrors
// research-mission-store-schema-version.test.mjs's own pattern exactly.
import assert from 'node:assert/strict'
import test from 'node:test'
import { rmSync } from 'node:fs'
import path from 'node:path'
import { createOvernightRun } from '../domain/keep-going.mjs'

const HERE = import.meta.dirname
const STATE_FILE = path.join(HERE, '..', 'server', '.local-state', `operator-state.test-keep-going-schema-version-${process.pid}.json`)
process.env.TSF_UI_STATE_FILE = STATE_FILE

const { withKeepGoingRun, readKeepGoingRun } = await import('../server/keep-going-run-store.mjs')

function cleanupStateFile() {
  for (const suffix of ['', '.tmp', '.lock']) { rmSync(`${STATE_FILE}${suffix}`, { force: true }) }
}
cleanupStateFile()

const clock = () => new Date('2026-09-07T09:00:00.000Z')
const PROJECT_ID = 'fixture:schema-version-test'

test('keep going run store: schema-version guard at the real durable read boundary', async (t) => {
  try {
    await t.test('a real run persists and re-reads cleanly (current version, no throw)', async () => {
      await withKeepGoingRun(PROJECT_ID, () =>
        createOvernightRun({ id: 'run-1', projectId: PROJECT_ID, originalGoal: 'ship it', acceptanceCriteria: ['A'], usageMode: 'BALANCED' }, clock)
      )
      const reloaded = readKeepGoingRun(PROJECT_ID)
      assert.ok(reloaded)
      assert.equal(reloaded.schemaVersion, 'TSF_OVERNIGHT_RUN_V1')
    })

    await t.test('a hand-corrupted schemaVersion on disk is refused at read time, not silently operated on', async () => {
      const { loadState, saveState } = await import('../server/data-store.mjs')
      const opState = loadState()
      opState.keepGoingRuns[PROJECT_ID] = { ...opState.keepGoingRuns[PROJECT_ID], schemaVersion: 'TSF_OVERNIGHT_RUN_V99_FROM_THE_FUTURE' }
      saveState(opState)

      assert.throws(() => readKeepGoingRun(PROJECT_ID), (error) => {
        assert.equal(error.code, 'TSF_UNSUPPORTED_KEEP_GOING_RUN_SCHEMA_VERSION')
        return true
      })
      await assert.rejects(
        withKeepGoingRun(PROJECT_ID, (r) => r),
        (error) => {
          assert.equal(error.code, 'TSF_UNSUPPORTED_KEEP_GOING_RUN_SCHEMA_VERSION')
          return true
        }
      )
    })
  } finally {
    cleanupStateFile()
  }
})

// Multi-Project Command + Real Fleet Orchestration Overnight V1, Part B.
// CAS-store-level proof, isolated state file (mirrors self-improvement-
// finding-store.test.mjs's own pattern exactly): durable persistence
// survives a fresh read of the store, concurrent writers never lose a
// write.
import assert from 'node:assert/strict'
import test from 'node:test'
import { rmSync } from 'node:fs'
import path from 'node:path'

const HERE = import.meta.dirname
const STATE_FILE = path.join(
  HERE,
  '..',
  'server',
  '.local-state',
  `operator-state.test-project-execution-hold-store-${process.pid}.json`
)
process.env.TSF_UI_STATE_FILE = STATE_FILE

const { readProjectExecutionHold, readAllProjectExecutionHolds, withProjectExecutionHold } = await import(
  '../server/project-execution-hold-store.mjs'
)
const { createProjectExecutionHold, releaseProjectExecutionHold, isProjectExecutionHoldActive } = await import(
  '../domain/project-execution-hold.mjs'
)

function cleanupStateFile() {
  for (const suffix of ['', '.tmp', '.project-execution-hold.lock']) {
    rmSync(`${STATE_FILE}${suffix}`, { force: true })
  }
}
cleanupStateFile()

const clock = () => new Date('2026-09-07T12:00:00.000Z')

test('project execution hold store', async (t) => {
  try {
    await t.test('readProjectExecutionHold returns null before anything is written', () => {
      assert.equal(readProjectExecutionHold('niners-war-room'), null)
    })

    await t.test('withProjectExecutionHold creates a hold and persists it durably (survives a fresh read)', async () => {
      const hold = await withProjectExecutionHold('niners-war-room', (current) => {
        assert.equal(current, null, 'sanity: nothing set yet')
        return createProjectExecutionHold(
          { projectId: 'niners-war-room', reason: 'EXTERNAL_WORK_ACTIVE', setBy: 'OPERATOR_CHAT', note: 'another AI is actively working this repo' },
          clock
        )
      })
      assert.equal(hold.status, 'ACTIVE')
      const reloaded = readProjectExecutionHold('niners-war-room')
      assert.deepEqual(reloaded, hold)
      assert.equal(isProjectExecutionHoldActive(reloaded), true)
    })

    await t.test('a held project is durably distinguishable from an unheld one', () => {
      assert.equal(readProjectExecutionHold('some-other-project'), null)
      const all = readAllProjectExecutionHolds()
      assert.ok(all['niners-war-room'])
      assert.equal(all['some-other-project'], undefined)
    })

    await t.test('releasing clears the active hold -- durably, not just in-memory', async () => {
      const released = await withProjectExecutionHold('niners-war-room', (current) =>
        releaseProjectExecutionHold(current, { releasedBy: 'OPERATOR_CHAT', reason: 'external work finished' }, clock)
      )
      assert.equal(released.status, 'RELEASED')
      const reloaded = readProjectExecutionHold('niners-war-room')
      assert.equal(reloaded.status, 'RELEASED')
      assert.equal(isProjectExecutionHoldActive(reloaded), false)
      // The audit trail survives release, not deleted.
      assert.equal(reloaded.history.length, 2)
    })

    await t.test('withProjectExecutionHold: concurrent writers on the SAME project are serialized, not lost', async () => {
      const projectId = 'concurrency-test-project'
      const writers = Array.from({ length: 10 }, () =>
        withProjectExecutionHold(projectId, (current) =>
          current
            ? { ...current, note: `${current.note}.`, updatedAt: clock().toISOString() }
            : createProjectExecutionHold({ projectId, reason: 'EXTERNAL_WORK_ACTIVE', setBy: 'test', note: '' }, clock)
        )
      )
      await Promise.all(writers)
      const finalHold = readProjectExecutionHold(projectId)
      assert.equal(finalHold.note.length, 9, 'every one of 10 concurrent writes must land -- none silently lost to a torn read-modify-write')
    })
  } finally {
    cleanupStateFile()
  }
})

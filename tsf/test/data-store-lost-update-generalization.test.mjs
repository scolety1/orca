// Overnight autonomous-improvement mission: proves the generalized
// lost-update fix in server/data-store.mjs's saveState -- the SAME
// protection the dogfood safety review originally proved for
// dogfoodSessions alone now holds for every lock-protected collection.
// This is the general regression test; test/dogfood-safety-review-round1.
// test.mjs already covers the dogfoodSessions-specific real-HTTP repro.
import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const ROOT = mkdtempSync(path.join(tmpdir(), 'tsf-lost-update-generalization-'))
process.env.TSF_UI_STATE_FILE = path.join(ROOT, 'operator-state.json')
test.after(() => rmSync(ROOT, { recursive: true, force: true }))

const { loadState, saveState } = await import('../server/data-store.mjs')
const { withKeepGoingRun, readKeepGoingRun } = await import('../server/keep-going-run-store.mjs')
const { withProjectExecutionHold, readProjectExecutionHold } =
  await import('../server/project-execution-hold-store.mjs')
const { createOvernightRun } = await import('../domain/keep-going.mjs')
const clock = () => new Date('2026-09-23T00:00:00.000Z')

test('a concurrent stale whole-state save from an unrelated field never erases a keepGoingRuns write (the brief-named example collection)', async () => {
  const projectId = 'lost-update-keep-going-project'
  const staleSnapshot = loadState()

  await withKeepGoingRun(projectId, () =>
    createOvernightRun(
      { id: `run:${projectId}`, projectId, originalGoal: 'ship it', acceptanceCriteria: ['X'] },
      clock
    )
  )
  assert.ok(readKeepGoingRun(projectId), 'the run must exist right after the real, locked write')

  // The same real repro shape as POST /api/usage-mode's own read-modify-
  // write: an unrelated handler read a stale snapshot BEFORE the run was
  // created, and saves it LATE.
  saveState({ ...staleSnapshot, usageMode: 'ECONOMY' })

  assert.ok(
    readKeepGoingRun(projectId),
    'the keepGoingRuns write must survive an unrelated stale whole-state save'
  )
  assert.equal(
    loadState().usageMode,
    'ECONOMY',
    'the unrelated field DID get written -- this is a targeted protection, not a claim every field is race-free'
  )
})

test('the same protection holds for projectExecutionHolds -- a different collection, same class of race', async () => {
  const projectId = 'lost-update-hold-project'
  const staleSnapshot = loadState()

  await withProjectExecutionHold(projectId, () => ({
    schemaVersion: 'TSF_PROJECT_EXECUTION_HOLD_V1',
    projectId,
    status: 'ACTIVE',
    reason: 'owner requested',
    note: null,
    setAt: clock().toISOString(),
    releasedAt: null
  }))
  assert.ok(readProjectExecutionHold(projectId))

  saveState({ ...staleSnapshot, usageMode: 'BALANCED' })

  const hold = readProjectExecutionHold(projectId)
  assert.ok(hold, 'the execution hold must survive an unrelated stale whole-state save')
  assert.equal(hold.status, 'ACTIVE')
})

test("a collection's own designated writer can still change it -- the protection never blocks the real write, only an unrelated stale one", async () => {
  const projectId = 'lost-update-writer-still-works-project'
  await withKeepGoingRun(projectId, () =>
    createOvernightRun(
      { id: `run:${projectId}`, projectId, originalGoal: 'ship it', acceptanceCriteria: ['X'] },
      clock
    )
  )
  const before = readKeepGoingRun(projectId)
  assert.equal(before.state, 'ACTIVE')

  await withKeepGoingRun(projectId, (run) => ({ ...run, state: 'PAUSED' }))
  const after = readKeepGoingRun(projectId)
  assert.equal(
    after.state,
    'PAUSED',
    "the run's own designated writer must still be able to change it"
  )
})

test('a singleton collection (researchLibrary) preserves its own real shape, not a bare {} that would fail its schema-version guard', async () => {
  const { readResearchLibrary, withResearchLibrary } =
    await import('../server/research-library-store.mjs')
  const staleSnapshot = loadState()

  await withResearchLibrary(() => ({
    schemaVersion: 'TSF_RESEARCH_LIBRARY_V1',
    entries: {}
  }))
  assert.ok(readResearchLibrary())

  saveState({ ...staleSnapshot, usageMode: 'ECONOMY' })

  const library = readResearchLibrary()
  assert.ok(library, 'the research library must survive an unrelated stale whole-state save')
  assert.equal(library.schemaVersion, 'TSF_RESEARCH_LIBRARY_V1')
})

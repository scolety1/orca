// Fleet Dispatch Readiness + Explicit Command Adoption V1, Part C:
// CAS-store-level proof, isolated state file (mirrors
// project-execution-hold-store.test.mjs's own pattern exactly).
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
  `operator-state.test-project-canonical-base-store-${process.pid}.json`
)
process.env.TSF_UI_STATE_FILE = STATE_FILE

const { readProjectCanonicalBase, readAllProjectCanonicalBases, setProjectCanonicalBaseRef, recordProjectCanonicalBaseAdvanced } = await import(
  '../server/project-canonical-base-store.mjs'
)

function cleanupStateFile() {
  for (const suffix of ['', '.tmp', '.project-canonical-base.lock']) {
    rmSync(`${STATE_FILE}${suffix}`, { force: true })
  }
}
cleanupStateFile()

const clock = () => new Date('2026-09-07T12:00:00.000Z')

test('project canonical base store', async (t) => {
  try {
    await t.test('readProjectCanonicalBase returns null before anything is set', () => {
      assert.equal(readProjectCanonicalBase('worldforge'), null)
    })

    await t.test('setProjectCanonicalBaseRef durably records who set it and why (survives a fresh read)', async () => {
      const record = await setProjectCanonicalBaseRef({ projectId: 'worldforge', ref: 'tsf/main', setBy: 'OPERATOR_CHAT', reason: 'deliberate designation' }, clock)
      assert.equal(record.ref, 'tsf/main')
      assert.equal(record.setBy, 'OPERATOR_CHAT')
      const reloaded = readProjectCanonicalBase('worldforge')
      assert.deepEqual(reloaded, record)
      assert.equal(reloaded.history.length, 1)
      assert.equal(reloaded.history[0].action, 'SET')
    })

    await t.test('a re-designation overwrites the ref but keeps history', async () => {
      const record = await setProjectCanonicalBaseRef({ projectId: 'worldforge', ref: 'release/2026', setBy: 'OPERATOR_CHAT', reason: 'switched release line' }, clock)
      assert.equal(record.ref, 'release/2026')
      assert.equal(record.history.length, 2)
    })

    await t.test('recordProjectCanonicalBaseAdvanced records a real adoption merge event, ref unchanged', async () => {
      const record = await recordProjectCanonicalBaseAdvanced({ projectId: 'worldforge', ref: 'release/2026', resultingSha: 'deadbeef', missionId: 'mission:x' }, clock)
      assert.equal(record.ref, 'release/2026')
      const advancedEntry = record.history.at(-1)
      assert.equal(advancedEntry.action, 'ADVANCED')
      assert.equal(advancedEntry.resultingSha, 'deadbeef')
    })

    await t.test('a different, unset project is durably distinguishable', () => {
      assert.equal(readProjectCanonicalBase('some-other-project'), null)
      const all = readAllProjectCanonicalBases()
      assert.ok(all.worldforge)
      assert.equal(all['some-other-project'], undefined)
    })

    await t.test('recordProjectCanonicalBaseAdvanced with no prior explicit record creates one, attributed to the system', async () => {
      const record = await recordProjectCanonicalBaseAdvanced({ projectId: 'never-configured', ref: 'main', resultingSha: 'cafef00d', missionId: 'mission:y' }, clock)
      assert.equal(record.setBy, 'SYSTEM_ADOPTION_EXECUTION')
      assert.equal(record.ref, 'main')
    })
  } finally {
    cleanupStateFile()
  }
})

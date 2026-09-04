// Trust + Scale Hardening Phase 14: schema versioning at the real durable
// read boundary. Mirrors research-crash-resume.test.mjs's isolated-state-
// file pattern.
import assert from 'node:assert/strict'
import test from 'node:test'
import { rmSync } from 'node:fs'
import path from 'node:path'
import { createResearchMission } from '../domain/research-mission.mjs'
import { buildNflQb2001Specification } from '../fixtures/nfl-2001-qb-research-fixture.mjs'

const HERE = import.meta.dirname
const STATE_FILE = path.join(HERE, '..', 'server', '.local-state', `operator-state.test-research-schema-version-${process.pid}.json`)
process.env.TSF_UI_STATE_FILE = STATE_FILE

const { withResearchMission, readResearchMission } = await import('../server/research-mission-store.mjs')

function cleanupStateFile() {
  for (const suffix of ['', '.tmp', '.research.lock']) rmSync(`${STATE_FILE}${suffix}`, { force: true })
}
cleanupStateFile()

const clock = () => new Date('2026-10-25T09:00:00.000Z')
const MISSION_ID = 'mission:schema-version-test'

test('research mission store: schema-version guard at the real durable read boundary', async (t) => {
 try {
  await t.test('a real mission persists and re-reads cleanly (current version, no throw)', async () => {
    await withResearchMission(MISSION_ID, () => {
      const specification = buildNflQb2001Specification()
      return createResearchMission({ id: MISSION_ID, projectId: 'fixture:proj', specification, expectedUniverse: specification.expectedUniverse }, clock)
    })
    const reloaded = readResearchMission(MISSION_ID)
    assert.ok(reloaded)
    assert.equal(reloaded.schemaVersion, 'TSF_RESEARCH_MISSION_V1')
  })

  await t.test('a hand-corrupted schemaVersion on disk is refused at read time, not silently operated on', async () => {
    // Simulate "an old/foreign schema version reached disk somehow" by
    // reading real state, corrupting just the version, and persisting it
    // back through the same store (bypassing the domain layer's own
    // construction, which always stamps the real current version).
    const { loadState, saveState } = await import('../server/data-store.mjs')
    const opState = loadState()
    opState.researchMissions[MISSION_ID] = { ...opState.researchMissions[MISSION_ID], schemaVersion: 'TSF_RESEARCH_MISSION_V99_FROM_THE_FUTURE' }
    saveState(opState)

    assert.throws(() => readResearchMission(MISSION_ID), (error) => {
      assert.equal(error.code, 'TSF_UNSUPPORTED_RESEARCH_MISSION_SCHEMA_VERSION')
      return true
    })
    await assert.rejects(
      withResearchMission(MISSION_ID, (m) => m),
      (error) => {
        assert.equal(error.code, 'TSF_UNSUPPORTED_RESEARCH_MISSION_SCHEMA_VERSION')
        return true
      }
    )
  })
 } finally {
  cleanupStateFile()
 }
})

// Trust + Scale Hardening Phase 14: schema versioning.
import assert from 'node:assert/strict'
import test from 'node:test'
import { addResearchNode, createResearchMission } from '../domain/research-mission.mjs'
import {
  CURRENT_RESEARCH_MISSION_SCHEMA_VERSION,
  SUPPORTED_RESEARCH_MISSION_SCHEMA_VERSIONS,
  assertSupportedResearchMissionSchemaVersion,
  migrateResearchMissionSchema
} from '../domain/research-schema-versioning.mjs'
import { buildNflQb2001Specification } from '../fixtures/nfl-2001-qb-research-fixture.mjs'

const clock = () => new Date('2026-10-25T09:00:00.000Z')

function realMission() {
  const specification = buildNflQb2001Specification()
  return createResearchMission({ id: 'mission:version-test', projectId: 'fixture:proj', specification, expectedUniverse: specification.expectedUniverse }, clock)
}

test('a real mission produced by createResearchMission always carries the current schemaVersion', () => {
  const mission = realMission()
  assert.equal(mission.schemaVersion, CURRENT_RESEARCH_MISSION_SCHEMA_VERSION)
  assert.doesNotThrow(() => assertSupportedResearchMissionSchemaVersion(mission))
})

test('assertSupportedResearchMissionSchemaVersion rejects a missing schemaVersion, not silently treating it as current', () => {
  const mission = realMission()
  const { schemaVersion, ...withoutVersion } = mission
  void schemaVersion
  assert.throws(() => assertSupportedResearchMissionSchemaVersion(withoutVersion), (error) => {
    assert.equal(error.code, 'TSF_RESEARCH_MISSION_SCHEMA_VERSION_MISSING')
    return true
  })
})

test('assertSupportedResearchMissionSchemaVersion fails closed on an unrecognized schemaVersion', () => {
  const mission = { ...realMission(), schemaVersion: 'TSF_RESEARCH_MISSION_V99_FROM_THE_FUTURE' }
  assert.throws(() => assertSupportedResearchMissionSchemaVersion(mission), (error) => {
    assert.equal(error.code, 'TSF_UNSUPPORTED_RESEARCH_MISSION_SCHEMA_VERSION')
    assert.match(error.message, /TSF_RESEARCH_MISSION_V99_FROM_THE_FUTURE/)
    return true
  })
})

test('migrateResearchMissionSchema is a real, callable no-op for the current version and refuses an unrecognized one', () => {
  const mission = realMission()
  const migrated = migrateResearchMissionSchema(mission)
  assert.deepEqual(migrated, mission)
  assert.notEqual(migrated, mission, 'must return a fresh clone, not the same reference')

  assert.throws(() => migrateResearchMissionSchema({ ...mission, schemaVersion: 'TSF_RESEARCH_MISSION_V99_FROM_THE_FUTURE' }), /TSF_UNSUPPORTED_RESEARCH_MISSION_SCHEMA_VERSION|unsupported/)
})

test('SUPPORTED_RESEARCH_MISSION_SCHEMA_VERSIONS is a real, non-empty, frozen list including the current version', () => {
  assert.ok(Array.isArray(SUPPORTED_RESEARCH_MISSION_SCHEMA_VERSIONS))
  assert.ok(SUPPORTED_RESEARCH_MISSION_SCHEMA_VERSIONS.includes(CURRENT_RESEARCH_MISSION_SCHEMA_VERSION))
  assert.throws(() => SUPPORTED_RESEARCH_MISSION_SCHEMA_VERSIONS.push('x'), TypeError)
})

test('addResearchNode on a mission still carries the current schemaVersion end to end', () => {
  let mission = realMission()
  mission = addResearchNode(mission, { id: 'node:x', nodeRole: 'PRIMARY_RESEARCH', requestedFields: [], requestedOutputSchema: {} }, clock)
  assert.doesNotThrow(() => assertSupportedResearchMissionSchemaVersion(mission))
})

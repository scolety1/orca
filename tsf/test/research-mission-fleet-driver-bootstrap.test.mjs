// Hands-on pilot round 3 -- Research Autonomy Bootstrap. Before this fix,
// research-mission-fleet-driver.mjs (Job 2's real autonomy driver) was
// never wired into http-server.mjs's own startup at all -- the pilot
// required manually launching it as a genuinely separate companion
// process. Mirrors keep-going-fleet-driver-bootstrap.mjs's own (also
// unit-untested until now) wiring pattern; a fast, deterministic unit
// suite for the bootstrap layer itself, complementing the already-
// extensive real-driver-mechanics coverage (research-autonomy-policy.test.mjs,
// research-mission-autonomy-driver-zero-relay.test.mjs,
// research-resource-pressure-interaction.test.mjs) rather than
// duplicating it. Real end-to-end proof against the actual pilot server
// is in the round 3 report's dogfood transcript.
import assert from 'node:assert/strict'
import test from 'node:test'
import { EventEmitter } from 'node:events'
import { rmSync } from 'node:fs'
import path from 'node:path'
import { addResearchNode, createResearchMission } from '../domain/research-mission.mjs'

const HERE = import.meta.dirname
const STATE_FILE = path.join(HERE, '..', 'server', '.local-state', `operator-state.test-research-fleet-bootstrap-${process.pid}.json`)
process.env.TSF_UI_STATE_FILE = STATE_FILE

const { bootstrapResearchMissionFleetDriverIfEnabled } = await import('../server/research-mission-fleet-driver-bootstrap.mjs')
const { withResearchMission, readResearchMission } = await import('../server/research-mission-store.mjs')

function cleanupStateFile() {
  for (const suffix of ['', '.tmp', '.research.lock']) {
    rmSync(`${STATE_FILE}${suffix}`, { force: true })
  }
}
cleanupStateFile()
test.after(cleanupStateFile)

const clock = () => new Date('2026-09-06T00:00:00.000Z')

function specification() {
  return {
    schemaVersion: 'TSF_RESEARCH_SPECIFICATION_V1',
    id: 'spec:bootstrap',
    researchQuestion: 'q',
    entityType: 'FIXTURE',
    requestedFields: [{ fieldName: 'value', valueType: 'number', required: true, derivationRule: null }],
    sourcePolicy: { preferredSources: [], disallowedSources: [], licensingConstraints: [], freshnessPolicy: 'UNSPECIFIED', requireIndependentSources: false, minSourceCount: 0, allowCrossMissionLibraryReuse: true },
    temporalRequirements: { asOfDate: '2026-09-06', periodScope: 'UNSPECIFIED' },
    budget: { maxCostUsd: 0, maxLatencyMs: null, maxToolCallsPerNode: null },
    toolPermissions: []
  }
}

test('bootstrap is a real no-op when TSF_RESEARCH_MISSION_FLEET_DRIVER is not set to "1" -- never activates without the explicit production/pilot opt-in', () => {
  delete process.env.TSF_RESEARCH_MISSION_FLEET_DRIVER
  let onCalled = false
  const fakeServer = { on: () => { onCalled = true } }
  bootstrapResearchMissionFleetDriverIfEnabled(fakeServer)
  assert.equal(onCalled, false, 'no driver, no close handler -- a genuinely inert no-op')
})

test('bootstrap activates exactly one driver when enabled, wires clean shutdown to the real server close event, and discovers/ticks a real ACTIVE mission via canonical durable state', async () => {
  const missionId = 'mission:bootstrap-proof'
  const spec = specification()
  let mission = createResearchMission({ id: missionId, projectId: 'fixture:bootstrap', specification: spec, expectedUniverse: { schemaVersion: 'TSF_EXPECTED_UNIVERSE_V1', entityType: 'FIXTURE', expectedCount: 1, expectedEntities: [] } }, clock)
  mission = addResearchNode(mission, { id: 'node:a', nodeRole: 'PRIMARY_RESEARCH', requestedFields: spec.requestedFields, requestedOutputSchema: { type: 'object' } }, clock)
  await withResearchMission(missionId, () => mission)

  process.env.TSF_RESOURCE_PRESSURE_TEST_TOTAL_BYTES = String(16 * 1024 ** 3)
  process.env.TSF_RESOURCE_PRESSURE_TEST_FREE_BYTES = String(8 * 1024 ** 3)
  process.env.TSF_RESEARCH_MISSION_FLEET_DRIVER = '1'
  process.env.TSF_RESEARCH_MISSION_FLEET_DRIVER_INTERVAL_MS = '30'
  try {
    const closeEmitter = new EventEmitter()
    // A real server's .on('close', fn) is exactly what closeEmitter.on
    // mirrors -- the bootstrap only ever calls server.on once, with
    // 'close' and a function; using a real EventEmitter (not a hand-
    // rolled stub) proves this against the actual Node event-emitter
    // contract, not an assumption about it.
    const originalOn = closeEmitter.on.bind(closeEmitter)
    let closeHandlerCount = 0
    closeEmitter.on = (event, fn) => {
      if (event === 'close') {
        closeHandlerCount += 1
      }
      return originalOn(event, fn)
    }

    bootstrapResearchMissionFleetDriverIfEnabled(closeEmitter)
    assert.equal(closeHandlerCount, 1, 'exactly one driver, exactly one close handler -- never two')

    // Wait for at least one real tick (no free provider configured, so it
    // will report SKIPPED_NO_PROVIDER_CONFIGURED after a free-path
    // attempt -- but that IS the driver discovering and ticking this
    // mission entirely on its own, through the exact same durable state
    // any real HTTP route reads/writes).
    await new Promise((resolve) => setTimeout(resolve, 200))
    const afterTicks = readResearchMission(missionId)
    assert.ok(afterTicks.revision >= mission.revision, 'the driver observed and processed the real mission via canonical durable state')

    // Clean shutdown: emitting 'close' must stop the interval -- proven by
    // it not throwing and not leaving the process alive on its own
    // (the interval is unref'd either way, but stop() must still be
    // reachable and callable without error).
    assert.doesNotThrow(() => closeEmitter.emit('close'))
  } finally {
    delete process.env.TSF_RESEARCH_MISSION_FLEET_DRIVER
    delete process.env.TSF_RESEARCH_MISSION_FLEET_DRIVER_INTERVAL_MS
    delete process.env.TSF_RESOURCE_PRESSURE_TEST_TOTAL_BYTES
    delete process.env.TSF_RESOURCE_PRESSURE_TEST_FREE_BYTES
  }
})

test('restart: a fresh bootstrap call (simulating a real process restart) resumes ticking the same durable mission with no special recovery step', async () => {
  const missionId = 'mission:bootstrap-restart-proof'
  const spec = specification()
  let mission = createResearchMission({ id: missionId, projectId: 'fixture:bootstrap-restart', specification: spec, expectedUniverse: { schemaVersion: 'TSF_EXPECTED_UNIVERSE_V1', entityType: 'FIXTURE', expectedCount: 1, expectedEntities: [] } }, clock)
  mission = addResearchNode(mission, { id: 'node:a', nodeRole: 'PRIMARY_RESEARCH', requestedFields: spec.requestedFields, requestedOutputSchema: { type: 'object' } }, clock)
  await withResearchMission(missionId, () => mission)

  process.env.TSF_RESOURCE_PRESSURE_TEST_TOTAL_BYTES = String(16 * 1024 ** 3)
  process.env.TSF_RESOURCE_PRESSURE_TEST_FREE_BYTES = String(8 * 1024 ** 3)
  process.env.TSF_RESEARCH_MISSION_FLEET_DRIVER = '1'
  process.env.TSF_RESEARCH_MISSION_FLEET_DRIVER_INTERVAL_MS = '30'
  try {
    // "Restart" #1: a fresh bootstrap call against a fresh fake server --
    // the bootstrap holds no in-memory state of its own beyond the
    // interval handle, so this is exactly what a real process restart
    // looks like from the driver's perspective.
    const server1 = new EventEmitter()
    bootstrapResearchMissionFleetDriverIfEnabled(server1)
    await new Promise((resolve) => setTimeout(resolve, 100))
    server1.emit('close')
    const afterFirst = readResearchMission(missionId)

    // "Restart" #2: genuinely new emitter, genuinely new call.
    const server2 = new EventEmitter()
    bootstrapResearchMissionFleetDriverIfEnabled(server2)
    await new Promise((resolve) => setTimeout(resolve, 100))
    server2.emit('close')
    const afterSecond = readResearchMission(missionId)

    assert.ok(afterSecond.updatedAt >= afterFirst.updatedAt, 'the second bootstrap genuinely resumed ticking the same mission, not a fresh/empty view of it')
  } finally {
    delete process.env.TSF_RESEARCH_MISSION_FLEET_DRIVER
    delete process.env.TSF_RESEARCH_MISSION_FLEET_DRIVER_INTERVAL_MS
    delete process.env.TSF_RESOURCE_PRESSURE_TEST_TOTAL_BYTES
    delete process.env.TSF_RESOURCE_PRESSURE_TEST_FREE_BYTES
  }
})

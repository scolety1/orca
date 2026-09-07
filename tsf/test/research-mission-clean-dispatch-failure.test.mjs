// Finding F5 (Autonomous Reliability + Operator Experience Hardening
// Overnight V1, Phase 1 gap matrix): a CLEAN dispatch failure
// (worker.dispatch() resolves {ok:false} -- a synchronous, unambiguous
// rejection, never a crash/timeout) left the node at READY with no legal
// transition to FAILED. decideNextNodeAction (research-autonomy-policy.mjs)
// only routes a node through the retryCount/budget-tracked
// RETRY_DISPATCH-or-ESCALATE decision when node.status === 'FAILED' -- a
// node stuck at READY was re-issued as a brand-new DISPATCH every tick
// forever, calling the real provider unboundedly with retryCount never
// incrementing. Reproduced directly against unfixed code before this test
// was written (dispatchResearchNodeDurable left the node at READY,
// retryCount 0, and 6 simulated fleet-driver ticks each called
// worker.dispatch() again with no budget ever consulted).
//
// Fix: research-node.mjs's new markResearchNodeDispatchFailed transitions
// READY -> FAILED (added to research-mission.mjs's NODE_ALLOWED table),
// called from research-mission-driver.mjs's dispatchResearchNodeDurable
// right where the clean-failure branch already resolves the dispatch
// attempt ledger. Reuses the EXISTING retryCount/budget machinery
// (recordResearchNodeAttempt + decideRetryOrEscalate) -- no second
// retry-tracking mechanism invented.
import assert from 'node:assert/strict'
import test from 'node:test'
import { rmSync } from 'node:fs'
import path from 'node:path'

const STATE_FILE = path.join(import.meta.dirname, '..', 'server', '.local-state', `operator-state.test-clean-dispatch-failure-${process.pid}.json`)
process.env.TSF_UI_STATE_FILE = STATE_FILE
// Force HEALTHY so the Resource Pressure Governor (F1) never refuses this
// test's dispatches regardless of real host memory pressure at run time --
// same convention chat-dispatch-bridge.test.mjs/F1's checkpoint entry use.
process.env.TSF_RESOURCE_PRESSURE_TEST_TOTAL_BYTES = String(16 * 1024 ** 3)
process.env.TSF_RESOURCE_PRESSURE_TEST_FREE_BYTES = String(8 * 1024 ** 3)
function cleanupStateFile() {
  for (const suffix of ['', '.tmp', '.research.lock']) {
    rmSync(`${STATE_FILE}${suffix}`, { force: true })
  }
}
cleanupStateFile()
test.after(cleanupStateFile)

const { createResearchMissionDurable, dispatchResearchNodeDurable } = await import('../server/research-mission-driver.mjs')
const { readResearchMission } = await import('../server/research-mission-store.mjs')
const { advanceOneMission } = await import('../server/research-mission-fleet-driver.mjs')

const clock = () => new Date('2026-09-07T12:00:00.000Z')

async function setupMission(missionId) {
  const spec = {
    schemaVersion: 'TSF_RESEARCH_SPECIFICATION_V1',
    id: `spec:${missionId}`,
    researchQuestion: 'q',
    entityType: 'FIXTURE',
    requestedFields: [{ fieldName: 'yards', valueType: 'number', required: true }],
    sourcePolicy: { preferredSources: [], disallowedSources: [], licensingConstraints: [], freshnessPolicy: 'UNSPECIFIED', requireIndependentSources: false, minSourceCount: 0, allowCrossMissionLibraryReuse: true },
    temporalRequirements: { asOfDate: '2026-09-07', periodScope: '2020' },
    budget: { maxCostUsd: 0, maxLatencyMs: null, maxToolCallsPerNode: null },
    toolPermissions: []
  }
  await createResearchMissionDurable(
    missionId,
    {
      projectId: 'test',
      specification: spec,
      expectedUniverse: { schemaVersion: 'TSF_EXPECTED_UNIVERSE_V1', entityType: 'FIXTURE', expectedCount: 1, expectedEntities: [{ entityId: 'x', identityHints: {} }] },
      nodes: [{ id: 'node:x', nodeRole: 'PRIMARY_RESEARCH', targetEntity: { entityId: 'x', name: 'X' }, requestedFields: spec.requestedFields, requestedOutputSchema: { type: 'object', properties: {} } }]
    },
    clock
  )
}

// Cleanly rejects every real call -- a synchronous {ok:false}, never a
// throw/timeout -- the exact shape F5 concerns (a permanently
// misconfigured provider call, not an ambiguous crash mid-network-call).
function createCleanlyFailingWorker() {
  let dispatchCalls = 0
  return {
    get dispatchCalls() { return dispatchCalls },
    dispatch: async () => {
      dispatchCalls += 1
      return { ok: false, reason: 'PROVIDER_PERMANENTLY_REJECTED', detail: 'quota exhausted' }
    },
    fetchResult: async () => { throw new Error('a node that never dispatched must never be polled') }
  }
}

test('dispatchResearchNodeDurable: a clean dispatch failure transitions the node READY -> FAILED, not back to READY', async () => {
  const missionId = 'mission:f5-direct-transition'
  await setupMission(missionId)
  const worker = createCleanlyFailingWorker()

  const result = await dispatchResearchNodeDurable(missionId, 'node:x', 'FAKE', worker, clock)
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'PROVIDER_PERMANENTLY_REJECTED')

  const mission = readResearchMission(missionId)
  assert.equal(mission.nodes[0].status, 'FAILED', 'a clean dispatch failure must leave the node FAILED, not READY')
  // The bookkeeping ledger itself (research-dispatch-bookkeeping.mjs) is
  // untouched by this fix -- still correctly records FAILED_CLEAN.
  assert.equal(mission.nodes[0].dispatchAttempts.at(-1).outcome, 'FAILED_CLEAN')
})

test('a repeatedly cleanly-failing node counts toward the real retry budget and the mission escalates to NEEDS_YOU -- never retries forever', async () => {
  const missionId = 'mission:f5-budget-exhaustion'
  await setupMission(missionId)
  const worker = createCleanlyFailingWorker()
  const deps = { worker, providerId: 'FAKE' }

  // Tick 0: fresh DISPATCH (node starts READY) -- cleanly fails -> FAILED, retryCount still 0.
  const tick0 = await advanceOneMission(missionId, clock, deps)
  assert.equal(tick0.action, 'DISPATCHED')
  assert.equal(tick0.dispatchResult.ok, false)
  let mission = readResearchMission(missionId)
  assert.equal(mission.nodes[0].status, 'FAILED')
  assert.equal(mission.nodes[0].retryCount ?? 0, 0)

  // Tick 1: FAILED with retryCount 0 < budget(2) -> RETRY_DISPATCH, retryCount becomes 1, cleanly fails again.
  const tick1 = await advanceOneMission(missionId, clock, deps)
  assert.equal(tick1.action, 'DISPATCHED')
  mission = readResearchMission(missionId)
  assert.equal(mission.nodes[0].status, 'FAILED')
  assert.equal(mission.nodes[0].retryCount, 1, 'retry budget must accumulate on this node\'s real clean-failure history')

  // Tick 2: retryCount 1 < budget(2) -> RETRY_DISPATCH once more, retryCount becomes 2, cleanly fails again.
  const tick2 = await advanceOneMission(missionId, clock, deps)
  assert.equal(tick2.action, 'DISPATCHED')
  mission = readResearchMission(missionId)
  assert.equal(mission.nodes[0].status, 'FAILED')
  assert.equal(mission.nodes[0].retryCount, 2)

  // Tick 3: retryCount 2 >= budget(2) -> ESCALATE, no further real dispatch attempted.
  const tick3 = await advanceOneMission(missionId, clock, deps)
  assert.equal(tick3.action, 'ESCALATED')
  mission = readResearchMission(missionId)
  assert.equal(mission.nodes[0].status, 'BLOCKED')
  assert.equal(mission.state, 'NEEDS_YOU', 'budget exhaustion must reach the real escalation state, not spin forever')
  assert.equal(mission.needsYou.filter((n) => !n.resolvedAt).length, 1)

  // Exactly 3 real network calls total (initial + 2 retries) -- never a 4th.
  assert.equal(worker.dispatchCalls, 3)

  // Ticks after escalation are true no-ops: no further real dispatch call,
  // proving this never degrades back into silent unbounded retry.
  const tick4 = await advanceOneMission(missionId, clock, deps)
  assert.equal(tick4.action, 'SKIPPED')
  assert.equal(worker.dispatchCalls, 3, 'an open Needs You must halt further dispatch, never a silent extra retry')
})

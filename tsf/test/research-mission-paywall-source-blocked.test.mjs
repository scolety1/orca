// Phase 9 (Research Autonomy Chaos / Soak Test), scenario #5: "verify
// web-source-content-access-classifier.mjs's fail-closed classification
// actually prevents a paywalled/blocked page from being silently admitted
// as a real successful source, inside a real composed mission."
//
// web-table-research-worker.test.mjs already proves the WORKER-level
// contract for a robots-refused source ({ok:false}, detail names the real
// reason). web-source-content-access-classifier.test.mjs proves the
// classifier's own pattern-matching in isolation. Neither drives a
// PAYWALL-shaped page (a real 200 response with a paywall interstitial
// body -- content-access-classifier.mjs's own specific reason for
// existing, distinct from the pre-fetch robots gate) through the real
// composed mission driver end to end. This file closes that gap.
import assert from 'node:assert/strict'
import test from 'node:test'
import { rmSync } from 'node:fs'
import path from 'node:path'
import { acquireWebSourceViaStaticTable } from '../domain/web-table-source-adapter.mjs'
import { createWebTableResearchWorker, WEB_TABLE_PROVIDER_ID } from '../adapters/web-table-research-worker.mjs'

const STATE_FILE = path.join(import.meta.dirname, '..', 'server', '.local-state', `operator-state.test-paywall-blocked-${process.pid}.json`)
process.env.TSF_UI_STATE_FILE = STATE_FILE
process.env.TSF_RESOURCE_PRESSURE_TEST_TOTAL_BYTES = String(16 * 1024 ** 3)
process.env.TSF_RESOURCE_PRESSURE_TEST_FREE_BYTES = String(8 * 1024 ** 3)
function cleanupStateFile() {
  for (const suffix of ['', '.tmp', '.research.lock']) { rmSync(`${STATE_FILE}${suffix}`, { force: true }) }
}
cleanupStateFile()
test.after(cleanupStateFile)

const { createResearchMissionDurable, dispatchResearchNodeDurable } = await import('../server/research-mission-driver.mjs')
const { readResearchMission } = await import('../server/research-mission-store.mjs')
const { advanceOneMission } = await import('../server/research-mission-fleet-driver.mjs')

const clock = () => new Date('2026-09-07T12:00:00.000Z')
const publicResolve = async () => [{ address: '93.184.216.34' }]

// A real 200 response whose BODY matches web-source-content-access-
// classifier.mjs's own PAYWALL_PATTERN -- a genuine "looks fine at the
// HTTP layer, is actually a paywall interstitial" page, the exact case
// this classifier exists to catch that no pre-fetch robots-style gate ever
// could (robots.txt says nothing about a subscription wall).
const PAYWALL_HTML = '<html><body><h1>Season Stats</h1><p>Subscribe to continue reading this exclusive content.</p></body></html>'

function fetchImplFor(html) {
  return async () => new Response(html, { status: 200, headers: { 'content-type': 'text/html' } })
}
function paywallAcquireFn(html) {
  return ({ candidate }) =>
    acquireWebSourceViaStaticTable({
      candidate,
      accessInput: { robotsDecision: 'ALLOWED', explicitPublicAllowance: true },
      fetchOptions: { fetchImpl: fetchImplFor(html), resolveImpl: publicResolve },
      clock
    })
}

test('a paywalled source (real 200 response, paywall interstitial body) is never silently admitted as a successful source -- through the real composed mission, real retry budget, real escalation', async () => {
  const missionId = 'mission:paywall-source-blocked'
  const spec = {
    schemaVersion: 'TSF_RESEARCH_SPECIFICATION_V1',
    id: `spec:${missionId}`,
    researchQuestion: 'q',
    entityType: 'FIXTURE',
    requestedFields: [{ fieldName: 'Passing / Yards', valueType: 'number', required: true, derivationRule: null }],
    sourcePolicy: { preferredSources: ['https://example.com/paywalled-stats'], disallowedSources: [], licensingConstraints: [], freshnessPolicy: 'UNSPECIFIED', requireIndependentSources: false, minSourceCount: 0, allowCrossMissionLibraryReuse: true },
    temporalRequirements: { asOfDate: '2026-09-07', periodScope: '1995' },
    budget: { maxCostUsd: 0, maxLatencyMs: null, maxToolCallsPerNode: null },
    toolPermissions: []
  }
  await createResearchMissionDurable(
    missionId,
    {
      projectId: 'test',
      specification: spec,
      expectedUniverse: { schemaVersion: 'TSF_EXPECTED_UNIVERSE_V1', entityType: 'FIXTURE', expectedCount: 1, expectedEntities: [{ entityId: 'entity-x', identityHints: {} }] },
      nodes: [{ id: 'node:x', nodeRole: 'PRIMARY_RESEARCH', targetEntity: { entityId: 'entity-x', name: 'X' }, requestedFields: spec.requestedFields, requestedOutputSchema: { type: 'object', properties: { 'Passing / Yards': { type: 'number' } } } }]
    },
    clock
  )
  const worker = createWebTableResearchWorker({ clock, acquireFn: paywallAcquireFn(PAYWALL_HTML) })

  // Direct proof first: the real dispatch honestly refuses, naming the
  // real reason -- never a fabricated {ok:true} match.
  const dispatched = await dispatchResearchNodeDurable(missionId, 'node:x', WEB_TABLE_PROVIDER_ID, worker, clock)
  assert.equal(dispatched.ok, false, 'a paywalled page must never be reported as a successful dispatch')
  assert.match(dispatched.detail ?? '', /ACCESS_BLOCKED_POST_FETCH/, 'the real, specific access-classifier reason must be named, not a generic failure')
  assert.match(dispatched.detail ?? '', /paywall/i, 'the real classifier reason text (subscription-paywall pattern) must be preserved, not swallowed')

  const nodeAfterDirectAttempt = readResearchMission(missionId).nodes[0]
  assert.equal(nodeAfterDirectAttempt.claims.length, 0, 'no claim was ever admitted from the blocked page')
  assert.equal(nodeAfterDirectAttempt.canonicalFacts.length, 0)

  // Now drive the REAL autonomous fleet driver -- F5's clean-dispatch-
  // failure/retry-budget machinery (unmodified, reused) must correctly
  // treat this exactly like any other clean dispatch failure: retry within
  // budget, then escalate to a real human-visible Needs You. Never a
  // silent, permanent stall and never a false success.
  const deps = { worker, providerId: WEB_TABLE_PROVIDER_ID }
  let lastAction = null
  for (let i = 0; i < 6; i++) {
    // eslint-disable-next-line no-await-in-loop -- sequential real driver ticks
    const tick = await advanceOneMission(missionId, clock, deps)
    lastAction = tick.action
    assert.notEqual(tick.action, 'COMPLETED', `tick ${i}: a mission whose sole source is paywall-blocked must never report COMPLETE`)
    if (lastAction === 'ESCALATED') { break }
  }
  assert.equal(lastAction, 'ESCALATED', 'a permanently paywall-blocked source must reach real escalation within a bounded number of ticks, never loop or stall silently')

  const finalMission = readResearchMission(missionId)
  assert.equal(finalMission.state, 'NEEDS_YOU')
  assert.equal(finalMission.nodes[0].status, 'BLOCKED')
  assert.equal(finalMission.nodes[0].claims.length, 0, 'FINAL PROOF: the paywalled page was never, at any point, admitted as a real claim')
  assert.equal(finalMission.nodes[0].canonicalFacts.length, 0)
})

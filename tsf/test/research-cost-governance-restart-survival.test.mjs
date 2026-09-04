// "GENERIC V0 ADOPTION READINESS" Phase 11 adversarial concern: "restart
// cost-limit reset." The existing driver-level cost-governance test
// proves usage is read fresh from the durable mission on every call
// (research-mission-driver.test.mjs's own comment: "real durable usage
// reflects the real dispatch, not an in-memory counter"), but that is
// still one long-lived process re-reading its own file. This is the
// stronger, real proof: TWO SEPARATE, real `node` child processes --
// genuinely no shared memory, exactly what a real service restart looks
// like -- share only the durable state file on disk. The second process
// must still see and enforce the first process's real spend. Zero real
// network calls anywhere (the FAKE provider never dials out).
import assert from 'node:assert/strict'
import test from 'node:test'
import { spawnSync } from 'node:child_process'
import { rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const HERE = import.meta.dirname
const STATE_FILE = path.join(HERE, '..', 'server', '.local-state', `operator-state.test-cost-restart-survival-${process.pid}.json`)
const WORKER_SCRIPT = path.join(HERE, '..', '.cost-restart-survival-worker-scratch.mjs')

function cleanup() {
  for (const suffix of ['', '.tmp', '.research.lock']) rmSync(`${STATE_FILE}${suffix}`, { force: true })
  rmSync(WORKER_SCRIPT, { force: true })
}
cleanup()

// A tiny, self-contained script run as a genuinely separate `node`
// process. Sets its own env var, dynamically imports the driver (the
// same crash-safe pattern this codebase's other real scripts use), and
// dispatches exactly one $2 FAKE_COST node against a $3 ceiling, printing
// a JSON result line.
const WORKER_SOURCE = `
import path from 'node:path'
process.env.TSF_UI_STATE_FILE = ${JSON.stringify(STATE_FILE)}
async function main() {
  const { createResearchMissionDurable, dispatchResearchNodeDurable } = await import(${JSON.stringify(pathToFileURL(path.join(HERE, '..', 'server', 'research-mission-driver.mjs')).href)})
  const { addResearchNode } = await import(${JSON.stringify(pathToFileURL(path.join(HERE, '..', 'domain', 'research-mission.mjs')).href)})
  const { withResearchMission, readResearchMission } = await import(${JSON.stringify(pathToFileURL(path.join(HERE, '..', 'server', 'research-mission-store.mjs')).href)})
  const clock = () => new Date('2026-12-01T09:00:00.000Z')
  const MISSION_ID = 'mission:cost-restart-survival'
  const nodeId = process.argv[2]
  let mission = await createResearchMissionDurable(MISSION_ID, { projectId: 'fixture:proj', specification: { schemaVersion: 'TSF_RESEARCH_SPECIFICATION_V1', id: 'spec:x', researchQuestion: 'q', entityType: 'X', requestedFields: [], sourcePolicy: { preferredSources: [], disallowedSources: [], licensingConstraints: [], freshnessPolicy: 'HISTORICAL_STATIC', requireIndependentSources: false, minSourceCount: 1 }, temporalRequirements: { asOfDate: '2026-01-01', periodScope: 'p' }, budget: { maxCostUsd: null, maxLatencyMs: 1000, maxToolCallsPerNode: 1 }, toolPermissions: [] }, expectedUniverse: { schemaVersion: 'TSF_EXPECTED_UNIVERSE_V1', entityType: 'X', expectedCount: 0, expectedEntities: [] }, nodes: [] })
  if (!mission.nodes.some((n) => n.id === nodeId)) {
    mission = await withResearchMission(MISSION_ID, (m) => addResearchNode(m, { id: nodeId, nodeRole: 'PRIMARY_RESEARCH', requestedFields: [], requestedOutputSchema: {} }, clock))
  }
  const worker = {
    dispatch: async () => ({ ok: true, workerRunRef: { provider: 'FAKE_COST', providerRunId: nodeId, dispatchedAt: clock().toISOString() } }),
    fetchResult: async () => ({ ok: true, status: 'READY', result: { schemaVersion: 'TSF_BOUNDED_RESEARCH_RESULT_V1', nodeId, taskFingerprint: 'x', provider: 'FAKE_COST', providerRunRef: { provider: 'FAKE_COST', providerRunId: nodeId, dispatchedAt: clock().toISOString() }, status: 'SUCCEEDED', observations: [], proposedClaims: [], evidence: [], sourceReferences: [], sourceSnapshotsOrSnapshotRefs: [], newGapProposals: [], warnings: [], unresolvedQuestions: [], usage: { requestCount: 1, tokensOrUnits: null, providerReportedCostUsd: 0 }, failureDetails: null } })
  }
  const result = await dispatchResearchNodeDurable(MISSION_ID, nodeId, 'FAKE_COST', worker, clock, { costGovernance: { pricingPolicy: { FAKE_COST: { costPerRequestUsd: 2 } }, maxApprovedSpendUsd: 3 } })
  console.log(JSON.stringify({ ok: result.ok, costRefused: result.costRefused ?? false }))
}
main().catch((error) => { console.error(error); process.exit(1) })
`

test('COST GOVERNANCE RESTART SURVIVAL: a real second, independent OS process still sees and enforces the first process\'s real durable spend -- never an in-memory counter that resets', () => {
  writeFileSync(WORKER_SCRIPT, WORKER_SOURCE)
  try {
    const first = spawnSync(process.execPath, [WORKER_SCRIPT, 'node:cost-1'], { encoding: 'utf8' })
    assert.equal(first.status, 0, `first process failed: ${first.stderr}`)
    const firstResult = JSON.parse(first.stdout.trim().split('\n').pop())
    assert.equal(firstResult.ok, true, 'the 1st $2 call is within the $3 ceiling')
    assert.equal(firstResult.costRefused, false)

    // A GENUINELY SEPARATE process -- no shared memory whatsoever with
    // the first. If cost governance held any in-memory state, this is
    // exactly where a restart would silently reset it to $0.
    const second = spawnSync(process.execPath, [WORKER_SCRIPT, 'node:cost-2'], { encoding: 'utf8' })
    assert.equal(second.status, 0, `second process failed: ${second.stderr}`)
    const secondResult = JSON.parse(second.stdout.trim().split('\n').pop())
    assert.equal(secondResult.ok, false, 'the 2nd $2 call would bring cumulative spend to $4, over the $3 ceiling -- a fresh process must still refuse it')
    assert.equal(secondResult.costRefused, true, 'refused by the cost gate specifically, not some other failure')
  } finally {
    cleanup()
  }
})

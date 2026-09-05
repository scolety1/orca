// Hands-on pilot round 3, Bug 1: "user creates a well-specified no-spend
// ResearchMission; user sends zero more messages; autonomy driver
// discovers it; first useful research work is dispatched automatically;
// mission progresses." This is the real, end-to-end regression -- not a
// text-only assertion on Command's chat reply -- spanning the actual
// creation path (command-research-bridge.mjs) and the actual autonomy
// driver (research-mission-fleet-driver.mjs), exactly as a real TSF
// process would run them (once genuinely bootstrapped -- see
// keep-going-fleet-driver-bootstrap.mjs's sibling gap, tracked
// separately).
//
// Uses the same deterministic, $0 fake worker every other research
// autonomy test relies on, configured with requiresPaidApproval:false --
// standing in for a real free/no-new-spend provider (none exists in this
// codebase yet; that gap is disclosed, not solved here). This proves the
// AUTONOMY MECHANISM end to end: Command's own judgment that free-path
// execution is available is exactly what should let a mission progress
// with zero further Tim messages, and the fleet driver is what actually
// carries that out -- never Command's chat reply text alone.
import assert from 'node:assert/strict'
import test from 'node:test'
import { rmSync } from 'node:fs'
import path from 'node:path'
import { createDeterministicFakeResearchWorker } from '../adapters/deterministic-fake-research-worker.mjs'
import { buildBoundedResearchRequest } from '../domain/research-node.mjs'
import { findResearchNode } from '../domain/research-mission.mjs'

const HERE = import.meta.dirname
const STATE_FILE = path.join(HERE, '..', 'server', '.local-state', `operator-state.test-command-research-zero-relay-${process.pid}.json`)
process.env.TSF_UI_STATE_FILE = STATE_FILE
process.env.TSF_PLANNER_CLAUDE_COMMAND = path.join(HERE, 'fixtures', 'stub-planner-cli.mjs')
process.env.TSF_PLANNER_CODEX_COMMAND = path.join(HERE, 'fixtures', 'does-not-exist-binary')
// Forced HEALTHY -- this test is about autonomy mechanics, not resource
// pressure (that interaction is covered by research-resource-pressure-
// interaction.test.mjs).
process.env.TSF_RESOURCE_PRESSURE_TEST_TOTAL_BYTES = String(16 * 1024 ** 3)
process.env.TSF_RESOURCE_PRESSURE_TEST_FREE_BYTES = String(8 * 1024 ** 3)

const { respondCommand } = await import('../server/command-responder.mjs')
const { readResearchMission } = await import('../server/research-mission-store.mjs')
const { advanceOneMission } = await import('../server/research-mission-fleet-driver.mjs')

function cleanupStateFile() {
  for (const suffix of ['', '.tmp', '.research.lock']) {
    rmSync(`${STATE_FILE}${suffix}`, { force: true })
  }
}
cleanupStateFile()
test.after(cleanupStateFile)

const clock = () => new Date('2026-09-06T00:00:00.000Z')

test('ZERO-RELAY BUG 1 REGRESSION: a well-specified no-spend research request, once created, progresses automatically with zero further Tim messages', async () => {
  // Turn 1 (Tim's only message): Command creates the mission via the real
  // synthesis path (stub CLI, deterministic content -- see stub-planner-
  // cli.mjs for the exact fixture this produces).
  const created = await respondCommand({
    message: "research NFL salary cap 2018 through 2020 and give me a sourced dataset. don't spend any money.",
    projects: [],
    opState: { chatThreads: {}, researchMissions: {} },
    clock
  })
  assert.equal(created.researchMissionId != null, true, 'a real mission must exist after creation')
  const missionId = created.researchMissionId
  assert.doesNotMatch(created.text, /ask me to continue/i)

  const missionAfterCreate = readResearchMission(missionId)
  assert.equal(missionAfterCreate.state, 'ACTIVE', 'a well-specified, no-open-Needs-You mission must already be in the exact state research-mission-fleet-driver.mjs discovers on its own')
  assert.equal(missionAfterCreate.needsYou.filter((n) => !n.resolvedAt).length, 0, 'a genuinely no-spend-blocked mission must have no open Needs You -- nothing for Tim to act on')

  // Tim sends ZERO further messages from here on. Everything below is the
  // autonomy driver -- the same advanceOneMission a real setInterval
  // heartbeat would call -- discovering and ticking this mission entirely
  // on its own, using a configured free ($0) worker standing in for a
  // real free/no-new-spend provider.
  const firstNode = missionAfterCreate.nodes[0]
  const script = new Map()
  for (const node of missionAfterCreate.nodes) {
    const request = buildBoundedResearchRequest(missionAfterCreate, node, 'FREE_PUBLIC_SOURCE', clock)
    script.set(request.taskFingerprint, {
      behavior: 'SUCCESS',
      observations: [],
      proposedClaims: node.requestedFields.map((f) => ({
        fieldName: f.fieldName,
        proposedValue: f.valueType === 'number' ? 42 : 'fixture-value',
        temporalScope: null,
        providerConfidence: 0.9,
        providerReasoning: 'deterministic fixture'
      })),
      evidence: node.requestedFields.map((f) => ({
        claimFieldName: f.fieldName,
        sourceRef: `fixture:${node.id}:${f.fieldName}`,
        snippet: 'fixture evidence',
        supportsClaim: true
      })),
      sourceReferences: node.requestedFields.map((f) => ({
        sourceRef: `fixture:${node.id}:${f.fieldName}`,
        url: `https://example.invalid/${node.id}/${f.fieldName}`,
        publisher: 'fixture',
        retrievedAt: '2026-09-06T00:00:00.000Z'
      })),
      sourceSnapshotsOrSnapshotRefs: [],
      newGapProposals: [],
      warnings: [],
      unresolvedQuestions: [],
      usage: { requestCount: 1, tokensOrUnits: 10, providerReportedCostUsd: 0 }
    })
  }
  const worker = createDeterministicFakeResearchWorker({ provider: 'FREE_PUBLIC_SOURCE', script, clock })
  const deps = { worker, providerId: 'FREE_PUBLIC_SOURCE', requiresPaidApproval: false }

  const actionsSeen = []
  for (let i = 0; i < 40; i += 1) {
    const result = await advanceOneMission(missionId, clock, deps) // eslint-disable-line no-await-in-loop
    actionsSeen.push(result.action)
    if (result.action === 'SKIPPED' || result.action === 'COMPLETED') {
      break
    }
  }

  assert.ok(actionsSeen.includes('DISPATCHED'), `the autonomy driver must dispatch real work with zero Tim messages, saw: ${actionsSeen.join(', ')}`)
  assert.ok(actionsSeen.includes('VERIFIED_AND_RECONCILED'), `real verification/reconciliation must occur automatically, saw: ${actionsSeen.join(', ')}`)

  const missionAfterAutonomy = readResearchMission(missionId)
  const nodeAfter = findResearchNode(missionAfterAutonomy, firstNode.id)
  assert.ok(nodeAfter.dispatchRecords.length > 0, 'a real dispatch record must exist -- the mission genuinely progressed, not merely a re-worded chat reply')
  assert.ok(nodeAfter.canonicalFacts.length > 0, 'real canonical facts must exist -- the mission produced real, verified output automatically')
})

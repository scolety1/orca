// Phase 9 (Research Autonomy Chaos / Soak Test), scenario #10: "verify
// llm-latent-knowledge-research-worker.mjs (the Cross-Provider Research
// Worker Reconciliation V2 capability) correctly participates in a real
// composed mission's epistemic ladder: its candidate NEVER gets silently
// promoted to canonical/verified without independent verification -- this
// is the single most important epistemic-safety property to re-confirm
// given this worker's unusually weak provenance by design."
//
// research-golden-path-eval-runner.mjs already proves the TWO-provider
// case (a grounded claim vs. a latent-recall claim disagreeing -> real
// conflict escalation -> a human picks the grounded one). This file proves
// the STRICTER, genuinely under-tested case: this worker as the SOLE
// source for a field -- no second provider, no conflict to trigger an
// escalation the "normal" way -- through the real autonomous driver
// (research-mission-fleet-driver.mjs), never a hand-inlined domain call.
import assert from 'node:assert/strict'
import test from 'node:test'
import { rmSync } from 'node:fs'
import path from 'node:path'
import { createLlmLatentKnowledgeResearchWorker } from '../adapters/llm-latent-knowledge-research-worker.mjs'

const STATE_FILE = path.join(import.meta.dirname, '..', 'server', '.local-state', `operator-state.test-latent-sole-source-${process.pid}.json`)
process.env.TSF_UI_STATE_FILE = STATE_FILE
process.env.TSF_RESOURCE_PRESSURE_TEST_TOTAL_BYTES = String(16 * 1024 ** 3)
process.env.TSF_RESOURCE_PRESSURE_TEST_FREE_BYTES = String(8 * 1024 ** 3)
function cleanupStateFile() {
  for (const suffix of ['', '.tmp', '.research.lock']) { rmSync(`${STATE_FILE}${suffix}`, { force: true }) }
}
cleanupStateFile()
test.after(cleanupStateFile)

const { createResearchMissionDurable } = await import('../server/research-mission-driver.mjs')
const { readResearchMission } = await import('../server/research-mission-store.mjs')
const { advanceOneMission } = await import('../server/research-mission-fleet-driver.mjs')

const clock = () => new Date('2026-09-07T12:00:00.000Z')
const ENV_VAR = 'TSF_RESEARCH_LATENT_KNOWLEDGE_DISPATCH_ENABLED'

function fakeInvoke(answer) {
  return async () => ({
    ok: true,
    role: 'PLANNER_DEEP',
    data: { answers: [answer] },
    agentId: 'fake-agent',
    providerId: 'fake-provider',
    model: 'fake-model',
    costUsd: 0
  })
}

async function withEnv(vars, fn) {
  const prior = {}
  for (const key of Object.keys(vars)) { prior[key] = process.env[key] }
  Object.assign(process.env, vars)
  try {
    return await fn()
  } finally {
    for (const key of Object.keys(vars)) {
      if (prior[key] === undefined) { delete process.env[key] } else { process.env[key] = prior[key] }
    }
  }
}

test('a sole, un-corroborated latent-knowledge claim is never silently promoted to VERIFIED/canonical -- it is honestly retried then escalated to a human, exactly like any other unverifiable result', async () => {
  await withEnv({ [ENV_VAR]: '1' }, async () => {
    const missionId = 'mission:latent-sole-source'
    const spec = {
      schemaVersion: 'TSF_RESEARCH_SPECIFICATION_V1',
      id: `spec:${missionId}`,
      researchQuestion: 'What is the fixture value?',
      entityType: 'FIXTURE',
      requestedFields: [{ fieldName: 'value', valueType: 'string', required: true }],
      sourcePolicy: { preferredSources: [], disallowedSources: [], licensingConstraints: [], freshnessPolicy: 'UNSPECIFIED', requireIndependentSources: false, minSourceCount: 0 },
      temporalRequirements: { asOfDate: '2026-09-07', periodScope: 'FIXTURE_SCOPE' },
      budget: { maxCostUsd: 0, maxLatencyMs: null, maxToolCallsPerNode: null },
      toolPermissions: []
    }
    await createResearchMissionDurable(
      missionId,
      {
        projectId: 'test',
        specification: spec,
        expectedUniverse: { schemaVersion: 'TSF_EXPECTED_UNIVERSE_V1', entityType: 'FIXTURE', expectedCount: 1, expectedEntities: [{ entityId: 'entity-x', identityHints: {} }] },
        nodes: [{ id: 'node:x', nodeRole: 'PRIMARY_RESEARCH', targetEntity: { entityId: 'entity-x' }, requestedFields: spec.requestedFields, requestedOutputSchema: { type: 'object', properties: { value: { type: 'string' } } } }]
      },
      clock
    )

    // A confident-SOUNDING recall (high providerConfidence) -- this test's
    // whole point is that confidence alone must never substitute for real,
    // independent evidence.
    const worker = createLlmLatentKnowledgeResearchWorker({
      clock,
      invokeLiveStructuredAnalysisFn: fakeInvoke({ fieldName: 'value', status: 'KNOWN', value: 'a confidently-recalled but uncorroborated answer', confidence: 0.97, reasoning: 'the model claims strong recall', rememberedSourceContext: null })
    })
    const deps = { worker, providerId: 'LLM_LATENT_KNOWLEDGE_RECALL' }

    // Tick 0: DISPATCH.
    const tick0 = await advanceOneMission(missionId, clock, deps)
    assert.equal(tick0.action, 'DISPATCHED')
    assert.equal(tick0.dispatchResult.ok, true)

    // Tick 1: POLL -> admission. The claim is admitted (real content is
    // never suppressed), but with EMPTY evidence/sourceReferences -- the
    // worker's own honest design (no fabricated citation).
    const tick1 = await advanceOneMission(missionId, clock, deps)
    assert.equal(tick1.action, 'POLLED')
    let node = readResearchMission(missionId).nodes.find((n) => n.id === 'node:x')
    assert.equal(node.status, 'ADMITTED')
    assert.equal(node.claims.length, 1)
    assert.equal(node.claims[0].proposedValue, 'a confidently-recalled but uncorroborated answer')
    assert.equal(node.claims[0].status, 'UNVERIFIED')
    assert.equal(node.evidence.length, 0, 'no fabricated evidence -- this worker never invents a citation')
    assert.equal(node.sourceSnapshots[0].chainOfCustody.provenanceStrength, 'NONE', 'honestly the weakest provenance tier, exactly as designed')

    // Tick 2: VERIFY_AND_RECONCILE_FIELD -- verifyResearchClaim's own rule
    // (zero supporting evidence -> INCONCLUSIVE, never PASS) fires for real
    // here, through the actual driver, not a direct domain call.
    const tick2 = await advanceOneMission(missionId, clock, deps)
    assert.equal(tick2.action, 'VERIFIED_AND_RECONCILED')
    assert.equal(tick2.result.canonicalized, false, 'REQUIRED PROOF: never silently canonicalized')
    node = readResearchMission(missionId).nodes.find((n) => n.id === 'node:x')
    assert.equal(node.verifications[0].verdict, 'INCONCLUSIVE')
    assert.equal(node.claims[0].status, 'UNVERIFIED', 'never silently promoted to VERIFIED off confidence alone')
    assert.equal(node.canonicalFacts.length, 0, 'REQUIRED PROOF: never silently canonicalized')

    // Ticks 3+: the mission never gets stuck silently -- it either retries
    // (bounded, same F5 budget machinery every other unverifiable result
    // uses) or escalates; either way it is NEVER silently reported COMPLETE
    // with this field unresolved, and canonicalFacts stays empty throughout.
    let finalTick = null
    for (let i = 3; i <= 10; i++) {
      // eslint-disable-next-line no-await-in-loop -- sequential real driver ticks
      finalTick = await advanceOneMission(missionId, clock, deps)
      const current = readResearchMission(missionId)
      assert.equal(current.nodes[0].canonicalFacts.length, 0, `tick ${i}: still never canonicalized`)
      assert.notEqual(finalTick.action, 'COMPLETED', `tick ${i}: a sole unverifiable claim must never let the mission report COMPLETE`)
      if (finalTick.action === 'ESCALATED' || current.state === 'NEEDS_YOU') { break }
    }

    const final = readResearchMission(missionId)
    assert.equal(final.nodes[0].canonicalFacts.length, 0, 'FINAL PROOF: an un-corroborated latent-knowledge claim was never, at any point, silently promoted to a CanonicalFact')
    assert.notEqual(final.state, 'COMPLETE', 'the mission itself must never be reported done while this field is genuinely unresolved')
  })
})

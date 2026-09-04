// "GENERIC V0 ADOPTION READINESS" Phase 8: customer-mission boundary
// proof. A deterministic/mock ResearchSpecification shaped like the NWR
// Historical Redraft Data mission (multi-season universe, point-in-time
// fields, a separate outcome lane, historical as-of requirement, identity
// requirements, source-policy constraints, typed missingness, candidate
// artifact package) run through the REAL, unmodified, generic driver --
// zero NWR-specific code anywhere in domain/server. This deliberately
// acquires NO real historical projections/ADP data (contract
// compatibility only, per HQ's explicit scope for this phase).
//
// The entityType/fieldNames below are intentionally generic
// ("GENERIC_CUSTOMER_HISTORICAL_MARKET_ENTITY", "preDecisionMarketValue",
// "seasonEndOutcomeScore") rather than NFL/NWR-specific, proving the
// engine represents this shape without borrowing any fantasy-football
// naming -- exactly the same proof discipline as the non-NFL GitHub
// genericity proof, applied to the temporal-boundary concern instead of
// the acquisition-source concern.
import assert from 'node:assert/strict'
import test from 'node:test'
import { rmSync } from 'node:fs'
import path from 'node:path'
import { createDeterministicFakeResearchWorker } from '../adapters/deterministic-fake-research-worker.mjs'
import { buildBoundedResearchRequest } from '../domain/research-node.mjs'

const HERE = import.meta.dirname
const STATE_FILE = path.join(HERE, '..', 'server', '.local-state', `operator-state.test-customer-temporal-boundary-${process.pid}.json`)
process.env.TSF_UI_STATE_FILE = STATE_FILE

function cleanupStateFile() {
  for (const suffix of ['', '.tmp', '.research.lock']) rmSync(`${STATE_FILE}${suffix}`, { force: true })
}
cleanupStateFile()

const {
  createResearchMissionDurable,
  dispatchResearchNodeDurable,
  pollAndAdmitResearchNodeDurable,
  readResearchMissionArtifacts,
  readResearchMissionCompleteness,
  verifyAndReconcileResearchNodeFieldDurable
} = await import('../server/research-mission-driver.mjs')
const { readResearchMission } = await import('../server/research-mission-store.mjs')

const clock = () => new Date('2026-11-15T09:00:00.000Z')
const MISSION_ID = 'mission:customer-temporal-boundary-proof'

test('customer-mission boundary: a deterministic, NWR-shaped specification (multi-season, point-in-time + outcome fields, identity, source policy, typed missingness) runs through the real generic driver with zero NWR-specific code', async (t) => {
  try {
    // ---- 1. A customer-shaped ResearchSpecification, entirely generic naming ----
    const specification = {
      schemaVersion: 'TSF_RESEARCH_SPECIFICATION_V1',
      id: 'spec:customer-temporal-boundary-proof-v0',
      researchQuestion: 'Contract-compatibility proof only: can a multi-season, point-in-time-vs-outcome customer dataset be expressed and enforced generically?',
      entityType: 'GENERIC_CUSTOMER_HISTORICAL_MARKET_ENTITY',
      requestedFields: [
        // Pre-decision, point-in-time field -- must be a genuine
        // contemporaneous snapshot, never a later reconstruction or an
        // outcome, no matter how well-evidenced.
        { fieldName: 'preDecisionMarketValue', valueType: 'number', required: true, requiredTemporalClass: 'CONTEMPORANEOUS_SNAPSHOT', requiredTemporalScopes: ['period:2012-season-start'] },
        // Separate outcome lane -- genuinely different temporal class,
        // genuinely allowed to be OUTCOME_DATA.
        { fieldName: 'seasonEndOutcomeScore', valueType: 'number', required: false, requiredTemporalClass: 'OUTCOME_DATA', requiredTemporalScopes: ['period:2012-season-end'] }
      ],
      sourcePolicy: {
        preferredSources: ['customer-provided-market-archive.example'],
        disallowedSources: ['unlicensed-scrape.example'],
        licensingConstraints: ['customer license: internal use only, no redistribution'],
        freshnessPolicy: 'HISTORICAL_STATIC',
        requireIndependentSources: false,
        minSourceCount: 1,
        allowCrossMissionLibraryReuse: false
      },
      temporalRequirements: { asOfDate: '2012-09-01', periodScope: 'period:2012-season-start' },
      budget: { maxCostUsd: 0, maxLatencyMs: 30000, maxToolCallsPerNode: 1 },
      toolPermissions: ['fake-research-worker'],
      expectedUniverse: {
        schemaVersion: 'TSF_EXPECTED_UNIVERSE_V1',
        entityType: 'GENERIC_CUSTOMER_HISTORICAL_MARKET_ENTITY',
        // Multi-season universe: entities from two different seasons.
        expectedCount: 2,
        expectedEntities: [
          { entityId: 'entity:2012:market-actor-a', identityHints: { season: '2012', role: 'actor-a' } },
          { entityId: 'entity:2013:market-actor-b', identityHints: { season: '2013', role: 'actor-b' } }
        ],
        source: 'mock/deterministic -- contract-compatibility proof only, not a real oracle'
      }
    }

    const nodes = [
      { id: 'node:actor-a', nodeRole: 'PRIMARY_RESEARCH', targetEntity: { entityId: 'entity:2012:market-actor-a' }, requestedFields: specification.requestedFields, requestedOutputSchema: { type: 'object' } },
      { id: 'node:actor-b', nodeRole: 'PRIMARY_RESEARCH', targetEntity: { entityId: 'entity:2013:market-actor-b' }, requestedFields: specification.requestedFields, requestedOutputSchema: { type: 'object' } }
    ]

    await createResearchMissionDurable(MISSION_ID, { projectId: 'customer-temporal-boundary-proof', specification, expectedUniverse: specification.expectedUniverse, nodes })

    const script = new Map()
    const worker = createDeterministicFakeResearchWorker({ provider: 'FAKE', clock, script })

    await t.test('actor A: a CORRECTLY-tagged CONTEMPORANEOUS_SNAPSHOT claim satisfies the point-in-time field', async () => {
      const mission = readResearchMission(MISSION_ID)
      const node = mission.nodes.find((n) => n.id === 'node:actor-a')
      const request = buildBoundedResearchRequest(mission, node, 'FAKE', clock)
      script.set(request.taskFingerprint, {
        proposedClaims: [
          { fieldName: 'preDecisionMarketValue', proposedValue: 100, temporalScope: 'period:2012-season-start', temporalClass: 'CONTEMPORANEOUS_SNAPSHOT', providerConfidence: 0.9, providerReasoning: 'genuinely observed at the time' }
        ],
        evidence: [{ claimFieldName: 'preDecisionMarketValue', sourceRef: 'src:contemporaneous-1', snippet: 'a real, period-appropriate market record', supportsClaim: true }],
        sourceReferences: [{ sourceRef: 'src:contemporaneous-1', url: 'https://example.invalid/2012-snapshot', publisher: 'customer-provided-market-archive.example', retrievedAt: clock().toISOString() }]
      })
      const dispatched = await dispatchResearchNodeDurable(MISSION_ID, 'node:actor-a', 'FAKE', worker, clock)
      assert.equal(dispatched.ok, true)
      const polled = await pollAndAdmitResearchNodeDurable(MISSION_ID, 'node:actor-a', worker, clock)
      assert.equal(polled.ok, true)
      const claim = readResearchMission(MISSION_ID).nodes.find((n) => n.id === 'node:actor-a').claims[0]
      assert.equal(claim.temporalClass, 'CONTEMPORANEOUS_SNAPSHOT')

      const result = await verifyAndReconcileResearchNodeFieldDurable(MISSION_ID, 'node:actor-a', 'preDecisionMarketValue', 'CUSTOMER_BOUNDARY_TEST', clock)
      assert.equal(result.canonicalized, true, 'a genuinely period-matching, correctly-classed claim canonicalizes normally')
      const actorANode = readResearchMission(MISSION_ID).nodes.find((n) => n.id === 'node:actor-a')
      assert.equal(actorANode.canonicalFacts[0].value, 100)
    })

    await t.test('actor B: an OUTCOME_DATA claim CANNOT satisfy the CONTEMPORANEOUS_SNAPSHOT-required field, even with strong supporting evidence -- proven generically, zero NWR-specific code', async () => {
      const mission = readResearchMission(MISSION_ID)
      const node = mission.nodes.find((n) => n.id === 'node:actor-b')
      const request = buildBoundedResearchRequest(mission, node, 'FAKE', clock)
      // A real, plausible customer mistake: someone tries to backfill the
      // PRE-DECISION field using a later, well-evidenced OUTCOME record --
      // it "exists" and has real supporting evidence, but it is the wrong
      // temporal class for what this field actually requires.
      script.set(request.taskFingerprint, {
        proposedClaims: [
          { fieldName: 'preDecisionMarketValue', proposedValue: 999, temporalScope: 'period:2012-season-start', temporalClass: 'OUTCOME_DATA', providerConfidence: 0.95, providerReasoning: 'derived after the fact from the season\'s outcome, not observed at the time' }
        ],
        evidence: [
          { claimFieldName: 'preDecisionMarketValue', sourceRef: 'src:outcome-1', snippet: 'strong, real, well-corroborated outcome evidence', supportsClaim: true },
          { claimFieldName: 'preDecisionMarketValue', sourceRef: 'src:outcome-2', snippet: 'a second, independent outcome record agreeing with the first', supportsClaim: true }
        ],
        sourceReferences: [
          { sourceRef: 'src:outcome-1', url: 'https://example.invalid/2012-outcome-1', publisher: 'outcome-archive-a.example', retrievedAt: clock().toISOString() },
          { sourceRef: 'src:outcome-2', url: 'https://example.invalid/2012-outcome-2', publisher: 'outcome-archive-b.example', retrievedAt: clock().toISOString() }
        ]
      })
      await dispatchResearchNodeDurable(MISSION_ID, 'node:actor-b', 'FAKE', worker, clock)
      await pollAndAdmitResearchNodeDurable(MISSION_ID, 'node:actor-b', worker, clock)

      const result = await verifyAndReconcileResearchNodeFieldDurable(MISSION_ID, 'node:actor-b', 'preDecisionMarketValue', 'CUSTOMER_BOUNDARY_TEST', clock)
      assert.equal(result.canonicalized, false, 'outcome evidence must never satisfy a pre-decision field merely because it exists and is well-evidenced')
      const actorBNode = readResearchMission(MISSION_ID).nodes.find((n) => n.id === 'node:actor-b')
      assert.equal(actorBNode.canonicalFacts.length, 0)
      assert.equal(actorBNode.claims[0].status, 'REJECTED', 'the claim is explicitly REJECTED, not silently left pending or fabricated as satisfying')
      const verification = actorBNode.verifications.at(-1)
      assert.equal(verification.verdict, 'FAIL')
      assert.equal(verification.assertionResults.find((a) => a.path === 'temporalClassMatches')?.passed, false, 'the temporal-class assertion is the one that actually failed, not e.g. evidence support')
    })

    await t.test('typed missingness: an honestly-missing outcome field is recorded, not silently coerced', async () => {
      const mission = readResearchMission(MISSION_ID)
      const node = mission.nodes.find((n) => n.id === 'node:actor-a')
      const request = buildBoundedResearchRequest(mission, node, 'FAKE_MISSING', clock)
      script.set(request.taskFingerprint, {
        proposedClaims: [
          { fieldName: 'seasonEndOutcomeScore', proposedValue: null, temporalScope: 'period:2012-season-end', temporalClass: 'OUTCOME_DATA', providerConfidence: null, providerReasoning: 'the season had not concluded at data-collection time' }
        ],
        evidence: [],
        sourceReferences: []
      })
      await dispatchResearchNodeDurable(MISSION_ID, 'node:actor-a', 'FAKE_MISSING', worker, clock)
      await pollAndAdmitResearchNodeDurable(MISSION_ID, 'node:actor-a', worker, clock)
      const missing = readResearchMission(MISSION_ID).nodes.find((n) => n.id === 'node:actor-a').typedMissingness.find((m) => m.fieldName === 'seasonEndOutcomeScore')
      assert.ok(missing, 'the outcome field is recorded as honest typed missingness, not silently zero/absent')
      assert.equal(missing.temporalClass, 'OUTCOME_DATA')
    })

    await t.test('candidate artifact package: completeness + provenance artifacts are produced through the unmodified generic driver, no NWR-specific code required', async () => {
      const completeness = readResearchMissionCompleteness(MISSION_ID, clock)
      assert.equal(completeness.schemaVersion, 'TSF_COMPLETENESS_METRICS_V1')
      assert.equal(completeness.expectedEntityCoverage, 1, 'both expected entities are present as nodes')
      const artifacts = readResearchMissionArtifacts(MISSION_ID, clock)
      assert.ok(artifacts.packageBody.nodes.length >= 2)
      const actorANode = artifacts.packageBody.nodes.find((n) => n.id === 'node:actor-a')
      assert.equal(actorANode.canonicalFacts.length, 1, 'the candidate package surfaces the one genuinely canonicalized fact')
    })
  } finally {
    cleanupStateFile()
  }
})

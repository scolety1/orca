// Finding F6 (Autonomous Reliability Hardening Overnight V1, Phase 1):
// small, generic, disposable ResearchSpecification/node fixture for the
// real cross-process crash test -- deliberately NOT NFL/NWR-shaped (unlike
// nfl-2001-qb-research-fixture.mjs, this repo's usual research-mission
// fixture), per this finding's own hard constraint on fixture data. Shared
// by the spawned child worker and the parent test so both sides agree on
// exactly one node/field shape without duplicating it.
export const PERIOD_SCOPE = 'fixture-crash-test-period'
export const FIELD_NAME = 'value'
export const ENTITY_ID = 'fixture:crash-node-1'

export function buildGenericCrashFixtureSpecification() {
  return {
    schemaVersion: 'TSF_RESEARCH_SPECIFICATION_V1',
    id: 'spec:generic-crash-fixture-v1',
    researchQuestion: 'What is the fixture value for the disposable test entity?',
    entityType: 'FIXTURE_ENTITY',
    requestedFields: [{ fieldName: FIELD_NAME, valueType: 'string', required: true, derivationRule: null }],
    sourcePolicy: {
      preferredSources: [],
      disallowedSources: [],
      licensingConstraints: [],
      freshnessPolicy: 'UNSPECIFIED',
      requireIndependentSources: false,
      minSourceCount: 0
    },
    temporalRequirements: { asOfDate: '2026-09-07', periodScope: PERIOD_SCOPE },
    budget: { maxCostUsd: null, maxLatencyMs: 60000, maxToolCallsPerNode: 5 },
    toolPermissions: ['fake-research-worker'],
    expectedUniverse: {
      schemaVersion: 'TSF_EXPECTED_UNIVERSE_V1',
      entityType: 'FIXTURE_ENTITY',
      expectedCount: 1,
      expectedEntities: [{ entityId: ENTITY_ID, identityHints: {} }]
    }
  }
}

export function buildGenericCrashFixtureMissionInput(missionId, nodeId) {
  const specification = buildGenericCrashFixtureSpecification()
  return {
    projectId: 'fixture:crash-test',
    specification,
    expectedUniverse: specification.expectedUniverse,
    nodes: [
      {
        id: nodeId,
        nodeRole: 'PRIMARY_RESEARCH',
        targetEntity: { entityId: ENTITY_ID, name: 'Fixture Entity' },
        requestedFields: specification.requestedFields,
        requestedOutputSchema: { type: 'object', properties: { [FIELD_NAME]: { type: 'string' } } }
      }
    ]
  }
}

// One canned, single-source, single-evidence claim -- the same minimal
// shape research-mission-driver.test.mjs's own scriptedResult() already
// proves is sufficient to reach VERIFIED -> canonicalized (independent
// lineage count of 1 satisfies verifyResearchClaim's own >=1 requirement).
export function genericScriptEntry() {
  return {
    proposedClaims: [{ fieldName: FIELD_NAME, proposedValue: 'fixture-value', temporalScope: PERIOD_SCOPE, providerConfidence: 0.9, providerReasoning: 'fixture reasoning' }],
    evidence: [{ claimFieldName: FIELD_NAME, sourceRef: 'src:fixture-1', snippet: 'fixture snippet', supportsClaim: true }],
    sourceReferences: [{ sourceRef: 'src:fixture-1', url: 'https://example.invalid/fixture', publisher: 'fixture-publisher', retrievedAt: '2026-09-07T12:00:00.000Z' }],
    sourceSnapshotsOrSnapshotRefs: [{ sourceRef: 'src:fixture-1', contentHash: 'sha256:fixture', rawContentRef: 'fixture://value' }],
    usage: { requestCount: 1, tokensOrUnits: 5, providerReportedCostUsd: 0 }
  }
}

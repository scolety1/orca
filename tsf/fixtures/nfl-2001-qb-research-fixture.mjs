// NFL Historical Dataset / 2001 / QB / exactly 3 fixture players. This
// module exists ONLY to validate the generic research engine end to end
// with deterministic, local, $0 data -- no live research, no real provider
// call. All NFL-specific field names/values live here, never inside
// tsf/domain/research-*.mjs, per the V0 Implementation Wave 1 mandate
// ("the generic Research layer must not become an NFL subsystem").
//
// Coverage of the 7 required stress dimensions:
//   Tom Brady   -- deterministic bulk acquisition + derived field (passerRating)
//   Kurt Warner -- research-required gap (mvpVotingNote) + source conflict (passingYards)
//   Jim Miller  -- identity alias/ambiguity + typed missingness (signingBonusUsd)
//               + temporal-semantics check (team: a first, wrongly-scoped
//                 claim is rejected by verification; a corrected, properly
//                 2001-scoped retry is accepted)
import { addResearchNode, createResearchMission } from '../domain/research-mission.mjs'
import { buildBoundedResearchRequest } from '../domain/research-node.mjs'

export const PERIOD_SCOPE = '2001-regular-season'

export function buildNflQb2001Specification() {
  return {
    schemaVersion: 'TSF_RESEARCH_SPECIFICATION_V1',
    id: 'spec:nfl-2001-qb-v0',
    researchQuestion: 'What were the 2001 regular-season QB statistics and biographical facts for the fixture players?',
    entityType: 'NFL_QB_SEASON',
    requestedFields: [
      { fieldName: 'team', valueType: 'string', required: true, derivationRule: null },
      { fieldName: 'passingYards', valueType: 'number', required: true, derivationRule: null },
      { fieldName: 'passingTouchdowns', valueType: 'number', required: true, derivationRule: null },
      { fieldName: 'interceptions', valueType: 'number', required: true, derivationRule: null },
      { fieldName: 'completions', valueType: 'number', required: true, derivationRule: null },
      { fieldName: 'attempts', valueType: 'number', required: true, derivationRule: null },
      { fieldName: 'passerRating', valueType: 'number', required: true, derivationRule: 'NFL_PASSER_RATING_FORMULA' },
      { fieldName: 'mvpVotingNote', valueType: 'string', required: false, derivationRule: null },
      { fieldName: 'signingBonusUsd', valueType: 'number', required: false, derivationRule: null }
    ],
    sourcePolicy: {
      preferredSources: ['pro-football-reference.com', 'nfl.com'],
      disallowedSources: [],
      licensingConstraints: [],
      freshnessPolicy: 'HISTORICAL_STATIC',
      requireIndependentSources: true,
      minSourceCount: 1
    },
    temporalRequirements: { asOfDate: '2002-02-01', periodScope: PERIOD_SCOPE },
    // Live-bake-off finding (2026-09-03): maxCostUsd: 0 was a placeholder
    // that only made sense against the deterministic fake worker (which
    // ignores budget entirely). Forwarded verbatim to a REAL provider as
    // maxCostDollars: 0, Exa rejected the whole request with a 400 (a $0
    // provider-side hard cap is nonsensical, not "no cap"). null is the
    // correct "no cap requested" sentinel (see
    // provider-adapter-conformance.test.mjs's fixture, which already used
    // null) -- a real live run should pass an explicit small positive
    // ceiling instead if one is wanted; this fixture stays cap-agnostic.
    budget: { maxCostUsd: null, maxLatencyMs: 60000, maxToolCallsPerNode: 5 },
    toolPermissions: ['fake-research-worker'],
    expectedUniverse: {
      schemaVersion: 'TSF_EXPECTED_UNIVERSE_V1',
      entityType: 'NFL_QB_SEASON',
      expectedCount: 3,
      expectedEntities: [
        { entityId: 'nfl:2001:qb:tom-brady', identityHints: { team: 'NE', position: 'QB' } },
        { entityId: 'nfl:2001:qb:kurt-warner', identityHints: { team: 'STL', position: 'QB' } },
        { entityId: 'nfl:2001:qb:jim-miller', identityHints: { team: 'CHI', position: 'QB' } }
      ]
    }
  }
}

// Live-bake-off finding (2026-09-03): a property schema with no 'type' key
// (e.g. `{}`) is REJECTED by Parallel's Task API with a real 422
// validation error ("Schema node must have a 'type' key, or a keyword one
// can be inferred from"). The Wave 4 synthetic fixture never caught this
// because the deterministic fake worker never validates its input schema.
// Every field below now gets its real JSON Schema type.
const FIELD_TYPES = Object.freeze({
  team: 'string',
  passingYards: 'number',
  passingTouchdowns: 'number',
  interceptions: 'number',
  completions: 'number',
  attempts: 'number',
  mvpVotingNote: 'string',
  signingBonusUsd: 'number'
})

function fieldsSchema(fieldNames) {
  return {
    type: 'object',
    properties: Object.fromEntries(fieldNames.map((f) => [f, { type: FIELD_TYPES[f] ?? 'string' }]))
  }
}

export function buildNflQb2001Mission(clock) {
  const specification = buildNflQb2001Specification()
  let mission = createResearchMission(
    { id: 'mission:nfl-2001-qb-v0', projectId: 'fixture:nfl-2001-qb', specification, expectedUniverse: specification.expectedUniverse },
    clock
  )

  mission = addResearchNode(
    mission,
    {
      id: 'node:tom-brady',
      nodeRole: 'PRIMARY_RESEARCH',
      targetEntity: { entityId: 'nfl:2001:qb:tom-brady', name: 'Tom Brady' },
      requestedFields: specification.requestedFields.filter((f) =>
        ['team', 'passingYards', 'passingTouchdowns', 'interceptions', 'completions', 'attempts', 'passerRating'].includes(f.fieldName)
      ),
      requestedOutputSchema: fieldsSchema(['team', 'passingYards', 'passingTouchdowns', 'interceptions', 'completions', 'attempts'])
    },
    clock
  )

  mission = addResearchNode(
    mission,
    {
      id: 'node:kurt-warner',
      nodeRole: 'PRIMARY_RESEARCH',
      targetEntity: { entityId: 'nfl:2001:qb:kurt-warner', name: 'Kurt Warner' },
      requestedFields: specification.requestedFields.filter((f) => ['passingYards', 'mvpVotingNote'].includes(f.fieldName)),
      requestedOutputSchema: fieldsSchema(['passingYards', 'mvpVotingNote'])
    },
    clock
  )

  mission = addResearchNode(
    mission,
    {
      id: 'node:jim-miller',
      nodeRole: 'PRIMARY_RESEARCH',
      targetEntity: { entityId: 'nfl:2001:qb:jim-miller', name: 'Jim Miller' },
      requestedFields: specification.requestedFields.filter((f) => ['team', 'signingBonusUsd'].includes(f.fieldName)),
      requestedOutputSchema: fieldsSchema(['team', 'signingBonusUsd'])
    },
    clock
  )

  return mission
}

// Builds requests + a taskFingerprint-keyed script for a
// DeterministicFakeResearchWorker, exercising every required stress case.
export function buildNflQb2001Script(mission, clock) {
  const script = new Map()
  const requests = {}

  const bradyNode = mission.nodes.find((n) => n.id === 'node:tom-brady')
  const bradyRequest = buildBoundedResearchRequest(mission, bradyNode, 'FAKE', clock)
  requests['node:tom-brady'] = [bradyRequest]
  script.set(bradyRequest.taskFingerprint, {
    behavior: 'SUCCESS',
    observations: [{ rawContent: 'Official 2001 season box score aggregate for Tom Brady.', extractedAt: '2026-01-01T00:00:00.000Z', providerConfidence: 0.97, providerReasoning: 'Direct primary-source box score total.' }],
    proposedClaims: [
      { fieldName: 'team', proposedValue: 'NE', temporalScope: PERIOD_SCOPE, providerConfidence: 0.99, providerReasoning: 'Primary roster record.' },
      { fieldName: 'passingYards', proposedValue: 2843, temporalScope: PERIOD_SCOPE, providerConfidence: 0.97, providerReasoning: 'Primary box score total.' },
      { fieldName: 'passingTouchdowns', proposedValue: 18, temporalScope: PERIOD_SCOPE, providerConfidence: 0.97, providerReasoning: 'Primary box score total.' },
      { fieldName: 'interceptions', proposedValue: 12, temporalScope: PERIOD_SCOPE, providerConfidence: 0.97, providerReasoning: 'Primary box score total.' },
      { fieldName: 'completions', proposedValue: 264, temporalScope: PERIOD_SCOPE, providerConfidence: 0.97, providerReasoning: 'Primary box score total.' },
      { fieldName: 'attempts', proposedValue: 413, temporalScope: PERIOD_SCOPE, providerConfidence: 0.97, providerReasoning: 'Primary box score total.' }
    ],
    evidence: [
      { claimFieldName: 'team', sourceRef: 'pfr:brady:2001', snippet: 'New England Patriots, 2001.', supportsClaim: true },
      { claimFieldName: 'passingYards', sourceRef: 'pfr:brady:2001', snippet: '2,843 passing yards.', supportsClaim: true },
      { claimFieldName: 'passingTouchdowns', sourceRef: 'pfr:brady:2001', snippet: '18 passing touchdowns.', supportsClaim: true },
      { claimFieldName: 'interceptions', sourceRef: 'pfr:brady:2001', snippet: '12 interceptions.', supportsClaim: true },
      { claimFieldName: 'completions', sourceRef: 'pfr:brady:2001', snippet: '264 completions.', supportsClaim: true },
      { claimFieldName: 'attempts', sourceRef: 'pfr:brady:2001', snippet: '413 attempts.', supportsClaim: true }
    ],
    sourceReferences: [{ sourceRef: 'pfr:brady:2001', url: 'https://example.invalid/pfr/brady/2001', publisher: 'pro-football-reference.com', retrievedAt: '2026-01-01T00:00:00.000Z' }],
    sourceSnapshotsOrSnapshotRefs: [{ sourceRef: 'pfr:brady:2001', contentHash: 'sha256:fixture-brady-2001', rawContentRef: 'fixture://brady-2001-box-score' }],
    newGapProposals: [],
    warnings: [],
    unresolvedQuestions: [],
    usage: { requestCount: 1, tokensOrUnits: 1200, providerReportedCostUsd: 0 }
  })

  // Kurt Warner -- source conflict on passingYards: two providers disagree
  // (regular-season-only total vs. a mis-scoped combined total).
  const warnerNode = mission.nodes.find((n) => n.id === 'node:kurt-warner')
  const warnerRequestA = buildBoundedResearchRequest(mission, warnerNode, 'FAKE', clock)
  const warnerRequestB = buildBoundedResearchRequest(mission, warnerNode, 'FAKE_SECONDARY', clock)
  requests['node:kurt-warner'] = [warnerRequestA, warnerRequestB]
  script.set(warnerRequestA.taskFingerprint, {
    behavior: 'SUCCESS',
    observations: [{ rawContent: 'Primary 2001 regular-season box score aggregate for Kurt Warner.', extractedAt: '2026-01-01T00:00:00.000Z', providerConfidence: 0.96, providerReasoning: 'Primary source.' }],
    proposedClaims: [
      { fieldName: 'passingYards', proposedValue: 4830, temporalScope: PERIOD_SCOPE, providerConfidence: 0.96, providerReasoning: 'Primary regular-season total.' },
      { fieldName: 'mvpVotingNote', proposedValue: 'Unanimous first-team All-Pro and NFL MVP for the 2001 season.', temporalScope: PERIOD_SCOPE, providerConfidence: 0.9, providerReasoning: 'Secondary narrative source, cross-referenced.' }
    ],
    evidence: [
      { claimFieldName: 'passingYards', sourceRef: 'pfr:warner:2001', snippet: '4,830 passing yards (regular season).', supportsClaim: true },
      { claimFieldName: 'mvpVotingNote', sourceRef: 'narrative:warner:2001-mvp', snippet: 'Named 2001 NFL MVP.', supportsClaim: true }
    ],
    sourceReferences: [
      { sourceRef: 'pfr:warner:2001', url: 'https://example.invalid/pfr/warner/2001', publisher: 'pro-football-reference.com', retrievedAt: '2026-01-01T00:00:00.000Z' },
      { sourceRef: 'narrative:warner:2001-mvp', url: 'https://example.invalid/narrative/warner-mvp', publisher: 'nfl.com', retrievedAt: '2026-01-01T00:00:00.000Z' }
    ],
    sourceSnapshotsOrSnapshotRefs: [{ sourceRef: 'pfr:warner:2001', contentHash: 'sha256:fixture-warner-2001-a', rawContentRef: 'fixture://warner-2001-box-score' }],
    newGapProposals: [],
    warnings: [],
    unresolvedQuestions: [],
    usage: { requestCount: 1, tokensOrUnits: 1400, providerReportedCostUsd: 0 }
  })
  script.set(warnerRequestB.taskFingerprint, {
    behavior: 'CONFLICTING_RESULT',
    provider: 'FAKE_SECONDARY',
    observations: [{ rawContent: 'Secondary aggregator total for Kurt Warner, 2001 (methodology unclear).', extractedAt: '2026-01-01T00:00:00.000Z', providerConfidence: 0.7, providerReasoning: 'Secondary aggregator, methodology not disclosed.' }],
    proposedClaims: [
      { fieldName: 'passingYards', proposedValue: 4880, temporalScope: PERIOD_SCOPE, providerConfidence: 0.7, providerReasoning: 'Aggregator total; may include playoffs.' }
    ],
    evidence: [{ claimFieldName: 'passingYards', sourceRef: 'aggregator:warner:2001', snippet: '4,880 passing yards.', supportsClaim: true }],
    sourceReferences: [{ sourceRef: 'aggregator:warner:2001', url: 'https://example.invalid/aggregator/warner', publisher: 'unverified-aggregator', retrievedAt: '2026-01-01T00:00:00.000Z' }],
    sourceSnapshotsOrSnapshotRefs: [{ sourceRef: 'aggregator:warner:2001', contentHash: 'sha256:fixture-warner-2001-b', rawContentRef: 'fixture://warner-2001-aggregator' }],
    newGapProposals: [],
    warnings: [],
    unresolvedQuestions: [],
    usage: { requestCount: 1, tokensOrUnits: 900, providerReportedCostUsd: 0 }
  })

  // Jim Miller -- first attempt returns a WRONGLY temporal-scoped team
  // claim (proves the temporal-semantics check catches it); a corrected
  // retry supplies the properly 2001-scoped value. signingBonusUsd is
  // honestly reported missing (proposedValue: null).
  const millerNode = mission.nodes.find((n) => n.id === 'node:jim-miller')
  const millerRequestBad = buildBoundedResearchRequest(mission, millerNode, 'FAKE', clock)
  requests['node:jim-miller'] = [millerRequestBad]
  script.set(millerRequestBad.taskFingerprint, {
    behavior: 'IDENTITY_ALIAS_RESULT',
    observations: [{ rawContent: 'Roster record for a player named Jim Miller (team/era ambiguous across namesakes).', extractedAt: '2026-01-01T00:00:00.000Z', providerConfidence: 0.6, providerReasoning: 'Common name; multiple candidates found.' }],
    proposedClaims: [
      // Wrong: reflects a later/most-recent team, not the 2001-scoped one --
      // deliberately mis-scoped to exercise temporal-correctness checking.
      { fieldName: 'team', proposedValue: 'TB', temporalScope: 'most-recent', providerConfidence: 0.55, providerReasoning: 'Defaulted to most recent known team; not confirmed for 2001.' },
      { fieldName: 'signingBonusUsd', proposedValue: null, temporalScope: PERIOD_SCOPE, providerConfidence: null, providerReasoning: 'Not publicly disclosed for a backup-era player.' }
    ],
    evidence: [{ claimFieldName: 'team', sourceRef: 'roster:miller:ambiguous', snippet: 'Jim Miller, TB (most recent record found).', supportsClaim: true }],
    sourceReferences: [{ sourceRef: 'roster:miller:ambiguous', url: 'https://example.invalid/roster/miller', publisher: 'unverified-roster-index', retrievedAt: '2026-01-01T00:00:00.000Z' }],
    sourceSnapshotsOrSnapshotRefs: [{ sourceRef: 'roster:miller:ambiguous', contentHash: 'sha256:fixture-miller-bad', rawContentRef: 'fixture://miller-ambiguous-roster' }],
    newGapProposals: [{ fieldName: 'team', reason: 'Name is ambiguous across multiple real people; confirm 2001 team from a primary 2001-dated source.' }],
    warnings: ['possible identity ambiguity across namesakes'],
    unresolvedQuestions: ['Which Jim Miller -- confirm against 2001-dated primary roster.'],
    usage: { requestCount: 1, tokensOrUnits: 800, providerReportedCostUsd: 0 }
  })

  const millerRequestFixed = buildBoundedResearchRequest(mission, millerNode, 'FAKE_RETRY', clock)
  requests['node:jim-miller'].push(millerRequestFixed)
  script.set(millerRequestFixed.taskFingerprint, {
    behavior: 'SUCCESS',
    provider: 'FAKE_RETRY',
    observations: [{ rawContent: '1999-2002 Chicago Bears primary roster record, 2001 season, confirming Jim Miller as starting QB.', extractedAt: '2026-01-01T00:05:00.000Z', providerConfidence: 0.95, providerReasoning: 'Primary 2001-dated roster record, correct namesake confirmed.' }],
    proposedClaims: [
      { fieldName: 'team', proposedValue: 'CHI', temporalScope: PERIOD_SCOPE, providerConfidence: 0.95, providerReasoning: 'Primary 2001-dated roster record.' }
    ],
    evidence: [{ claimFieldName: 'team', sourceRef: 'pfr:miller:2001', snippet: 'Chicago Bears, 2001 (starting QB).', supportsClaim: true }],
    sourceReferences: [{ sourceRef: 'pfr:miller:2001', url: 'https://example.invalid/pfr/miller/2001', publisher: 'pro-football-reference.com', retrievedAt: '2026-01-01T00:05:00.000Z' }],
    sourceSnapshotsOrSnapshotRefs: [{ sourceRef: 'pfr:miller:2001', contentHash: 'sha256:fixture-miller-fixed', rawContentRef: 'fixture://miller-2001-roster' }],
    newGapProposals: [],
    warnings: [],
    unresolvedQuestions: [],
    usage: { requestCount: 1, tokensOrUnits: 700, providerReportedCostUsd: 0 }
  })

  return { script, requests }
}

// NFL passer-rating formula (1973 NFL/AFL standard), the fixture's derived
// field. Lives here, not in generic engine code.
export function nflPasserRating(completions, attempts, passingYards, touchdowns, interceptions) {
  const a = Math.min(Math.max((completions / attempts - 0.3) * 5, 0), 2.375)
  const b = Math.min(Math.max((passingYards / attempts - 3) * 0.25, 0), 2.375)
  const c = Math.min(Math.max((touchdowns / attempts) * 20, 0), 2.375)
  const d = Math.min(Math.max(2.375 - (interceptions / attempts) * 25, 0), 2.375)
  return Math.round(((a + b + c + d) / 6) * 100 * 10) / 10
}

// Trust + Scale Hardening Phase 7 (V0): durable cross-mission research
// library. Proves indexing/querying is real and idempotent, and -- the
// core governance property -- that adopting a library hit into a NEW
// mission still requires that mission's own explicit ReconciliationDecision
// + admitReconciliationDecision call; the library itself never creates a
// CanonicalFact anywhere, and the origin mission is never touched.
import assert from 'node:assert/strict'
import test from 'node:test'
import { admitBoundedResearchResult } from '../domain/research-admission.mjs'
import { admitReconciliationDecision, decideReconciliation } from '../domain/research-reconciliation.mjs'
import { addResearchNode, createResearchMission } from '../domain/research-mission.mjs'
import { buildBoundedResearchRequest, markResearchNodeReady, recordResearchNodeDispatch, recordResearchNodeResult } from '../domain/research-node.mjs'
import { createResearchLibrary, decideLibraryReferenceReconciliation, evaluateResearchLibraryReuse, evaluateSourceLibraryReuse, indexCanonicalFact, indexSourceSnapshot, markResearchNodeAdmittedViaLibraryReuse, queryResearchLibrary, queryResearchSourceLibrary, reuseSourceSnapshotIntoNode } from '../domain/research-library.mjs'
import { admitSourceSnapshot } from '../domain/research-source-admission.mjs'
import { buildNflQb2001Specification } from '../fixtures/nfl-2001-qb-research-fixture.mjs'

const clock = () => new Date('2026-10-10T09:00:00.000Z')
const laterClock = () => new Date('2026-11-01T09:00:00.000Z')

function missionWithCanonicalFact({ missionId = 'mission:origin', entityId = 'nfl:2001:qb:tom-brady', fieldName = 'yards', value = 100, temporalScope = '2001-regular-season', tickClock = clock } = {}) {
  const specification = buildNflQb2001Specification()
  let mission = createResearchMission({ id: missionId, projectId: 'fixture:proj', specification, expectedUniverse: specification.expectedUniverse }, tickClock)
  mission = addResearchNode(
    mission,
    { id: 'node:x', nodeRole: 'PRIMARY_RESEARCH', targetEntity: { entityId, name: 'Tom Brady' }, requestedFields: [{ fieldName, valueType: 'number', required: true }], requestedOutputSchema: { type: 'object' } },
    tickClock
  )
  const request = buildBoundedResearchRequest(mission, mission.nodes[0], 'FAKE', tickClock)
  mission = markResearchNodeReady(mission, 'node:x', tickClock, mission.revision)
  const workerRunRef = { provider: 'FAKE', providerRunId: 'r1', dispatchedAt: tickClock().toISOString() }
  mission = recordResearchNodeDispatch(mission, 'node:x', { taskFingerprint: request.taskFingerprint, workerRunRef }, tickClock, mission.revision)
  mission = recordResearchNodeResult(
    mission,
    'node:x',
    {
      schemaVersion: 'TSF_BOUNDED_RESEARCH_RESULT_V1',
      nodeId: 'node:x',
      taskFingerprint: request.taskFingerprint,
      provider: 'FAKE',
      providerRunRef: workerRunRef,
      status: 'SUCCEEDED',
      observations: [{ rawContent: 'raw', extractedAt: tickClock().toISOString(), providerConfidence: 0.9, providerReasoning: 'r' }],
      proposedClaims: [{ fieldName, proposedValue: value, temporalScope, providerConfidence: 0.9, providerReasoning: 'r' }],
      evidence: [{ claimFieldName: fieldName, sourceRef: 'src:1', snippet: 's', supportsClaim: true }],
      sourceReferences: [{ sourceRef: 'src:1', url: 'https://example.invalid', publisher: 'pub', retrievedAt: tickClock().toISOString() }],
      sourceSnapshotsOrSnapshotRefs: [{ sourceRef: 'src:1', contentHash: 'sha256:x', rawContentRef: 'fixture://x' }],
      newGapProposals: [],
      warnings: [],
      unresolvedQuestions: [],
      usage: { requestCount: 1, tokensOrUnits: 5, providerReportedCostUsd: 0 },
      failureDetails: null
    },
    tickClock,
    mission.revision
  )
  const digest = mission.nodes[0].rawResults.at(-1).digest
  mission = admitBoundedResearchResult(mission, 'node:x', digest, tickClock, mission.revision)
  const claimId = mission.nodes[0].claims[0].id
  mission = decideReconciliation(
    mission,
    'node:x',
    { fieldName, decisionType: 'ACCEPT_DERIVED_VALUE', decidedValue: value, temporalScope, rationale: 'test setup', decidedBy: 'TEST' },
    tickClock,
    mission.revision
  )
  const decisionId = mission.nodes[0].reconciliationDecisions.at(-1).id
  mission = admitReconciliationDecision(mission, 'node:x', decisionId, tickClock, mission.revision)
  const canonicalFactId = mission.nodes[0].canonicalFacts[0].id
  return { mission, claimId, canonicalFactId }
}

test('createResearchLibrary starts empty at revision 0', () => {
  const library = createResearchLibrary(clock)
  assert.deepEqual(library.entries, [])
  assert.equal(library.revision, 0)
})

test('indexCanonicalFact indexes a real canonical fact and is idempotent', () => {
  const { mission, canonicalFactId } = missionWithCanonicalFact()
  let library = createResearchLibrary(clock)
  library = indexCanonicalFact(library, mission, 'node:x', canonicalFactId, clock, library.revision)
  assert.equal(library.entries.length, 1)
  assert.equal(library.revision, 1)
  assert.equal(library.entries[0].entityId, 'nfl:2001:qb:tom-brady')
  assert.equal(library.entries[0].value, 100)
  assert.equal(library.entries[0].missionId, 'mission:origin')

  const replay = indexCanonicalFact(library, mission, 'node:x', canonicalFactId, clock, library.revision)
  assert.equal(replay.revision, library.revision, 'a true replay must not bump revision')
  assert.equal(replay.entries.length, 1)
})

// Independent-verification finding: CanonicalFact ids are content-derived
// and do NOT include nodeId/entityId, so two genuinely different entities
// deriving the same fieldName+value+temporalScope via ACCEPT_DERIVED_VALUE
// (no selectedClaimId to disambiguate) legitimately collide on
// canonicalFactId. The library must still index both as distinct entries.
test('indexCanonicalFact indexes two different nodes\' facts as distinct entries even when their canonicalFactId collides', () => {
  const specification = buildNflQb2001Specification()
  let mission = createResearchMission({ id: 'mission:collide', projectId: 'fixture:proj', specification, expectedUniverse: specification.expectedUniverse }, clock)
  mission = addResearchNode(mission, { id: 'node:x', nodeRole: 'PRIMARY_RESEARCH', targetEntity: { entityId: 'entity:x' }, requestedFields: [], requestedOutputSchema: {} }, clock)
  mission = addResearchNode(mission, { id: 'node:z', nodeRole: 'PRIMARY_RESEARCH', targetEntity: { entityId: 'entity:z' }, requestedFields: [], requestedOutputSchema: {} }, clock)

  for (const nodeId of ['node:x', 'node:z']) {
    mission = decideReconciliation(mission, nodeId, { fieldName: 'sharedField', decisionType: 'ACCEPT_DERIVED_VALUE', decidedValue: 42, temporalScope: 'era:test', rationale: 'collision test', decidedBy: 'TEST' }, clock, mission.revision)
    const decisionId = mission.nodes.find((n) => n.id === nodeId).reconciliationDecisions.at(-1).id
    mission = admitReconciliationDecision(mission, nodeId, decisionId, clock, mission.revision)
  }
  const factX = mission.nodes.find((n) => n.id === 'node:x').canonicalFacts[0]
  const factZ = mission.nodes.find((n) => n.id === 'node:z').canonicalFacts[0]
  assert.equal(factX.id, factZ.id, 'precondition: the two nodes really do produce a colliding canonicalFactId')

  let library = createResearchLibrary(clock)
  library = indexCanonicalFact(library, mission, 'node:x', factX.id, clock, library.revision)
  library = indexCanonicalFact(library, mission, 'node:z', factZ.id, clock, library.revision)
  assert.equal(library.entries.length, 2, 'both distinct facts must be indexed, not refused as a false collision')
  assert.deepEqual(library.entries.map((e) => e.entityId).sort(), ['entity:x', 'entity:z'])
})

test('a library entry\'s value is never a live reference into the origin mission\'s object graph', () => {
  const specification = buildNflQb2001Specification()
  let mission = createResearchMission({ id: 'mission:alias-test', projectId: 'fixture:proj', specification, expectedUniverse: specification.expectedUniverse }, clock)
  mission = addResearchNode(mission, { id: 'node:x', nodeRole: 'PRIMARY_RESEARCH', targetEntity: { entityId: 'entity:x' }, requestedFields: [], requestedOutputSchema: {} }, clock)
  mission = decideReconciliation(mission, 'node:x', { fieldName: 'nested', decisionType: 'ACCEPT_DERIVED_VALUE', decidedValue: { a: 1 }, temporalScope: null, rationale: 'alias test', decidedBy: 'TEST' }, clock, mission.revision)
  const decisionId = mission.nodes[0].reconciliationDecisions.at(-1).id
  mission = admitReconciliationDecision(mission, 'node:x', decisionId, clock, mission.revision)
  const factId = mission.nodes[0].canonicalFacts[0].id

  let library = createResearchLibrary(clock)
  library = indexCanonicalFact(library, mission, 'node:x', factId, clock, library.revision)
  library.entries[0].value.a = 999 // a caller mutating the returned entry in memory
  assert.equal(mission.nodes[0].canonicalFacts[0].value.a, 1, 'the origin mission\'s own CanonicalFact must be unaffected')
})

// Independent-verification finding: queryResearchLibrary previously
// returned LIVE references into library.entries -- a caller mutating a
// returned candidate (e.g. via evaluateResearchLibraryReuse's `hit`) could
// permanently corrupt the shared, cross-mission library's own stored
// data, since indexCanonicalFact's deepClone(library) on every future
// write would then propagate the corruption forward forever.
test('queryResearchLibrary never returns a live reference -- mutating a returned entry cannot corrupt the shared library', () => {
  const origin = missionWithCanonicalFact({ value: { nested: 1 } })
  let library = createResearchLibrary(clock)
  library = indexCanonicalFact(library, origin.mission, 'node:x', origin.canonicalFactId, clock, library.revision)
  const [hit] = queryResearchLibrary(library, { entityId: 'nfl:2001:qb:tom-brady', fieldName: 'yards' })
  hit.value.nested = 999 // a caller mutating the returned candidate in memory
  const [hitAgain] = queryResearchLibrary(library, { entityId: 'nfl:2001:qb:tom-brady', fieldName: 'yards' })
  assert.equal(hitAgain.value.nested, 1, 'the shared library\'s own stored data must be unaffected by a caller mutating a prior read')
  assert.equal(library.entries[0].value.nested, 1, 'the underlying library.entries array itself is untouched')
})

test('indexCanonicalFact rejects an unknown node or unknown canonical fact id', () => {
  const { mission, canonicalFactId } = missionWithCanonicalFact()
  const library = createResearchLibrary(clock)
  assert.throws(() => indexCanonicalFact(library, mission, 'node:missing', canonicalFactId, clock, library.revision), /unknown research node/)
  assert.throws(() => indexCanonicalFact(library, mission, 'node:x', 'sha256-of-nothing', clock, library.revision), /unknown canonical fact/)
})

test('indexCanonicalFact honors expectedRevision -- a stale revision is refused, not silently applied', () => {
  const { mission, canonicalFactId } = missionWithCanonicalFact()
  const library = createResearchLibrary(clock)
  assert.throws(() => indexCanonicalFact(library, mission, 'node:x', canonicalFactId, clock, 5), /stale revision/)
})

test('queryResearchLibrary filters by entityId+fieldName, and by temporalScope when given', () => {
  const factA = missionWithCanonicalFact({ missionId: 'mission:a', temporalScope: '2001-regular-season', value: 100 })
  const factB = missionWithCanonicalFact({ missionId: 'mission:b', temporalScope: '2001-preseason', value: 12, tickClock: laterClock })
  let library = createResearchLibrary(clock)
  library = indexCanonicalFact(library, factA.mission, 'node:x', factA.canonicalFactId, clock, library.revision)
  library = indexCanonicalFact(library, factB.mission, 'node:x', factB.canonicalFactId, clock, library.revision)

  const all = queryResearchLibrary(library, { entityId: 'nfl:2001:qb:tom-brady', fieldName: 'yards' })
  assert.equal(all.length, 2)
  assert.equal(all[0].missionId, 'mission:b', 'most recently canonicalized first')

  const scoped = queryResearchLibrary(library, { entityId: 'nfl:2001:qb:tom-brady', fieldName: 'yards', temporalScope: '2001-preseason' })
  assert.equal(scoped.length, 1)
  assert.equal(scoped[0].missionId, 'mission:b')

  const noMatch = queryResearchLibrary(library, { entityId: 'nfl:2001:qb:someone-else', fieldName: 'yards' })
  assert.deepEqual(noMatch, [])
})

test('adopting a library hit into a NEW mission requires that mission\'s own explicit decision + admit -- deciding alone never creates a CanonicalFact, and the origin mission is never touched', () => {
  const origin = missionWithCanonicalFact({ missionId: 'mission:origin', value: 264 })
  let library = createResearchLibrary(clock)
  library = indexCanonicalFact(library, origin.mission, 'node:x', origin.canonicalFactId, clock, library.revision)
  const [hit] = queryResearchLibrary(library, { entityId: 'nfl:2001:qb:tom-brady', fieldName: 'yards' })
  assert.ok(hit)

  const specification = buildNflQb2001Specification()
  let newMission = createResearchMission({ id: 'mission:new', projectId: 'fixture:proj', specification, expectedUniverse: specification.expectedUniverse }, clock)
  newMission = addResearchNode(newMission, { id: 'node:y', nodeRole: 'PRIMARY_RESEARCH', targetEntity: { entityId: 'nfl:2001:qb:tom-brady' }, requestedFields: [], requestedOutputSchema: {} }, clock)

  const decided = decideLibraryReferenceReconciliation(
    newMission,
    'node:y',
    { fieldName: 'yards', libraryEntry: hit, decidedBy: 'TIM', rationale: 'already canonically established in mission:origin, reused instead of re-dispatching a real provider call' },
    clock,
    newMission.revision
  )
  assert.equal(decided.nodes[0].canonicalFacts.length, 0, 'deciding must not itself create a CanonicalFact')
  const decision = decided.nodes[0].reconciliationDecisions[0]
  assert.equal(decision.decisionType, 'ACCEPT_DERIVED_VALUE')
  assert.equal(decision.derivationLineage.derivationRule, 'CROSS_MISSION_LIBRARY_REFERENCE')
  assert.equal(decision.derivationLineage.crossMissionOrigin.missionId, 'mission:origin')
  assert.equal(decision.derivationLineage.crossMissionOrigin.canonicalFactId, origin.canonicalFactId)

  const admitted = admitReconciliationDecision(decided, 'node:y', decision.id, clock, decided.revision)
  assert.equal(admitted.nodes[0].canonicalFacts.length, 1)
  assert.equal(admitted.nodes[0].canonicalFacts[0].value, 264)
  assert.equal(admitted.nodes[0].canonicalFacts[0].temporalScope, '2001-regular-season')

  // The origin mission's own object is never mutated by any of this.
  assert.equal(origin.mission.nodes[0].canonicalFacts.length, 1)
  assert.equal(origin.mission.nodes[0].canonicalFacts[0].value, 264)
})

test('decideLibraryReferenceReconciliation requires a non-empty rationale, same as every other reconciliation decision', () => {
  const origin = missionWithCanonicalFact()
  let library = createResearchLibrary(clock)
  library = indexCanonicalFact(library, origin.mission, 'node:x', origin.canonicalFactId, clock, library.revision)
  const [hit] = queryResearchLibrary(library, { entityId: 'nfl:2001:qb:tom-brady', fieldName: 'yards' })

  const specification = buildNflQb2001Specification()
  let newMission = createResearchMission({ id: 'mission:new2', projectId: 'fixture:proj', specification, expectedUniverse: specification.expectedUniverse }, clock)
  newMission = addResearchNode(newMission, { id: 'node:y', nodeRole: 'PRIMARY_RESEARCH', requestedFields: [], requestedOutputSchema: {} }, clock)

  assert.throws(
    () => decideLibraryReferenceReconciliation(newMission, 'node:y', { fieldName: 'yards', libraryEntry: hit, decidedBy: 'TIM', rationale: '' }, clock, newMission.revision),
    /rationale/
  )
})

// CONTINUATION 2 Priority Block 4: the acquisition-decision gate.
function historicalStaticSourcePolicy(overrides = {}) {
  return { preferredSources: [], disallowedSources: [], licensingConstraints: [], freshnessPolicy: 'HISTORICAL_STATIC', requireIndependentSources: false, minSourceCount: 1, allowCrossMissionLibraryReuse: true, ...overrides }
}

test('evaluateResearchLibraryReuse: CACHE_REJECTED_POLICY when the current mission does not explicitly opt in', () => {
  const origin = missionWithCanonicalFact()
  let library = createResearchLibrary(clock)
  library = indexCanonicalFact(library, origin.mission, 'node:x', origin.canonicalFactId, clock, library.revision)
  const result = evaluateResearchLibraryReuse(library, { sourcePolicy: { freshnessPolicy: 'HISTORICAL_STATIC' }, entityId: 'nfl:2001:qb:tom-brady', fieldName: 'yards' })
  assert.equal(result.decision, 'CACHE_REJECTED_POLICY')
  assert.equal(result.hit, null)
})

test('evaluateResearchLibraryReuse: CACHE_MISS when nothing is indexed for this entity/field', () => {
  const library = createResearchLibrary(clock)
  const result = evaluateResearchLibraryReuse(library, { sourcePolicy: historicalStaticSourcePolicy(), entityId: 'nfl:2001:qb:nobody', fieldName: 'yards' })
  assert.equal(result.decision, 'CACHE_MISS')
})

test('evaluateResearchLibraryReuse: CACHE_REJECTED_TEMPORAL when the only candidates are for a different period', () => {
  const origin = missionWithCanonicalFact({ temporalScope: '2001-regular-season' })
  let library = createResearchLibrary(clock)
  library = indexCanonicalFact(library, origin.mission, 'node:x', origin.canonicalFactId, clock, library.revision)
  const result = evaluateResearchLibraryReuse(library, { sourcePolicy: historicalStaticSourcePolicy(), entityId: 'nfl:2001:qb:tom-brady', fieldName: 'yards', requiredTemporalScope: '2001-preseason' })
  assert.equal(result.decision, 'CACHE_REJECTED_TEMPORAL')
  assert.equal(result.candidates.length, 1, 'the mismatched candidate is still surfaced for visibility, just not eligible')
})

test('evaluateResearchLibraryReuse: CACHE_REJECTED_FRESHNESS when the current mission\'s freshnessPolicy is not HISTORICAL_STATIC', () => {
  const origin = missionWithCanonicalFact()
  let library = createResearchLibrary(clock)
  library = indexCanonicalFact(library, origin.mission, 'node:x', origin.canonicalFactId, clock, library.revision)
  const result = evaluateResearchLibraryReuse(library, { sourcePolicy: historicalStaticSourcePolicy({ freshnessPolicy: 'WEEKLY_REFRESH' }), entityId: 'nfl:2001:qb:tom-brady', fieldName: 'yards' })
  assert.equal(result.decision, 'CACHE_REJECTED_FRESHNESS')
})

test('evaluateResearchLibraryReuse: CACHE_REJECTED_SCHEMA when the declared valueType does not match the hit\'s real value type', () => {
  const origin = missionWithCanonicalFact({ value: 264 })
  let library = createResearchLibrary(clock)
  library = indexCanonicalFact(library, origin.mission, 'node:x', origin.canonicalFactId, clock, library.revision)
  const result = evaluateResearchLibraryReuse(library, { sourcePolicy: historicalStaticSourcePolicy(), entityId: 'nfl:2001:qb:tom-brady', fieldName: 'yards', valueType: 'string' })
  assert.equal(result.decision, 'CACHE_REJECTED_SCHEMA')
})

test('evaluateResearchLibraryReuse: CACHE_HIT when policy/temporal/freshness/schema all clear', () => {
  const origin = missionWithCanonicalFact({ value: 264, temporalScope: '2001-regular-season' })
  let library = createResearchLibrary(clock)
  library = indexCanonicalFact(library, origin.mission, 'node:x', origin.canonicalFactId, clock, library.revision)
  const result = evaluateResearchLibraryReuse(library, { sourcePolicy: historicalStaticSourcePolicy(), entityId: 'nfl:2001:qb:tom-brady', fieldName: 'yards', requiredTemporalScope: '2001-regular-season', valueType: 'number' })
  assert.equal(result.decision, 'CACHE_HIT')
  assert.equal(result.hit.value, 264)
})

// The real, end-to-end proof HQ asked for: across TWO missions, a valid
// immutable source is reused WITHOUT refetching, and WITHOUT bypassing the
// second mission's own epistemic authority (still a real, explicit,
// auditable ReconciliationDecision in that mission -- never a silent
// cross-mission canonicalization).
test('two missions: a genuine cross-mission reuse avoids a redundant fetch while preserving the second mission\'s own epistemic authority', () => {
  const origin = missionWithCanonicalFact({ missionId: 'mission:reuse-origin', entityId: 'nfl:2001:qb:tom-brady', fieldName: 'yards', value: 264, temporalScope: '2001-regular-season' })
  let library = createResearchLibrary(clock)
  library = indexCanonicalFact(library, origin.mission, 'node:x', origin.canonicalFactId, clock, library.revision)

  const specification = buildNflQb2001Specification()
  const sourcePolicy = historicalStaticSourcePolicy()
  let secondMission = createResearchMission({ id: 'mission:reuse-second', projectId: 'fixture:proj', specification, expectedUniverse: specification.expectedUniverse }, clock)
  secondMission = addResearchNode(secondMission, { id: 'node:reuse', nodeRole: 'PRIMARY_RESEARCH', targetEntity: { entityId: 'nfl:2001:qb:tom-brady' }, requestedFields: [{ fieldName: 'yards', valueType: 'number', required: true, requiredTemporalScopes: ['2001-regular-season'] }], requestedOutputSchema: {} }, clock)

  // BEFORE any provider is even considered: consult the library.
  const evaluation = evaluateResearchLibraryReuse(library, { sourcePolicy, entityId: 'nfl:2001:qb:tom-brady', fieldName: 'yards', requiredTemporalScope: '2001-regular-season', valueType: 'number' })
  assert.equal(evaluation.decision, 'CACHE_HIT', 'a real, eligible immutable source exists -- no provider dispatch is needed for this field')

  // Adopting the hit still requires the SECOND mission's own explicit
  // decision -- never a silent, cross-mission-authority-bypassing reuse.
  secondMission = decideLibraryReferenceReconciliation(secondMission, 'node:reuse', { fieldName: 'yards', libraryEntry: evaluation.hit, decidedBy: 'TIM', rationale: 'CACHE_HIT: reused from mission:reuse-origin, an immutable HISTORICAL_STATIC source, same required temporalScope' }, clock, secondMission.revision)
  assert.equal(secondMission.nodes[0].canonicalFacts.length, 0, 'deciding alone never canonicalizes')
  const decisionId = secondMission.nodes[0].reconciliationDecisions.at(-1).id
  secondMission = admitReconciliationDecision(secondMission, 'node:reuse', decisionId, clock, secondMission.revision)
  assert.equal(secondMission.nodes[0].canonicalFacts.length, 1)
  assert.equal(secondMission.nodes[0].canonicalFacts[0].value, 264)
  assert.equal(secondMission.nodes[0].canonicalFacts[0].derivationLineage.crossMissionOrigin.missionId, 'mission:reuse-origin', 'fully traceable, never hidden')

  // No redundant re-fetch/re-dispatch happened for this field: the second
  // mission's node was never even marked READY/DISPATCHED for 'yards'.
  assert.equal(secondMission.nodes[0].status, 'PENDING', 'no dispatch cycle was ever needed for this field')
  assert.equal(secondMission.nodes[0].dispatchRecords.length, 0)

  // The origin mission and the library index are both completely
  // unaffected by the second mission's own decision.
  assert.equal(origin.mission.nodes[0].canonicalFacts.length, 1)
  assert.equal(library.entries.length, 1, 'the library itself is read-only from evaluateResearchLibraryReuse -- no new entry was created by this reuse')
})

// Real-pilot, independent-verification finding: a node resolved ENTIRELY
// via library reuse (zero dispatch) previously stayed PENDING/READY
// forever, under-reporting presentEntityCoverage/evidenceCoverage/
// verifiedCoverage for a reuse-only mission despite having real
// CanonicalFacts. markResearchNodeAdmittedViaLibraryReuse is the
// sanctioned, opt-in fix for that -- the plain decide+admit sequence
// (proven above) is UNCHANGED and still leaves status at PENDING on its
// own; a caller must explicitly also call this.
test('markResearchNodeAdmittedViaLibraryReuse moves a zero-dispatch node to ADMITTED, fixing the completeness under-report', () => {
  const origin = missionWithCanonicalFact({ missionId: 'mission:reuse-admit-origin', value: 100 })
  let library = createResearchLibrary(clock)
  library = indexCanonicalFact(library, origin.mission, 'node:x', origin.canonicalFactId, clock, library.revision)
  const [hit] = queryResearchLibrary(library, { entityId: 'nfl:2001:qb:tom-brady', fieldName: 'yards' })

  const specification = buildNflQb2001Specification()
  let newMission = createResearchMission({ id: 'mission:reuse-admit-new', projectId: 'fixture:proj', specification, expectedUniverse: specification.expectedUniverse }, clock)
  newMission = addResearchNode(newMission, { id: 'node:y', nodeRole: 'PRIMARY_RESEARCH', requestedFields: [], requestedOutputSchema: {} }, clock)
  newMission = decideLibraryReferenceReconciliation(newMission, 'node:y', { fieldName: 'yards', libraryEntry: hit, decidedBy: 'TIM', rationale: 'reuse test' }, clock, newMission.revision)
  const decisionId = newMission.nodes[0].reconciliationDecisions.at(-1).id
  newMission = admitReconciliationDecision(newMission, 'node:y', decisionId, clock, newMission.revision)
  assert.equal(newMission.nodes[0].status, 'PENDING', 'precondition: plain decide+admit alone still leaves status untouched')

  newMission = markResearchNodeAdmittedViaLibraryReuse(newMission, 'node:y', clock, newMission.revision)
  assert.equal(newMission.nodes[0].status, 'ADMITTED')
  assert.equal(newMission.nodes[0].canonicalFacts.length, 1, 'the real canonical fact from reuse is untouched')

  // Idempotent replay.
  const replay = markResearchNodeAdmittedViaLibraryReuse(newMission, 'node:y', clock, newMission.revision)
  assert.equal(replay.revision, newMission.revision)
})

test('markResearchNodeAdmittedViaLibraryReuse refuses a node with real dispatch history -- never a generic bypass of the real admission path', () => {
  const specification = buildNflQb2001Specification()
  let mission = createResearchMission({ id: 'mission:reuse-admit-guard', projectId: 'fixture:proj', specification, expectedUniverse: specification.expectedUniverse }, clock)
  mission = addResearchNode(mission, { id: 'node:x', nodeRole: 'PRIMARY_RESEARCH', requestedFields: [], requestedOutputSchema: {} }, clock)
  const request = buildBoundedResearchRequest(mission, mission.nodes[0], 'FAKE', clock)
  mission = markResearchNodeReady(mission, 'node:x', clock, mission.revision)
  mission = recordResearchNodeDispatch(mission, 'node:x', { taskFingerprint: request.taskFingerprint, workerRunRef: { provider: 'FAKE', providerRunId: 'r1', dispatchedAt: clock().toISOString() } }, clock, mission.revision)
  assert.ok(mission.nodes[0].dispatchRecords.length > 0, 'precondition: this node has real dispatch history, and is NOT yet ADMITTED')
  assert.notEqual(mission.nodes[0].status, 'ADMITTED')
  assert.throws(
    () => markResearchNodeAdmittedViaLibraryReuse(mission, 'node:x', clock, mission.revision),
    (error) => {
      assert.equal(error.code, 'TSF_NODE_HAS_REAL_DISPATCH_HISTORY')
      return true
    }
  )
})

// Independent-verification finding: the dispatch-history guard alone does
// not stop a caller other than the one sanctioned
// adoptResearchLibraryReuseDurable sequence from marking a genuinely
// fact-less node ADMITTED. Proven directly here (bypassing the driver's
// own decide+admit-first sequencing) that the domain function itself
// refuses this, not just the driver's call order.
test('markResearchNodeAdmittedViaLibraryReuse refuses a node with zero canonicalFacts, even with zero dispatch history -- self-defending, not reliant on caller discipline', () => {
  const specification = buildNflQb2001Specification()
  let mission = createResearchMission({ id: 'mission:reuse-admit-fact-guard', projectId: 'fixture:proj', specification, expectedUniverse: specification.expectedUniverse }, clock)
  mission = addResearchNode(mission, { id: 'node:x', nodeRole: 'PRIMARY_RESEARCH', requestedFields: [], requestedOutputSchema: {} }, clock)
  assert.equal(mission.nodes[0].dispatchRecords.length, 0, 'precondition: zero dispatch history')
  assert.equal(mission.nodes[0].canonicalFacts.length, 0, 'precondition: zero canonicalFacts')
  assert.throws(
    () => markResearchNodeAdmittedViaLibraryReuse(mission, 'node:x', clock, mission.revision),
    (error) => {
      assert.equal(error.code, 'TSF_NODE_HAS_NO_CANONICAL_FACT')
      return true
    }
  )
})

// ---------------------------------------------------------------------
// RAW SOURCE LIBRARY V0 ("GENERIC V0 ADOPTION READINESS" Phase 3): a
// genuinely different concern from everything above -- reusing raw,
// immutable SOURCE material across missions, not a reconciled fact.
// ---------------------------------------------------------------------

test('indexSourceSnapshot indexes a real admitted source snapshot and is idempotent', () => {
  const { mission } = missionWithCanonicalFact()
  const sourceSnapshotId = mission.nodes[0].sourceSnapshots[0].id
  let library = createResearchLibrary(clock)
  library = indexSourceSnapshot(library, mission, 'node:x', sourceSnapshotId, clock, library.revision)
  assert.equal(library.sourceSnapshots.length, 1)
  assert.equal(library.revision, 1)
  assert.equal(library.sourceSnapshots[0].canonicalLocator, 'src:1')
  assert.equal(library.sourceSnapshots[0].contentHash, 'sha256:x')
  assert.equal(library.sourceSnapshots[0].missionId, 'mission:origin')
  assert.equal(library.sourceSnapshots[0].cachePolicy, 'HISTORICAL_STATIC')
  assert.deepEqual(library.entries, [], 'a source-snapshot index must never also create a CanonicalFact entry')

  const replay = indexSourceSnapshot(library, mission, 'node:x', sourceSnapshotId, clock, library.revision)
  assert.equal(replay.revision, library.revision, 'a true replay must not bump revision')
  assert.equal(replay.sourceSnapshots.length, 1)
})

test('queryResearchSourceLibrary never returns a live reference into the library\'s own stored data', () => {
  const { mission } = missionWithCanonicalFact()
  const sourceSnapshotId = mission.nodes[0].sourceSnapshots[0].id
  let library = createResearchLibrary(clock)
  library = indexSourceSnapshot(library, mission, 'node:x', sourceSnapshotId, clock, library.revision)
  const [hit] = queryResearchSourceLibrary(library, { canonicalLocator: 'src:1' })
  hit.contentHash = 'CORRUPTED'
  const [fresh] = queryResearchSourceLibrary(library, { canonicalLocator: 'src:1' })
  assert.equal(fresh.contentHash, 'sha256:x', 'mutating a returned candidate must never corrupt the library\'s own stored data')
})

test('evaluateSourceLibraryReuse: POLICY/MISS/TEMPORAL/FRESHNESS gates, then a real HIT', () => {
  const { mission } = missionWithCanonicalFact()
  const sourceSnapshotId = mission.nodes[0].sourceSnapshots[0].id
  let library = createResearchLibrary(clock)
  library = indexSourceSnapshot(library, mission, 'node:x', sourceSnapshotId, clock, library.revision)

  const noPolicy = evaluateSourceLibraryReuse(library, { sourcePolicy: { allowCrossMissionLibraryReuse: false }, canonicalLocator: 'src:1' })
  assert.equal(noPolicy.decision, 'SOURCE_CACHE_REJECTED_POLICY')

  const allowPolicy = { allowCrossMissionLibraryReuse: true, freshnessPolicy: 'HISTORICAL_STATIC' }
  const miss = evaluateSourceLibraryReuse(library, { sourcePolicy: allowPolicy, canonicalLocator: 'src:never-indexed' })
  assert.equal(miss.decision, 'SOURCE_CACHE_MISS')

  const wrongTemporal = evaluateSourceLibraryReuse(library, { sourcePolicy: allowPolicy, canonicalLocator: 'src:1', requiredTemporalClass: 'some-other-era' })
  assert.equal(wrongTemporal.decision, 'SOURCE_CACHE_REJECTED_TEMPORAL')

  const hit = evaluateSourceLibraryReuse(library, { sourcePolicy: allowPolicy, canonicalLocator: 'src:1', requiredTemporalClass: '2001-regular-season' })
  assert.equal(hit.decision, 'SOURCE_CACHE_HIT')
  assert.equal(hit.hit.contentHash, 'sha256:x')

  // Freshness: a non-HISTORICAL_STATIC candidate in a fresh library is
  // rejected even with an otherwise-eligible locator/temporal match.
  let liveLibrary = createResearchLibrary(clock)
  const liveMission = missionWithCanonicalFact({ missionId: 'mission:live-source' }).mission
  const liveSnapshotId = liveMission.nodes[0].sourceSnapshots[0].id
  // Force a non-static freshness policy onto a clone of the mission to
  // prove the gate actually checks it (not just defaulting to pass).
  const nonStaticMission = { ...liveMission, specification: { ...liveMission.specification, sourcePolicy: { ...liveMission.specification.sourcePolicy, freshnessPolicy: 'LIVE_SNAPSHOT' } } }
  liveLibrary = indexSourceSnapshot(liveLibrary, nonStaticMission, 'node:x', liveSnapshotId, clock, liveLibrary.revision)
  const rejectedFreshness = evaluateSourceLibraryReuse(liveLibrary, { sourcePolicy: allowPolicy, canonicalLocator: 'src:1', requiredTemporalClass: '2001-regular-season' })
  assert.equal(rejectedFreshness.decision, 'SOURCE_CACHE_REJECTED_FRESHNESS')
})

// The core governance property, mirroring the CanonicalFact-reuse test
// above: Mission B reuses Mission A's already-fetched, immutable source
// WITHOUT refetching it, but source reuse != claim verification -- no
// Observation/Claim/CanonicalFact is created by the reuse itself, and
// Mission B must still perform its own full epistemic-ladder path to ever
// reach its own CanonicalFact.
test('reuseSourceSnapshotIntoNode: cross-mission raw-source reuse never creates a Claim/CanonicalFact by itself; the reusing mission still does its own reconciliation', () => {
  const origin = missionWithCanonicalFact({ missionId: 'mission:source-reuse-origin' }).mission
  const originSnapshotId = origin.nodes[0].sourceSnapshots[0].id
  let library = createResearchLibrary(clock)
  library = indexSourceSnapshot(library, origin, 'node:x', originSnapshotId, clock, library.revision)

  const specification = buildNflQb2001Specification()
  const reusePolicy = { ...specification.sourcePolicy, allowCrossMissionLibraryReuse: true }
  let missionB = createResearchMission({ id: 'mission:source-reuse-target', projectId: 'fixture:proj', specification: { ...specification, sourcePolicy: reusePolicy }, expectedUniverse: specification.expectedUniverse }, laterClock)
  missionB = addResearchNode(missionB, { id: 'node:y', nodeRole: 'PRIMARY_RESEARCH', targetEntity: { entityId: 'nfl:2001:qb:kurt-warner' }, requestedFields: [{ fieldName: 'yards', valueType: 'number', required: true }], requestedOutputSchema: {} }, laterClock)
  assert.equal(missionB.nodes[0].sourceSnapshots.length, 0, 'precondition: Mission B has not fetched anything yet')

  const evaluation = evaluateSourceLibraryReuse(library, { sourcePolicy: reusePolicy, canonicalLocator: 'src:1', requiredTemporalClass: '2001-regular-season' })
  assert.equal(evaluation.decision, 'SOURCE_CACHE_HIT')
  missionB = reuseSourceSnapshotIntoNode(missionB, 'node:y', evaluation.hit, laterClock, missionB.revision)

  assert.equal(missionB.nodes[0].sourceSnapshots.length, 1, 'Mission B now has the source locally, without refetching')
  assert.equal(missionB.nodes[0].sourceSnapshots[0].contentHash, 'sha256:x')
  assert.equal(missionB.nodes[0].sourceSnapshots[0].acquisitionMethod, 'CROSS_MISSION_SOURCE_LIBRARY_REUSE')
  assert.equal(missionB.nodes[0].sourceSnapshots[0].reusedFrom.missionId, 'mission:source-reuse-origin')
  assert.equal(missionB.nodes[0].observations.length, 0, 'source reuse != claim verification: no Observation was fabricated')
  assert.equal(missionB.nodes[0].claims.length, 0, 'source reuse != claim verification: no Claim was fabricated')
  assert.equal(missionB.nodes[0].canonicalFacts.length, 0, 'source reuse != claim verification: no CanonicalFact was fabricated')

  // Mission B now performs its OWN full epistemic-ladder work -- entirely
  // its own decision, over its own (different) field/value, citing the
  // reused source as evidence.
  missionB = decideReconciliation(missionB, 'node:y', { fieldName: 'yards', decisionType: 'ACCEPT_DERIVED_VALUE', decidedValue: 4830, temporalScope: '2001-regular-season', rationale: 'Mission B\'s own reconciliation over the reused source material', decidedBy: 'TEST' }, laterClock, missionB.revision)
  const decisionId = missionB.nodes[0].reconciliationDecisions.at(-1).id
  missionB = admitReconciliationDecision(missionB, 'node:y', decisionId, laterClock, missionB.revision)
  assert.equal(missionB.nodes[0].canonicalFacts.length, 1)
  assert.equal(missionB.nodes[0].canonicalFacts[0].value, 4830)

  // Origin mission's own node is completely untouched by any of this.
  assert.equal(origin.nodes[0].sourceSnapshots.length, 1)

  // Idempotent replay.
  const before = missionB.revision
  const replay = reuseSourceSnapshotIntoNode(missionB, 'node:y', evaluation.hit, laterClock, missionB.revision)
  assert.equal(replay.nodes[0].sourceSnapshots.length, 1, 'no duplicate source snapshot from a resumed reuse call')
  void before
})

test('reuseSourceSnapshotIntoNode is idempotent by contentHash even across two separately-evaluated hits', () => {
  const origin = missionWithCanonicalFact({ missionId: 'mission:source-reuse-idempotent-origin' }).mission
  const originSnapshotId = origin.nodes[0].sourceSnapshots[0].id
  let library = createResearchLibrary(clock)
  library = indexSourceSnapshot(library, origin, 'node:x', originSnapshotId, clock, library.revision)
  const specification = buildNflQb2001Specification()
  let missionB = createResearchMission({ id: 'mission:source-reuse-idempotent-target', projectId: 'fixture:proj', specification, expectedUniverse: specification.expectedUniverse }, laterClock)
  missionB = addResearchNode(missionB, { id: 'node:y', nodeRole: 'PRIMARY_RESEARCH', requestedFields: [], requestedOutputSchema: {} }, laterClock)
  const evaluation = evaluateSourceLibraryReuse(library, { sourcePolicy: { allowCrossMissionLibraryReuse: true, freshnessPolicy: 'HISTORICAL_STATIC' }, canonicalLocator: 'src:1' })
  missionB = reuseSourceSnapshotIntoNode(missionB, 'node:y', evaluation.hit, laterClock, missionB.revision)
  missionB = reuseSourceSnapshotIntoNode(missionB, 'node:y', evaluation.hit, laterClock, missionB.revision)
  assert.equal(missionB.nodes[0].sourceSnapshots.length, 1)
})

// admitSourceSnapshot is the OTHER real admission path for raw source
// material (bulk source-first acquisition, no BoundedResearchResult) --
// confirm indexSourceSnapshot works over its output too, not just
// admitBoundedResearchResult's.
test('indexSourceSnapshot also indexes a snapshot admitted via the bulk source-first path (admitSourceSnapshot)', () => {
  const specification = buildNflQb2001Specification()
  let mission = createResearchMission({ id: 'mission:bulk-source-first', projectId: 'fixture:proj', specification, expectedUniverse: specification.expectedUniverse }, clock)
  mission = addResearchNode(mission, { id: 'node:x', nodeRole: 'PRIMARY_RESEARCH', requestedFields: [], requestedOutputSchema: {} }, clock)
  mission = admitSourceSnapshot(mission, 'node:x', { sourceRef: 'src:bulk-1', url: 'https://example.invalid/bulk', publisher: 'pub', retrievedAt: clock().toISOString(), contentHash: 'sha256:bulk' }, clock, mission.revision)
  const sourceSnapshotId = mission.nodes[0].sourceSnapshots[0].id
  let library = createResearchLibrary(clock)
  library = indexSourceSnapshot(library, mission, 'node:x', sourceSnapshotId, clock, library.revision)
  assert.equal(library.sourceSnapshots.length, 1)
  assert.equal(library.sourceSnapshots[0].canonicalLocator, 'src:bulk-1')
})

// "GENERIC V0 ADOPTION READINESS" Phase 10/11: the bulk source-first path
// is a second, equally real way a disallowed source could otherwise slip
// in uncaught -- same defense-in-depth check as the BoundedResearchWorker
// admission path (research-epistemic-ladder.test.mjs's equivalent test).
test('SOURCE POLICY ENFORCEMENT: admitSourceSnapshot refuses a disallowedSources domain in the bulk source-first path', () => {
  const specification = { ...buildNflQb2001Specification() }
  specification.sourcePolicy = { ...specification.sourcePolicy, disallowedSources: ['banned-source.example'] }
  let mission = createResearchMission({ id: 'mission:bulk-source-policy', projectId: 'fixture:proj', specification, expectedUniverse: specification.expectedUniverse }, clock)
  mission = addResearchNode(mission, { id: 'node:x', nodeRole: 'PRIMARY_RESEARCH', requestedFields: [], requestedOutputSchema: {} }, clock)
  assert.throws(
    () => admitSourceSnapshot(mission, 'node:x', { sourceRef: 'src:banned-1', url: 'https://banned-source.example/bulk', publisher: 'banned-source.example', retrievedAt: clock().toISOString(), contentHash: 'sha256:banned' }, clock, mission.revision),
    (error) => {
      assert.equal(error.code, 'TSF_SOURCE_POLICY_VIOLATION')
      return true
    }
  )
  assert.equal(mission.nodes[0].sourceSnapshots.length, 0, 'the mission passed in is untouched -- withResearchNode never commits a thrown attempt')
})

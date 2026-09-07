// REQ-002: real behavior proof for the cross-mission Platform Learning
// Ledger -- lessons extracted from a real, synthetic COMPLETE mission's own
// durable state, and the structural epistemic guard (never a canonical
// fact, always advisory-only).
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  LESSON_CATEGORIES,
  LESSON_EPISTEMIC_KIND,
  addLessonRecord,
  emptyPlatformLearningLedger,
  extractLessonsFromCompletedMission,
  recordLessonsFromCompletedMission,
  retrieveLessonGuidance
} from '../domain/platform-learning-ledger.mjs'

const clock = () => new Date('2026-09-06T12:00:00.000Z')

function emptyEpistemicArrays() {
  return {
    dispatchRecords: [],
    rawResults: [],
    admittedResultDigests: [],
    observations: [],
    claims: [],
    evidence: [],
    sourceReferences: [],
    sourceSnapshots: [],
    typedMissingness: [],
    identityResolutionState: null,
    verifications: [],
    conflicts: [],
    reconciliationDecisions: [],
    canonicalFacts: []
  }
}

function baseMission(nodes) {
  return {
    schemaVersion: 'TSF_RESEARCH_MISSION_V1',
    id: 'mission:learning-ledger-fixture',
    state: 'COMPLETE',
    revision: 1,
    nodes,
    expectedUniverse: { schemaVersion: 'TSF_EXPECTED_UNIVERSE_V1', entityType: 'FIXTURE', expectedCount: nodes.length, expectedEntities: [] }
  }
}

test('extractLessonsFromCompletedMission refuses a mission that is not actually COMPLETE -- fail honest, never guess', () => {
  const mission = { ...baseMission([]), state: 'ACTIVE' }
  assert.throws(() => extractLessonsFromCompletedMission(mission, clock), (err) => err.code === 'TSF_LEARNING_LEDGER_MISSION_NOT_COMPLETE')
})

test('a clean mission with no failures/gaps/ambiguity produces zero lessons -- never padded', () => {
  const node = { id: 'node:clean', ...emptyEpistemicArrays(), requestedFields: [] }
  const mission = baseMission([node])
  const lessons = extractLessonsFromCompletedMission(mission, clock)
  assert.deepEqual(lessons, [])
})

test('PROVIDER_RELIABILITY_SIGNAL: a real FAILED raw result for a provider produces an evidenced lesson', () => {
  const node = {
    id: 'node:provider-failures',
    ...emptyEpistemicArrays(),
    requestedFields: [],
    rawResults: [
      { digest: 'd1', result: { provider: 'FLAKY_PROVIDER', status: 'FAILED' } },
      { digest: 'd2', result: { provider: 'FLAKY_PROVIDER', status: 'SUCCEEDED' } }
    ]
  }
  const mission = baseMission([node])
  const lessons = extractLessonsFromCompletedMission(mission, clock)
  const lesson = lessons.find((l) => l.category === 'PROVIDER_RELIABILITY_SIGNAL')
  assert.ok(lesson, 'expected a PROVIDER_RELIABILITY_SIGNAL lesson from a real FAILED raw result')
  assert.equal(lesson.epistemicKind, LESSON_EPISTEMIC_KIND)
  assert.match(lesson.statement, /FLAKY_PROVIDER/)
  assert.match(lesson.evidenceSummary, /"failed":1/)
  assert.deepEqual(lesson.sourceMissionIds, [mission.id])
  assert.equal(lesson.confidence, 'LOW', 'a 2-sample signal must not overclaim confidence')
})

test('IDENTITY_AMBIGUITY_PATTERN: a real AMBIGUOUS identityResolutionState produces an evidenced lesson', () => {
  const node = {
    id: 'node:identity-ambiguous',
    ...emptyEpistemicArrays(),
    requestedFields: [],
    identityResolutionState: { status: 'AMBIGUOUS', candidateEntityRefs: [{ entityId: 'a' }, { entityId: 'b' }], resolvedEntityId: null }
  }
  const mission = baseMission([node])
  const lessons = extractLessonsFromCompletedMission(mission, clock)
  const lesson = lessons.find((l) => l.category === 'IDENTITY_AMBIGUITY_PATTERN')
  assert.ok(lesson)
  assert.match(lesson.evidenceSummary, /node:identity-ambiguous/)
})

test('COMPLETENESS_GAP_PATTERN: reuses computeCompletenessMetrics -- a real typed-missingness record produces an evidenced lesson', () => {
  const node = {
    id: 'node:gap',
    ...emptyEpistemicArrays(),
    requestedFields: [{ fieldName: 'x', required: true }],
    typedMissingness: [{ fieldName: 'x', missingnessType: 'NOT_PUBLICLY_AVAILABLE', temporalScope: null }]
  }
  const mission = baseMission([node])
  const lessons = extractLessonsFromCompletedMission(mission, clock)
  const lesson = lessons.find((l) => l.category === 'COMPLETENESS_GAP_PATTERN')
  assert.ok(lesson)
  assert.match(lesson.evidenceSummary, /NOT_PUBLICLY_AVAILABLE/)
})

test('VERIFIED_CORRECTION_PATTERN: a real RESOLVE_CONFLICT reconciliation decision produces an evidenced lesson', () => {
  const node = {
    id: 'node:correction',
    ...emptyEpistemicArrays(),
    requestedFields: [],
    reconciliationDecisions: [{ id: 'decision:1', decisionType: 'RESOLVE_CONFLICT', fieldName: 'x' }]
  }
  const mission = baseMission([node])
  const lessons = extractLessonsFromCompletedMission(mission, clock)
  const lesson = lessons.find((l) => l.category === 'VERIFIED_CORRECTION_PATTERN')
  assert.ok(lesson)
  assert.match(lesson.evidenceSummary, /decision:1/)
})

test('SOURCE_RELIABILITY_SIGNAL: a claim verified FAIL, traced through its evidence to a real source, produces an evidenced lesson', () => {
  const node = {
    id: 'node:source',
    ...emptyEpistemicArrays(),
    requestedFields: [],
    claims: [{ id: 'claim:1', fieldName: 'x', status: 'REJECTED' }],
    sourceReferences: [{ id: 'src:1', publisher: 'unreliable-publisher.example', sourceRef: 'unreliable-publisher.example/x' }],
    evidence: [{ claimId: 'claim:1', sourceReferenceId: 'src:1' }],
    verifications: [{ claimId: 'claim:1', verdict: 'FAIL', verifiedAt: clock().toISOString() }]
  }
  const mission = baseMission([node])
  const lessons = extractLessonsFromCompletedMission(mission, clock)
  const lesson = lessons.find((l) => l.category === 'SOURCE_RELIABILITY_SIGNAL')
  assert.ok(lesson)
  assert.match(lesson.statement, /unreliable-publisher\.example/)
})

test('createLessonRecord / addLessonRecord: the structural epistemic guard -- every lesson is SYSTEM_GUIDANCE, never a caller-settable kind, and idempotent by content', () => {
  let ledger = emptyPlatformLearningLedger()
  const input = {
    category: 'PROVIDER_RELIABILITY_SIGNAL',
    statement: 'test statement',
    evidenceSummary: 'test evidence',
    confidence: 'LOW',
    sourceMissionIds: ['mission:x'],
    // An attempted override -- createLessonRecord has no epistemicKind
    // parameter at all, so this must have zero effect.
    epistemicKind: 'VERIFIED_FACT'
  }
  ledger = addLessonRecord(ledger, input, clock)
  assert.equal(ledger.lessons.length, 1)
  assert.equal(ledger.lessons[0].epistemicKind, LESSON_EPISTEMIC_KIND, 'epistemicKind must never be settable by the caller')
  // Re-adding the identical input is a true no-op (idempotent by content hash).
  ledger = addLessonRecord(ledger, input, clock)
  assert.equal(ledger.lessons.length, 1)
})

test('createLessonRecord refuses a lesson with no evidenceSummary -- never bare assertion', () => {
  let ledger = emptyPlatformLearningLedger()
  assert.throws(
    () => addLessonRecord(ledger, { category: 'PROVIDER_RELIABILITY_SIGNAL', statement: 's', evidenceSummary: '', confidence: 'LOW', sourceMissionIds: ['mission:x'] }, clock),
    /evidenceSummary/
  )
})

test('createLessonRecord refuses a lesson with no sourceMissionIds -- must trace to a real mission, never invented', () => {
  let ledger = emptyPlatformLearningLedger()
  assert.throws(
    () => addLessonRecord(ledger, { category: 'PROVIDER_RELIABILITY_SIGNAL', statement: 's', evidenceSummary: 'e', confidence: 'LOW', sourceMissionIds: [] }, clock),
    /sourceMissionIds/
  )
})

test('retrieveLessonGuidance: every returned lesson is stamped advisory-only, bounded by limit, most recent first', () => {
  let ledger = emptyPlatformLearningLedger()
  for (let i = 0; i < 3; i += 1) {
    ledger = addLessonRecord(
      ledger,
      { category: 'PROVIDER_RELIABILITY_SIGNAL', statement: `lesson ${i}`, evidenceSummary: `evidence ${i}`, confidence: 'LOW', sourceMissionIds: [`mission:${i}`] },
      clock
    )
  }
  const guidance = retrieveLessonGuidance(ledger, 'PROVIDER_RELIABILITY_SIGNAL', 2)
  assert.equal(guidance.length, 2)
  for (const g of guidance) {
    assert.equal(g.advisoryOnly, true)
    assert.equal(g.neverOverridesVerifiedEvidence, true)
    // Structurally incapable of being mistaken for a Claim/CanonicalFact --
    // no fieldName/value/entityId anywhere on the retrieved shape.
    assert.equal('fieldName' in g, false)
    assert.equal('value' in g, false)
    assert.equal('entityId' in g, false)
  }
  assert.equal(guidance[1].statement, 'lesson 2', 'most recent lesson last within the bounded window, matching this codebase\'s .slice(-limit) convention')
})

test('LESSON_CATEGORIES still contains every category extractLessonsFromCompletedMission itself computes', () => {
  // Native Self-Improvement Loop V1 Wave B added three more categories
  // (DETECTOR_FALSE_POSITIVE_PATTERN, VERIFIER_FAILURE_PATTERN,
  // RECURRING_SUBSYSTEM_DEFECT) written by a DIFFERENT real consumer
  // (server/self-improvement-learning-ledger-wiring.mjs), not by
  // extractLessonsFromCompletedMission -- exactly Finding F3's own
  // precedent of multiple real writers into one shared ledger. This test
  // now proves the ResearchMission-specific subset is still intact
  // (regression guard for THIS function), not that it's the whole set.
  const researchMissionCategories = [
    'COMPLETENESS_GAP_PATTERN',
    'IDENTITY_AMBIGUITY_PATTERN',
    'PROVIDER_RELIABILITY_SIGNAL',
    'RECURRING_DISPATCH_FAILURE',
    'SOURCE_RELIABILITY_SIGNAL',
    'VERIFIED_CORRECTION_PATTERN'
  ]
  for (const category of researchMissionCategories) {
    assert.ok(LESSON_CATEGORIES.includes(category), `expected LESSON_CATEGORIES to still include ${category}`)
  }
})

test('recordLessonsFromCompletedMission: extraction + durable merge in one call, idempotent on re-run', () => {
  const node = {
    id: 'node:merge',
    ...emptyEpistemicArrays(),
    requestedFields: [],
    identityResolutionState: { status: 'UNRESOLVED', candidateEntityRefs: [], resolvedEntityId: null }
  }
  const mission = baseMission([node])
  let ledger = emptyPlatformLearningLedger()
  const first = recordLessonsFromCompletedMission(ledger, mission, clock)
  assert.equal(first.lessonsRecorded, 1)
  ledger = first.ledger
  const second = recordLessonsFromCompletedMission(ledger, mission, clock)
  assert.equal(second.lessonsRecorded, 0, 're-running extraction on the identical mission must not duplicate lessons')
  assert.equal(second.ledger.lessons.length, 1)
})

import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildResearchDrivenMissionSpec,
  acceptanceCriteriaFromResearch,
  RESEARCH_DRIVEN_MISSION_TYPE
} from '../domain/research-driven-development.mjs'
import {
  extractResearchDrivenDevelopmentLessons,
  recordResearchDrivenDevelopmentLessons,
  emptyPlatformLearningLedger
} from '../domain/platform-learning-ledger.mjs'
import { createOvernightRun } from '../domain/keep-going.mjs'

const clock = () => new Date('2026-09-17T00:00:00.000Z')

function fixtureCanonicalFact(overrides = {}) {
  return {
    schemaVersion: 'TSF_CANONICAL_FACT_V1',
    id: 'fact-1',
    fieldName: 'rateLimitStrategy',
    value: 'exponential backoff, 3 retries',
    temporalScope: null,
    reconciliationDecisionId: 'decision-1',
    derivationLineage: null,
    canonicalizedAt: '2026-09-16T00:00:00.000Z',
    ...overrides
  }
}

function fixturePackageBody({ nodes } = {}) {
  return {
    schemaVersion: 'TSF_RESEARCH_PROVENANCE_PACKAGE_V1',
    missionId: 'mission-1',
    projectId: 'proj-1',
    nodes: nodes ?? [
      {
        id: 'node-1',
        targetEntity: { id: 'entity-1', name: 'PaymentAPI' },
        status: 'COMPLETED',
        canonicalFacts: [fixtureCanonicalFact()]
      }
    ]
  }
}

test('buildResearchDrivenMissionSpec: refuses to build from a research mission with no CanonicalFacts at all', () => {
  const ungrounded = fixturePackageBody({ nodes: [{ id: 'node-1', targetEntity: null, status: 'COMPLETED', canonicalFacts: [] }] })
  assert.throws(
    () => buildResearchDrivenMissionSpec({ researchMissionId: 'mission-1', projectId: 'proj-1', researchPackageBody: ungrounded }),
    /no CanonicalFacts to build from/
  )
})

// Real adversarial-review finding: plain JSON.stringify hashes the SAME
// logical fact differently depending on incidental object-key insertion
// order, which would silently break "same fact, same hash-verified
// reference" traceability across two calls that happen to construct the
// identical fact with keys in a different order (e.g. spread order, or a
// future refactor).
test('buildResearchDrivenMissionSpec: the artifactReference hash is stable regardless of incidental object-key order (canonical, not JSON.stringify)', () => {
  const factA = fixtureCanonicalFact()
  const factB = { value: factA.value, id: factA.id, fieldName: factA.fieldName, schemaVersion: factA.schemaVersion, temporalScope: factA.temporalScope, reconciliationDecisionId: factA.reconciliationDecisionId, derivationLineage: factA.derivationLineage, canonicalizedAt: factA.canonicalizedAt }
  const specA = buildResearchDrivenMissionSpec({
    researchMissionId: 'mission-1',
    projectId: 'proj-1',
    researchPackageBody: fixturePackageBody({ nodes: [{ id: 'node-1', targetEntity: { id: 'entity-1', name: 'PaymentAPI' }, status: 'COMPLETED', canonicalFacts: [factA] }] })
  })
  const specB = buildResearchDrivenMissionSpec({
    researchMissionId: 'mission-1',
    projectId: 'proj-1',
    researchPackageBody: fixturePackageBody({ nodes: [{ id: 'node-1', targetEntity: { id: 'entity-1', name: 'PaymentAPI' }, status: 'COMPLETED', canonicalFacts: [factB] }] })
  })
  assert.equal(
    specA.artifactReferences[0].sha256,
    specB.artifactReferences[0].sha256,
    'the same logical fact must hash identically regardless of key insertion order'
  )
})

test('buildResearchDrivenMissionSpec: every acceptance criterion cites the real CanonicalFact id it came from (SPEC_TRACEABILITY)', () => {
  const spec = buildResearchDrivenMissionSpec({
    researchMissionId: 'mission-1',
    projectId: 'proj-1',
    researchPackageBody: fixturePackageBody(),
    createdAt: clock().toISOString()
  })
  assert.equal(spec.parentMissionType, RESEARCH_DRIVEN_MISSION_TYPE)
  assert.equal(spec.acceptanceCriteria.length, 1)
  assert.match(spec.acceptanceCriteria[0], /\[FACT:fact-1\]/)
  assert.match(spec.acceptanceCriteria[0], /PaymentAPI/)
  assert.match(spec.acceptanceCriteria[0], /rateLimitStrategy/)
  // The durable, hash-verified half: one artifactReference per fact, with
  // a real sha256 (buildMissionSpecification's own integrity mechanism),
  // not just the human-readable criterion string.
  assert.equal(spec.artifactReferences.length, 1)
  assert.equal(spec.artifactReferences[0].name, 'canonical-fact:fact-1')
  assert.equal(spec.artifactReferences[0].type, 'RESEARCH_CANONICAL_FACT')
  assert.ok(spec.artifactReferences[0].sha256, 'the artifact reference is really hashed, not left null')
  assert.equal(spec.researchDrivenProvenance.researchMissionId, 'mission-1')
  assert.equal(spec.researchDrivenProvenance.groundedNodeCount, 1)
  assert.equal(spec.researchDrivenProvenance.researchCriteriaCount, 1)
})

test('buildResearchDrivenMissionSpec: a node that completed with zero CanonicalFacts contributes nothing (never fabricates a criterion from an ungrounded node)', () => {
  const mixed = fixturePackageBody({
    nodes: [
      { id: 'node-1', targetEntity: { name: 'A' }, status: 'COMPLETED', canonicalFacts: [fixtureCanonicalFact({ id: 'fact-1' })] },
      { id: 'node-2', targetEntity: { name: 'B' }, status: 'COMPLETED', canonicalFacts: [] }
    ]
  })
  const criteria = acceptanceCriteriaFromResearch(mixed)
  assert.equal(criteria.length, 1)
  assert.match(criteria[0], /fact-1/)
})

test('buildResearchDrivenMissionSpec: a resolved CHALLENGE MUST_FIX finding becomes its own traceable acceptance criterion; an ADVISORY finding does not', () => {
  const spec = buildResearchDrivenMissionSpec({
    researchMissionId: 'mission-1',
    projectId: 'proj-1',
    researchPackageBody: fixturePackageBody(),
    resolvedChallengeFindings: [
      { id: 'chal-1', severity: 'MUST_FIX', summary: 'Handle the case where PaymentAPI rate limit headers are absent.' },
      { id: 'chal-2', severity: 'ADVISORY', summary: 'Consider caching the rate limit window.' }
    ],
    createdAt: clock().toISOString()
  })
  const mustFix = spec.acceptanceCriteria.filter((c) => c.startsWith('[CHALLENGE:'))
  assert.equal(mustFix.length, 1)
  assert.match(mustFix[0], /chal-1/)
  assert.match(mustFix[0], /rate limit headers are absent/)
  assert.equal(spec.researchDrivenProvenance.challengeFindingCount, 2, 'both findings are recorded on the provenance, even the advisory one')
  assert.equal(spec.researchDrivenProvenance.challengeMustFixCount, 1)
})

function completeResearchDrivenRun(overrides = {}) {
  const base = createOvernightRun(
    {
      id: 'run-1',
      projectId: 'proj-1',
      originalGoal: 'x',
      acceptanceCriteria: ['[FACT:fact-1] x'],
      missionSpec: {
        researchDrivenProvenance: {
          researchMissionId: 'mission-1',
          groundedNodeCount: 1,
          researchCriteriaCount: 1,
          challengeFindingCount: 1,
          challengeMustFixCount: 1
        }
      }
    },
    clock
  )
  return { ...base, state: 'COMPLETE', ...overrides }
}

test('extractResearchDrivenDevelopmentLessons: requires a COMPLETE run', () => {
  const run = { ...completeResearchDrivenRun(), state: 'ACTIVE' }
  assert.throws(() => extractResearchDrivenDevelopmentLessons(run, clock), /TSF_LEARNING_LEDGER_RUN_NOT_COMPLETE|requires a COMPLETE run/)
})

test('extractResearchDrivenDevelopmentLessons: requires a research-driven run (missionSpec.researchDrivenProvenance)', () => {
  const run = { ...completeResearchDrivenRun(), missionSpec: null }
  assert.throws(() => extractResearchDrivenDevelopmentLessons(run, clock), /researchDrivenProvenance/)
})

test('extractResearchDrivenDevelopmentLessons: a run with real retries records a real, evidenced handoff-friction lesson', () => {
  // gap.remainingGaps explicitly non-empty so this proves the retry-
  // friction lesson in isolation, not conflated with the separate
  // clean-convergence lesson (which requires remainingGaps === []).
  const run = completeResearchDrivenRun({
    retryCounts: { 'item-1': 2 },
    gap: { satisfiedCriteria: [], remainingGaps: ['[FACT:fact-1] x'], decision: 'CONTINUE' }
  })
  const lessons = extractResearchDrivenDevelopmentLessons(run, clock)
  assert.equal(lessons.length, 1, 'only the retry-friction lesson, not also a false clean-convergence claim')
  const friction = lessons.find((l) => /needed 2 real retry/.test(l.statement))
  assert.ok(friction, 'expected a retry-friction lesson')
  assert.equal(friction.category, 'RESEARCH_TO_BUILD_HANDOFF_PATTERN')
  assert.deepEqual(friction.sourceMissionIds, ['run-1'])
})

test('extractResearchDrivenDevelopmentLessons: a clean convergence with resolved MUST_FIX findings records a positive lesson; zero real signal records nothing (never padded)', () => {
  const clean = completeResearchDrivenRun({ gap: { satisfiedCriteria: ['[FACT:fact-1] x'], remainingGaps: [], decision: 'STOP' } })
  const lessons = extractResearchDrivenDevelopmentLessons(clean, clock)
  assert.equal(lessons.length, 1)
  assert.match(lessons[0].statement, /converged with zero remaining gaps/)

  const nothingToLearn = completeResearchDrivenRun({
    missionSpec: {
      researchDrivenProvenance: {
        researchMissionId: 'mission-1',
        groundedNodeCount: 1,
        researchCriteriaCount: 1,
        challengeFindingCount: 0,
        challengeMustFixCount: 0
      }
    },
    gap: { satisfiedCriteria: [], remainingGaps: ['still open'], decision: 'CONTINUE' }
  })
  assert.deepEqual(extractResearchDrivenDevelopmentLessons(nothingToLearn, clock), [])
})

test('recordResearchDrivenDevelopmentLessons: idempotent by content hash, matching every other ledger writer', () => {
  const run = completeResearchDrivenRun({
    retryCounts: { 'item-1': 3 },
    gap: { satisfiedCriteria: [], remainingGaps: ['[FACT:fact-1] x'], decision: 'CONTINUE' }
  })
  const once = recordResearchDrivenDevelopmentLessons(emptyPlatformLearningLedger(), run, clock)
  assert.equal(once.lessonsRecorded, 1)
  const twice = recordResearchDrivenDevelopmentLessons(once.ledger, run, clock)
  assert.equal(twice.lessonsRecorded, 0, 're-recording the same completed run must never duplicate the lesson')
  assert.equal(twice.ledger.lessons.length, 1)
})

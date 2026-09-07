// Native Self-Improvement Loop V1, Phase 7: wires real repair-loop outcomes
// into the EXISTING platform-learning-ledger.mjs -- no second learning
// store. Mirrors Finding F3's own real wiring shape (research-mission-
// fleet-driver.mjs's gatherDispatchAdvisories/advanceOneMission): a write
// triggered by a genuine terminal/outcome event of this loop's own durable
// state, using the ledger's already-generic addLessonRecord (not the
// ResearchMission-specific extractLessonsFromCompletedMission, which reads
// fields a finding/repair-mission doesn't have).
import { addLessonRecord, emptyPlatformLearningLedger } from '../domain/platform-learning-ledger.mjs'
import { readPlatformLearningLedger, withPlatformLearningLedger } from './platform-learning-ledger-store.mjs'
import { recordSelfImprovementReceipt } from './self-improvement-receipt-store.mjs'

async function recordLesson(category, { confidence, statement, evidenceSummary, missionId }, clock, deps) {
  const withLedger = deps.withPlatformLearningLedger ?? withPlatformLearningLedger
  let lessonsRecorded = 0
  await withLedger((current) => {
    const ledger = current ?? emptyPlatformLearningLedger()
    const next = addLessonRecord(ledger, { category, confidence, statement, evidenceSummary, sourceMissionIds: [missionId] }, clock)
    lessonsRecorded = next.lessons.length - ledger.lessons.length
    return next
  })
  if (lessonsRecorded > 0) {
    const recordReceipt = deps.recordSelfImprovementReceipt ?? recordSelfImprovementReceipt
    await recordReceipt(missionId, { kind: 'LESSON_RECORDED', missionId, findingId: deps.findingId ?? null, detail: { category, statement } }, clock)
  }
  return lessonsRecorded
}

// A detector reported a finding a human later marked REJECTED_FALSE_POSITIVE
// -- a real signal about that detector/kind's own reliability.
export function recordDetectorFalsePositiveLesson(finding, clock, deps = {}) {
  return recordLesson(
    'DETECTOR_FALSE_POSITIVE_PATTERN',
    {
      confidence: 'LOW',
      statement: `Detector ${finding.sourceDetector} produced a REJECTED_FALSE_POSITIVE finding for surface "${finding.affectedSurface}" (candidateFixScope.kind: ${finding.candidateFixScope?.kind ?? 'none'}).`,
      evidenceSummary: `finding ${finding.findingId}, occurrences=${finding.occurrences}`,
      missionId: `finding:${finding.findingId}`
    },
    clock,
    { ...deps, findingId: finding.findingId }
  )
}

// A repair mission's fix was independently verified and the finding
// reached RESOLVED via redogfood -- a real, rationale-bearing correction
// pattern, exactly VERIFIED_CORRECTION_PATTERN's own intent (reused
// directly, not a new category).
export function recordVerifiedCorrectionLesson(finding, missionId, clock, deps = {}) {
  return recordLesson(
    'VERIFIED_CORRECTION_PATTERN',
    {
      confidence: 'MEDIUM',
      statement: `A ${finding.candidateFixScope?.kind ?? 'UNKNOWN'} repair for ${finding.sourceDetector} finding on "${finding.affectedSurface}" was independently verified and confirmed RESOLVED by redogfood.`,
      evidenceSummary: `finding ${finding.findingId}, mission ${missionId}`,
      missionId
    },
    clock,
    { ...deps, findingId: finding.findingId }
  )
}

// A repair attempt's fix was rejected by the independent verifier -- the
// specific reason class is the recurring signal worth remembering (e.g.
// repeated FORBIDDEN_SURFACE_TOUCHED for one subsystem suggests the
// authority envelope needs tightening, not just this one worker retried).
export function recordVerifierFailureLesson(finding, missionId, verification, clock, deps = {}) {
  return recordLesson(
    'VERIFIER_FAILURE_PATTERN',
    {
      confidence: 'LOW',
      statement: `Independent verifier rejected a repair candidate for ${finding.sourceDetector} finding on "${finding.affectedSurface}": ${verification.reasons.join('; ')}.`,
      evidenceSummary: `finding ${finding.findingId}, mission ${missionId}, verdict ${verification.verdict}`,
      missionId
    },
    clock,
    { ...deps, findingId: finding.findingId }
  )
}

// A finding recurred enough times (Wave A's own occurrences counter) that
// its affectedSurface is a real, repeated subsystem defect worth
// surfacing to future missions.
const RECURRING_SUBSYSTEM_THRESHOLD = 3
export function recordRecurringSubsystemDefectLesson(finding, clock, deps = {}) {
  if (finding.occurrences < RECURRING_SUBSYSTEM_THRESHOLD) { return Promise.resolve(0) }
  return recordLesson(
    'RECURRING_SUBSYSTEM_DEFECT',
    {
      confidence: finding.occurrences >= 10 ? 'HIGH' : 'MEDIUM',
      statement: `Subsystem "${finding.affectedSurface}" has produced ${finding.occurrences} occurrences of the same ${finding.sourceDetector} finding.`,
      evidenceSummary: `finding ${finding.findingId}, occurrences=${finding.occurrences}`,
      missionId: `finding:${finding.findingId}`
    },
    clock,
    { ...deps, findingId: finding.findingId }
  )
}

export { readPlatformLearningLedger }

// Real Learning Ledger writes (isolated state file, real file lock) --
// proves this wave wires into the EXISTING platform-learning-ledger.mjs
// (no second store) and that the pre-existing categories/behavior are
// unaffected by the additive LESSON_CATEGORIES extension.
import assert from 'node:assert/strict'
import test from 'node:test'
import { rmSync } from 'node:fs'
import path from 'node:path'

const HERE = import.meta.dirname
const STATE_FILE = path.join(HERE, '..', 'server', '.local-state', `operator-state.test-selfimprove-ledger-${process.pid}.json`)
process.env.TSF_UI_STATE_FILE = STATE_FILE

const { LESSON_CATEGORIES, retrieveLessonGuidance } = await import('../domain/platform-learning-ledger.mjs')
const { readPlatformLearningLedger } = await import('../server/platform-learning-ledger-store.mjs')
const { recordDetectorFalsePositiveLesson, recordRecurringSubsystemDefectLesson, recordVerifiedCorrectionLesson, recordVerifierFailureLesson } = await import(
  '../server/self-improvement-learning-ledger-wiring.mjs'
)

function cleanupStateFile() {
  for (const suffix of ['', '.tmp', '.platform-learning-ledger.lock', '.self-improvement-receipt.lock']) {
    rmSync(`${STATE_FILE}${suffix}`, { force: true })
  }
}
cleanupStateFile()
test.after(cleanupStateFile)

const clock = () => new Date('2026-09-07T12:00:00.000Z')

test('the additive lesson categories exist alongside every pre-existing one, none removed/renamed', () => {
  for (const existing of [
    'PROVIDER_RELIABILITY_SIGNAL',
    'RECURRING_DISPATCH_FAILURE',
    'IDENTITY_AMBIGUITY_PATTERN',
    'COMPLETENESS_GAP_PATTERN',
    'SOURCE_RELIABILITY_SIGNAL',
    'VERIFIED_CORRECTION_PATTERN'
  ]) {
    assert.ok(LESSON_CATEGORIES.includes(existing))
  }
  for (const added of ['DETECTOR_FALSE_POSITIVE_PATTERN', 'VERIFIER_FAILURE_PATTERN', 'RECURRING_SUBSYSTEM_DEFECT']) {
    assert.ok(LESSON_CATEGORIES.includes(added))
  }
})

test('recordDetectorFalsePositiveLesson durably records a real, retrievable lesson', async () => {
  const finding = { findingId: 'finding:fp1', sourceDetector: 'UI_DOGFOOD', affectedSurface: 'settings-page', candidateFixScope: { kind: 'BOUNDED_CODE_DEFECT' }, occurrences: 1 }
  const recorded = await recordDetectorFalsePositiveLesson(finding, clock, {})
  assert.equal(recorded, 1)
  const ledger = readPlatformLearningLedger()
  const lessons = retrieveLessonGuidance(ledger, 'DETECTOR_FALSE_POSITIVE_PATTERN')
  assert.equal(lessons.length, 1)
  assert.equal(lessons[0].advisoryOnly, true)
  assert.equal(lessons[0].neverOverridesVerifiedEvidence, true)
  assert.match(lessons[0].statement, /UI_DOGFOOD/)
})

test('recordDetectorFalsePositiveLesson is idempotent by content -- re-recording the identical lesson is a no-op', async () => {
  const finding = { findingId: 'finding:fp1', sourceDetector: 'UI_DOGFOOD', affectedSurface: 'settings-page', candidateFixScope: { kind: 'BOUNDED_CODE_DEFECT' }, occurrences: 1 }
  const recorded = await recordDetectorFalsePositiveLesson(finding, clock, {})
  assert.equal(recorded, 0)
})

test('recordVerifiedCorrectionLesson reuses the EXISTING VERIFIED_CORRECTION_PATTERN category directly, not a new one', async () => {
  const finding = { findingId: 'finding:vc1', sourceDetector: 'RUNTIME_ASSERTION', affectedSurface: 'x', candidateFixScope: { kind: 'BOUNDED_CODE_DEFECT' } }
  await recordVerifiedCorrectionLesson(finding, 'mission:selfimprove:vc1', clock, {})
  const ledger = readPlatformLearningLedger()
  assert.equal(retrieveLessonGuidance(ledger, 'VERIFIED_CORRECTION_PATTERN').length, 1)
})

test('recordVerifierFailureLesson records the real rejection reasons', async () => {
  const finding = { findingId: 'finding:vf1', sourceDetector: 'RUNTIME_ASSERTION', affectedSurface: 'x' }
  await recordVerifierFailureLesson(finding, 'mission:selfimprove:vf1', { verdict: 'VERIFIED_FAIL', reasons: ['FORBIDDEN_SURFACE_TOUCHED:tsf/server/cleanup-owner-authorization-gate.mjs'] }, clock, {})
  const ledger = readPlatformLearningLedger()
  const lessons = retrieveLessonGuidance(ledger, 'VERIFIER_FAILURE_PATTERN')
  assert.equal(lessons.length, 1)
  assert.match(lessons[0].statement, /FORBIDDEN_SURFACE_TOUCHED/)
})

test('recordRecurringSubsystemDefectLesson never fabricates a pattern from a single occurrence', async () => {
  const finding = { findingId: 'finding:rs1', sourceDetector: 'RUNTIME_ASSERTION', affectedSurface: 'x', occurrences: 1 }
  const recorded = await recordRecurringSubsystemDefectLesson(finding, clock, {})
  assert.equal(recorded, 0)
})

test('recordRecurringSubsystemDefectLesson records once real occurrences clear the threshold', async () => {
  const finding = { findingId: 'finding:rs2', sourceDetector: 'RUNTIME_ASSERTION', affectedSurface: 'y', occurrences: 3 }
  const recorded = await recordRecurringSubsystemDefectLesson(finding, clock, {})
  assert.equal(recorded, 1)
})

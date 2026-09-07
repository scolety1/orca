// CAS-store-level proof, isolated state file (mirrors planner-mission-
// store.test.mjs's own pattern). Covers what the pure domain tests can't:
// real cross-process-file-lock atomicity and the store's own findingIdFor
// wiring.
import assert from 'node:assert/strict'
import test from 'node:test'
import { rmSync } from 'node:fs'
import path from 'node:path'

const HERE = import.meta.dirname
const STATE_FILE = path.join(
  HERE,
  '..',
  'server',
  '.local-state',
  `operator-state.test-self-improvement-finding-store-${process.pid}.json`
)
process.env.TSF_UI_STATE_FILE = STATE_FILE

const { readAllFindings, readFinding, recordFindingDetection, withFinding } = await import(
  '../server/self-improvement-finding-store.mjs'
)
const { findingIdFor } = await import('../domain/self-improvement-finding.mjs')

function cleanupStateFile() {
  for (const suffix of ['', '.tmp', '.self-improvement-finding.lock']) {
    rmSync(`${STATE_FILE}${suffix}`, { force: true })
  }
}
cleanupStateFile()

const clock = () => new Date('2026-09-07T12:00:00.000Z')
const later = () => new Date('2026-09-07T13:00:00.000Z')

function rawFinding(overrides = {}) {
  return {
    sourceDetector: 'GOLDEN_PATH_EVAL',
    severity: 'P2',
    evidence: { caseId: 'case-1' },
    reproduction: { command: 'node --test' },
    affectedSurface: 'golden-path:platform',
    confidence: 0.8,
    verificationMethod: 'EVAL_PACK_RERUN',
    ...overrides
  }
}

test('self-improvement finding store', async (t) => {
  try {
    await t.test('readFinding returns null before anything is written', () => {
      assert.equal(readFinding(findingIdFor(rawFinding())), null)
    })

    await t.test('recordFindingDetection creates on first sighting and persists durably', async () => {
      const finding = await recordFindingDetection(rawFinding(), clock)
      assert.equal(finding.status, 'DETECTED')
      assert.equal(finding.occurrences, 1)
      const reloaded = readFinding(finding.findingId)
      assert.deepEqual(reloaded, finding)
    })

    await t.test('recordFindingDetection on the SAME symptom bumps occurrences instead of creating a second record', async () => {
      const raw = rawFinding({ affectedSurface: 'dedup-surface' })
      const first = await recordFindingDetection(raw, clock)
      const second = await recordFindingDetection(raw, later)
      assert.equal(second.findingId, first.findingId)
      assert.equal(second.occurrences, first.occurrences + 1)
    })

    await t.test('a genuinely different symptom creates a distinct record', async () => {
      const before = Object.keys(readAllFindings()).length
      await recordFindingDetection(rawFinding({ affectedSurface: 'a-different-surface' }), clock)
      assert.equal(Object.keys(readAllFindings()).length, before + 1)
    })

    await t.test('withFinding: concurrent writers on the SAME findingId are serialized, not lost (no torn write)', async () => {
      const findingId = 'finding:concurrency-test'
      const writers = Array.from({ length: 10 }, () =>
        withFinding(findingId, (current) => ({
          ...(current ?? { schemaVersion: 'TSF_SELF_IMPROVEMENT_FINDING_V1', count: 0 }),
          count: (current?.count ?? 0) + 1
        }))
      )
      await Promise.all(writers)
      assert.equal(
        readFinding(findingId).count,
        10,
        'every one of 10 concurrent increments must land -- none silently lost to a torn read-modify-write'
      )
    })

    await t.test('concurrent recordFindingDetection calls for the SAME real symptom never lose an occurrence', async () => {
      const raw = rawFinding({ affectedSurface: 'race-surface' })
      const writers = Array.from({ length: 8 }, () => recordFindingDetection(raw, clock))
      await Promise.all(writers)
      const finding = readFinding(findingIdFor(raw))
      assert.equal(finding.occurrences, 8, 'every concurrent detection of the same symptom must be counted')
    })
  } finally {
    cleanupStateFile()
  }
})

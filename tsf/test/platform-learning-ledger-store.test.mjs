// Durable persistence for the cross-mission Platform Learning Ledger,
// mirroring research-library-store.test.mjs's isolated-state-file pattern
// (REUSE_PATTERN): real cross-process-file-lock-backed writes, own
// STATE_FILE so this never collides with a concurrent test run or a real
// running dev server.
import assert from 'node:assert/strict'
import test from 'node:test'
import { rmSync } from 'node:fs'
import path from 'node:path'
import { addLessonRecord, emptyPlatformLearningLedger } from '../domain/platform-learning-ledger.mjs'

const HERE = import.meta.dirname
const STATE_FILE = path.join(HERE, '..', 'server', '.local-state', `operator-state.test-learning-ledger-store-${process.pid}.json`)
process.env.TSF_UI_STATE_FILE = STATE_FILE

const { readPlatformLearningLedger, withPlatformLearningLedger } = await import('../server/platform-learning-ledger-store.mjs')

function cleanupStateFile() {
  for (const suffix of ['', '.tmp', '.platform-learning-ledger.lock']) {
    rmSync(`${STATE_FILE}${suffix}`, { force: true })
  }
}
cleanupStateFile()
test.after(cleanupStateFile)

const clock = () => new Date('2026-10-12T09:00:00.000Z')

test('readPlatformLearningLedger returns null before first use', () => {
  assert.equal(readPlatformLearningLedger(), null)
})

test('withPlatformLearningLedger constructs and persists the ledger on first use, and a lesson survives a fresh read', async () => {
  await withPlatformLearningLedger((current) => addLessonRecord(current ?? emptyPlatformLearningLedger(), {
    category: 'PROVIDER_RELIABILITY_SIGNAL',
    statement: 'a durable test lesson',
    evidenceSummary: 'evidence',
    confidence: 'LOW',
    sourceMissionIds: ['mission:store-test']
  }, clock))
  const reread = readPlatformLearningLedger()
  assert.equal(reread.lessons.length, 1)
  assert.equal(reread.lessons[0].statement, 'a durable test lesson')
})

test('re-adding the identical lesson via a fresh withPlatformLearningLedger call is a true idempotent no-op', async () => {
  const before = readPlatformLearningLedger().lessons.length
  await withPlatformLearningLedger((current) => addLessonRecord(current, {
    category: 'PROVIDER_RELIABILITY_SIGNAL',
    statement: 'a durable test lesson',
    evidenceSummary: 'evidence',
    confidence: 'LOW',
    sourceMissionIds: ['mission:store-test']
  }, clock))
  assert.equal(readPlatformLearningLedger().lessons.length, before)
})

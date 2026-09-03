// Wave 2: proves the bounded fix for the disclosed Windows cross-process
// rename flake (keep-going-run-store-cross-process.test.mjs's intermittent
// EPERM on saveState's rename). Confirms: (1) a transient rename failure
// is retried and recovers without state loss; (2) exhausting retries
// throws honestly, never silently swallowed; (3) the real state file is
// never left corrupted/partially-written by a failed rename attempt --
// rename is atomic, so a failed attempt leaves the PRIOR valid content in
// place, never a torn write.
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync, renameSync, rmSync } from 'node:fs'
import path from 'node:path'

const HERE = import.meta.dirname
const STATE_FILE = path.join(HERE, '..', 'server', '.local-state', `operator-state.test-rename-retry-${process.pid}.json`)
process.env.TSF_UI_STATE_FILE = STATE_FILE

const { loadState, saveState } = await import('../server/data-store.mjs')

function cleanup() {
  for (const suffix of ['', '.tmp']) rmSync(`${STATE_FILE}${suffix}`, { force: true })
}
cleanup()

function eperm() {
  const error = new Error('simulated transient EPERM on rename')
  error.code = 'EPERM'
  return error
}

test('a transient rename failure is retried (on this Windows host) and recovers with the real content durably written', () => {
  let calls = 0
  const flakyRename = (from, to) => {
    calls += 1
    if (calls <= 2) throw eperm()
    return renameSync(from, to)
  }
  const state = { ...loadState(), usageMode: 'BALANCED', workSet: ['proof-of-retry'] }
  saveState(state, { rename: flakyRename })
  assert.equal(calls, 3, 'failed twice, succeeded on the third attempt')
  const persisted = JSON.parse(readFileSync(STATE_FILE, 'utf8'))
  assert.deepEqual(persisted.workSet, ['proof-of-retry'], 'the real content is durably written once the retry succeeds')
  cleanup()
})

test('exhausting all retries throws the real error honestly -- never silently swallowed', () => {
  const alwaysFails = () => {
    throw eperm()
  }
  assert.throws(() => saveState(loadState(), { rename: alwaysFails }), /simulated transient EPERM/)
  cleanup()
})

test('a fully-exhausted rename failure never leaves the real state file corrupted -- prior valid content survives untouched', () => {
  const first = { ...loadState(), workSet: ['first-real-write'] }
  saveState(first)
  const beforeFailedAttempt = readFileSync(STATE_FILE, 'utf8')

  const alwaysFails = () => {
    throw eperm()
  }
  assert.throws(() => saveState({ ...loadState(), workSet: ['this-write-must-never-land'] }, { rename: alwaysFails }))

  const afterFailedAttempt = readFileSync(STATE_FILE, 'utf8')
  assert.equal(afterFailedAttempt, beforeFailedAttempt, 'the file on disk is byte-identical to before the failed write -- rename is atomic, so a failed attempt never partially applies')
  const persisted = JSON.parse(afterFailedAttempt)
  assert.deepEqual(persisted.workSet, ['first-real-write'])
  cleanup()
})

test('non-retryable errors (e.g. a genuine ENOENT) are never retried -- retry is scoped to the specific transient-contention codes', () => {
  let calls = 0
  const genuineError = () => {
    calls += 1
    const error = new Error('genuinely missing directory')
    error.code = 'ENOENT'
    throw error
  }
  assert.throws(() => saveState(loadState(), { rename: genuineError }), /genuinely missing directory/)
  assert.equal(calls, 1, 'a non-retryable error code must fail immediately, not spend the retry budget')
  cleanup()
})

import assert from 'node:assert/strict'
import test from 'node:test'
import path from 'node:path'
import { rmSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'

const HERE = import.meta.dirname
const STATE_FILE = path.join(
  HERE,
  '..',
  'server',
  '.local-state',
  `operator-state.test-runtime-identity-${process.pid}.json`
)
process.env.TSF_UI_STATE_FILE = STATE_FILE

const { getRuntimeIdentity, writeRuntimeMetadata, readRuntimeMetadata, isProcessAlive } =
  await import('../server/runtime-identity-tracker.mjs')

test.after(() => {
  rmSync(STATE_FILE, { force: true })
  rmSync(`${STATE_FILE}.runtime.json`, { force: true })
})

test('isProcessAlive is true for this real, currently-running process', () => {
  assert.equal(isProcessAlive(process.pid), true)
})

test('isProcessAlive is false for a pid that almost certainly does not exist', () => {
  // A very large pid number is exceedingly unlikely to correspond to a
  // real process on any real system.
  assert.equal(isProcessAlive(999999), false)
})

test('isProcessAlive is honestly false for no pid at all', () => {
  assert.equal(isProcessAlive(null), false)
  assert.equal(isProcessAlive(undefined), false)
})

// Runs before writeRuntimeMetadata is ever called in this file -- data-
// store.mjs's getStateFilePath() reads TSF_UI_STATE_FILE once at module
// load, not per call (the same convention every other test file in this
// suite relies on: set the env var once, at the very top, before any
// transitive import of data-store.mjs), so this genuinely observes "no
// file written yet" rather than a stale env swap.
test('readRuntimeMetadata is honestly null when no metadata file exists yet', () => {
  rmSync(`${STATE_FILE}.runtime.json`, { force: true })
  assert.equal(readRuntimeMetadata(), null)
})

test('writeRuntimeMetadata/readRuntimeMetadata round-trip a real PID/commit/startedAt', async () => {
  const written = await writeRuntimeMetadata()
  assert.equal(written.pid, process.pid)
  assert.match(written.commit, /^[0-9a-f]{40}$/)
  assert.ok(written.startedAt)

  const read = readRuntimeMetadata()
  assert.deepEqual(read, written)
})

test('getRuntimeIdentity reports UP_TO_DATE for this real, unmodified repo (running===disk), and honestly UI_BUNDLE_STALE for a dist with no build-identity.json', async () => {
  const emptyDist = mkdtempSync(path.join(tmpdir(), 'tsf-runtime-identity-dist-'))
  const identity = await getRuntimeIdentity(emptyDist)
  assert.match(identity.runningCommit, /^[0-9a-f]{40}$/)
  assert.equal(identity.runningCommit, identity.diskCommit)
  assert.equal(identity.uiBundleCommit, null)
  assert.equal(identity.state, 'UI_BUNDLE_STALE')
})

test('getRuntimeIdentity reports UP_TO_DATE once the UI bundle identity genuinely matches', async () => {
  const dist = mkdtempSync(path.join(tmpdir(), 'tsf-runtime-identity-dist-'))
  const identity = await getRuntimeIdentity(dist)
  writeFileSync(
    path.join(dist, 'build-identity.json'),
    JSON.stringify({ commit: identity.diskCommit, builtAt: new Date().toISOString() })
  )
  const second = await getRuntimeIdentity(dist)
  assert.equal(second.state, 'UP_TO_DATE')
})

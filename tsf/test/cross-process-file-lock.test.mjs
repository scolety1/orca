import assert from 'node:assert/strict'
import test from 'node:test'
import { existsSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const HERE = import.meta.dirname
const LOCK_PATH = path.join(HERE, '..', 'server', '.local-state', `test-lock-${process.pid}.lock`)

const { acquireFileLock, releaseFileLock } = await import('../server/cross-process-file-lock.mjs')

test.afterEach(() => {
  rmSync(LOCK_PATH, { force: true })
})

test('acquireFileLock creates the lock file and returns a token; a second acquire attempt would contend', async () => {
  const token = await acquireFileLock(LOCK_PATH, 1000)
  assert.ok(existsSync(LOCK_PATH))
  assert.ok(token)
  await releaseFileLock(LOCK_PATH, token)
  assert.ok(!existsSync(LOCK_PATH), 'released lock file is removed')
})

// The headline safety property this diff added, per an independent review
// finding: without a token check, releasing a stale reference could delete
// a DIFFERENT holder's currently-valid lock. Simulates that directly by
// hand-writing a different token's lock content (as if another process had
// reclaimed this path as stale and created its own fresh lock) and
// confirming a release carrying the OLD token leaves it alone.
test('releaseFileLock with a stale token does not delete a lock a different holder currently owns', async () => {
  const staleToken = await acquireFileLock(LOCK_PATH, 1000)
  // Simulate another process reclaiming this path as stale and creating
  // its own fresh lock, without going through this process's own release.
  const freshToken = 'simulated-fresh-holder-token'
  writeFileSync(LOCK_PATH, `99999:${freshToken}`)

  await releaseFileLock(LOCK_PATH, staleToken)

  assert.ok(existsSync(LOCK_PATH), "the fresh holder's lock must survive a stale release")
  assert.equal(readFileSync(LOCK_PATH, 'utf8'), `99999:${freshToken}`)
})

test('releaseFileLock with the correct token removes the lock file', async () => {
  const token = await acquireFileLock(LOCK_PATH, 1000)
  await releaseFileLock(LOCK_PATH, token)
  assert.ok(!existsSync(LOCK_PATH))
})

test('acquireFileLock creates the parent directory if it does not exist yet (a real review finding: a fresh install/CI container has no .local-state/ yet)', async () => {
  const freshDirLockPath = path.join(
    HERE,
    '..',
    'server',
    '.local-state',
    `fresh-subdir-${process.pid}`,
    'test.lock'
  )
  rmSync(path.dirname(freshDirLockPath), { recursive: true, force: true })
  assert.ok(!existsSync(path.dirname(freshDirLockPath)))

  const token = await acquireFileLock(freshDirLockPath, 1000)
  assert.ok(existsSync(freshDirLockPath))
  await releaseFileLock(freshDirLockPath, token)
  rmSync(path.dirname(freshDirLockPath), { recursive: true, force: true })
})

test('acquireFileLock times out honestly (never silently proceeds unlocked) when the lock is genuinely held and not stale', async () => {
  // Simulates a lock genuinely held by ANOTHER process (written directly,
  // with a fresh mtime) -- acquiring twice from THIS process on the same
  // path would instead hit the in-process reentrancy guard, a different,
  // deliberately distinct scenario tested separately below.
  writeFileSync(LOCK_PATH, '12345:some-other-processes-token')
  await assert.rejects(
    () => acquireFileLock(LOCK_PATH, 100),
    (error) => error.code === 'TSF_STATE_LOCK_TIMEOUT'
  )
})

test('a same-process nested acquire on a path this process already holds fails fast with a clear error, not a confusing timeout', async () => {
  const token = await acquireFileLock(LOCK_PATH, 1000)
  await assert.rejects(
    () => acquireFileLock(LOCK_PATH, 100),
    (error) => error.code === 'TSF_LOCK_REENTRANT'
  )
  await releaseFileLock(LOCK_PATH, token)
})

test('a stale lock (older than the staleness threshold) is reclaimed rather than blocking forever', async () => {
  // Simulates a lock left behind by a crashed OTHER process: written
  // directly (never through this process's own acquire, so the in-process
  // reentrancy guard has no record of it) with an old mtime, rather than
  // waiting the real 15s staleness threshold out.
  writeFileSync(LOCK_PATH, '12345:some-other-processes-token')
  const longAgo = new Date(Date.now() - 60_000)
  utimesSync(LOCK_PATH, longAgo, longAgo)

  const token = await acquireFileLock(LOCK_PATH, 1000)
  assert.ok(token)
  await releaseFileLock(LOCK_PATH, token)
})

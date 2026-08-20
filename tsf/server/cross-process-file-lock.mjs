// Async, cross-process mutex over one file path, built on the one
// filesystem primitive that is atomic across processes on every platform
// this program supports: exclusive file creation (open with 'wx' fails
// EEXIST if the file already exists, otherwise creates it). This is what
// actually protects keep-going-run-store.mjs's compare-and-swap -- that
// primitive's own atomicity argument ("Node's single-threaded event loop
// only yields at an await") only holds WITHIN one OS process. Two
// separate processes (a UI-serving process and a cron-triggered tick
// process, once that automation is authorized -- an independent verifier
// pass flagged this as a real, previously-undisclosed gap) reading/
// writing the same operator-state.json have no such protection without
// this lock.
//
// Async by design (a second independent review found the first version's
// synchronous Atomics.wait spin blocks the ENTIRE Node event loop while
// waiting, not just the current request -- turning brief lock contention
// into a full-server stall across every project, not just the one
// racing). Only the ACQUIRE-WAIT phase is async; once acquired, the
// caller's critical section must still be synchronous with no `await`
// inside it (same constraint withKeepGoingRun's own mutateFn already has)
// -- that is what keeps the actual read-mutate-write atomic.
import { randomUUID } from 'node:crypto'
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeSync
} from 'node:fs'
import path from 'node:path'

// A lock older than this is presumed abandoned by a crashed/killed holder
// rather than genuinely still held -- mirrors the domain layer's own
// TICK_LOCK_TIMEOUT_MS reasoning (tsf/domain/keep-going.mjs) for the same
// "don't deadlock forever on a holder that died" concern, one level down
// at the filesystem instead of the JSON state. Disclosed, accepted risk:
// this is mtime-based, not a liveness heartbeat -- a legitimately slow
// holder (e.g. a very large state file over a remote/SSH-mounted
// workspace) that exceeds this threshold could have its lock reclaimed
// while still working. The critical section here is an in-memory JSON
// read/mutate/write with no other I/O, so this is not expected in
// practice; a full heartbeat-refresh mechanism was judged out of scope
// for the risk this session could concretely exercise.
const STALE_LOCK_MS = 15_000
// Comfortably above STALE_LOCK_MS so a genuinely stale lock is always
// reached and reclaimed well before the overall acquire attempt gives up
// -- the previous version's 10s default (less than the 30s staleness
// threshold then in use) made reclaim unreachable on every real call path,
// a real, confirmed review finding.
const DEFAULT_ACQUIRE_TIMEOUT_MS = 30_000
const RETRY_INTERVAL_MS = 20
const WINDOWS_RETRY_DELAYS_MS = [20, 40, 80, 160, 320]

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// Windows can transiently fail a create/unlink with EPERM/EACCES/EBUSY
// while antivirus or an indexer holds the file open (the same documented
// hazard src/main/plugins/plugin-atomic-file-write.ts retries around for
// renames) -- retries the same bounded, backing-off way here.
async function withWindowsRetry(fn) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return fn()
    } catch (error) {
      const retryable = error.code === 'EPERM' || error.code === 'EACCES' || error.code === 'EBUSY'
      if (process.platform !== 'win32' || !retryable || attempt >= WINDOWS_RETRY_DELAYS_MS.length) {
        throw error
      }
      await sleep(WINDOWS_RETRY_DELAYS_MS[attempt])
    }
  }
}

function isStale(lockPath) {
  try {
    return Date.now() - statSync(lockPath).mtimeMs > STALE_LOCK_MS
  } catch {
    // Lock file vanished between our EEXIST and this stat (the holder
    // released it) -- not stale, just already gone; the next create
    // attempt in the caller's loop will succeed normally.
    return false
  }
}

// In-process guard only (a Map, not cross-process state): a nested/
// re-entrant call to acquire the SAME lock path from the SAME process
// would otherwise spin against a lock file it just created itself,
// timing out with a confusing TSF_STATE_LOCK_TIMEOUT instead of failing
// immediately with a clear cause -- a real review finding. No current
// caller nests withKeepGoingRun calls; this only guards against a future
// regression doing so.
const heldByThisProcess = new Set()

// Resolves with an opaque token once acquired; the caller must pass that
// exact token to releaseFileLock. Verifying the token before unlinking
// (rather than unconditionally unlinking whatever lock file currently
// exists) means a release can never delete a DIFFERENT holder's lock --
// e.g. one that reclaimed this same path as stale while this caller's own
// critical section was still finishing (a real review finding: the prior
// version's release blindly unlinked with no ownership check at all).
export async function acquireFileLock(lockPath, timeoutMs = DEFAULT_ACQUIRE_TIMEOUT_MS) {
  if (heldByThisProcess.has(lockPath)) {
    const error = new Error(
      `this process already holds the lock at ${lockPath} -- reentrant acquisition is not supported`
    )
    error.code = 'TSF_LOCK_REENTRANT'
    throw error
  }
  const dir = path.dirname(lockPath)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  const token = randomUUID()
  const deadline = Date.now() + timeoutMs
  for (;;) {
    try {
      await withWindowsRetry(() => {
        const fd = openSync(lockPath, 'wx')
        writeSync(fd, `${process.pid}:${token}`)
        closeSync(fd)
      })
      heldByThisProcess.add(lockPath)
      return token
    } catch (error) {
      if (error.code !== 'EEXIST') {
        throw error
      }
      if (isStale(lockPath)) {
        try {
          await withWindowsRetry(() => unlinkSync(lockPath))
        } catch {
          // Another process reclaimed it first -- fine, just retry.
        }
        continue
      }
      if (Date.now() > deadline) {
        const timeoutError = new Error(
          `timed out after ${timeoutMs}ms waiting for lock: ${lockPath}`
        )
        timeoutError.code = 'TSF_STATE_LOCK_TIMEOUT'
        throw timeoutError
      }
      await sleep(RETRY_INTERVAL_MS)
    }
  }
}

export async function releaseFileLock(lockPath, token) {
  heldByThisProcess.delete(lockPath)
  try {
    const content = readFileSync(lockPath, 'utf8')
    if (!content.endsWith(`:${token}`)) {
      // Someone else already reclaimed this path as stale and holds a
      // DIFFERENT lock now -- releasing would delete their lock, not
      // ours (ours is already gone). Leave it alone.
      return
    }
    await withWindowsRetry(() => unlinkSync(lockPath))
  } catch {
    // Already gone (released twice, or reclaimed as stale by someone
    // else and then that holder already released it too) -- the desired
    // end state (this token not holding the lock) already holds.
  }
}

// Runs fn() with the lock held, always releasing it afterward (success or
// throw) -- fn MUST be synchronous with no `await` inside it, same
// constraint withKeepGoingRun's own mutateFn already has, and for the
// same reason: an await would let other code run while this "atomic"
// section is still open. Only the acquire-wait above is async.
export async function withFileLock(lockPath, timeoutMs, fn) {
  const token = await acquireFileLock(lockPath, timeoutMs)
  try {
    return fn()
  } finally {
    await releaseFileLock(lockPath, token)
  }
}

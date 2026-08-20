// Synchronous, cross-process mutex over one file path, built on the one
// filesystem primitive that is atomic across processes on every platform
// this program supports: exclusive file creation (open with 'wx' fails
// with EEXIST if the file already exists, otherwise creates it). This is
// what actually protects keep-going-run-store.mjs's compare-and-swap --
// that primitive's own atomicity argument ("Node's single-threaded event
// loop only yields at an await") only holds WITHIN one OS process. Two
// separate processes (a UI-serving process and a cron-triggered tick
// process, once that automation is authorized -- an independent verifier
// pass flagged this as a real, previously-undisclosed gap) reading/
// writing the same operator-state.json have no such protection without
// this lock.
import { closeSync, openSync, statSync, unlinkSync, writeSync } from 'node:fs'

// A lock older than this is presumed abandoned by a crashed/killed holder
// rather than genuinely still held -- mirrors the domain layer's own
// TICK_LOCK_TIMEOUT_MS reasoning (tsf/domain/keep-going.mjs) for the same
// "don't deadlock forever on a holder that died" concern, one level down
// at the filesystem instead of the JSON state.
const STALE_LOCK_MS = 30_000
const DEFAULT_ACQUIRE_TIMEOUT_MS = 10_000
const RETRY_INTERVAL_MS = 20

function isStale(lockPath) {
  try {
    return Date.now() - statSync(lockPath).mtimeMs > STALE_LOCK_MS
  } catch {
    // Lock file vanished between our EEXIST and this stat (the holder
    // released it) -- not stale, just already gone; the next createSync
    // attempt in the caller's loop will succeed normally.
    return false
  }
}

// Blocks the CURRENT thread (Node has no cross-process synchronous wait
// primitive otherwise) via Atomics.wait on a throwaway SharedArrayBuffer --
// a real sleep, not a CPU-spinning busy loop.
function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

// Acquires the lock, retrying until acquired or timeoutMs elapses (never
// unboundedly blocking -- matches this program's own "no passive/unbounded
// waiting" discipline). Throws TSF_STATE_LOCK_TIMEOUT on timeout, never
// silently proceeding unlocked.
export function acquireFileLock(lockPath, timeoutMs = DEFAULT_ACQUIRE_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    try {
      const fd = openSync(lockPath, 'wx')
      writeSync(fd, String(process.pid))
      closeSync(fd)
      return
    } catch (error) {
      if (error.code !== 'EEXIST') {
        throw error
      }
      if (isStale(lockPath)) {
        try {
          unlinkSync(lockPath)
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
      sleepSync(RETRY_INTERVAL_MS)
    }
  }
}

export function releaseFileLock(lockPath) {
  try {
    unlinkSync(lockPath)
  } catch {
    // Already gone (released twice, or reclaimed as stale by someone
    // else) -- the desired end state (lock not held by us) already holds.
  }
}

// Runs fn() with the lock held, always releasing it afterward (success or
// throw) -- fn MUST be synchronous with no `await` inside it, same
// constraint withKeepGoingRun's own mutateFn already has, and for the same
// reason: an await would let other code run while this "atomic" section
// is still open.
export function withFileLock(lockPath, timeoutMs, fn) {
  acquireFileLock(lockPath, timeoutMs)
  try {
    return fn()
  } finally {
    releaseFileLock(lockPath)
  }
}

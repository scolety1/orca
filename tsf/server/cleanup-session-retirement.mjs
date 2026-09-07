// Graceful, PID-targeted session retirement -- NEVER kill-by-executable-
// name (no `taskkill /IM`, no `pkill <name>` anywhere in this file). Every
// signal this module sends is addressed to one exact PID the caller
// asserts, and that assertion is re-verified against a caller-supplied
// identity marker immediately before signaling -- retiring the WRONG
// process because a PID was reused by an unrelated program between
// discovery and action is exactly the hazard a name-based kill would also
// have, so this module closes it explicitly rather than only avoiding the
// name-based form.
//
// Cross-platform "graceful": Node's signal delivery to a Windows process is
// not real POSIX SIGTERM (Windows has no such thing) -- `process.kill(pid,
// 'SIGTERM')` on win32 forcibly terminates immediately, which is NOT what
// "graceful" means here. The real cross-platform cooperative-shutdown
// mechanism is IPC: a target process spawned with `fork`/stdio 'ipc' can
// listen for a TSF_CLEANUP_GRACEFUL_RETIRE message and exit cleanly on its
// own terms. This module tries IPC first (when a `send` function is
// supplied -- i.e. the caller still holds the ChildProcess handle), waits
// up to `graceMs` for the PID to actually disappear, and ONLY THEN escalates
// to a forceful, still PID-specific stop.
import { execFile } from 'node:child_process'

function isPidAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error.code !== 'ESRCH'
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitForExit(pid, timeoutMs, pollMs = 100) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (!isPidAlive(pid)) {
      return true
    }
    await sleep(pollMs)
  }
  return !isPidAlive(pid)
}

// PID-specific forceful stop, used only after a real grace period elapsed
// with no cooperative exit. Still never name-based: win32 uses
// `taskkill /PID <exact pid> /F` (never /IM), POSIX uses SIGKILL to the
// exact PID.
async function forceStop(pid) {
  if (process.platform === 'win32') {
    await new Promise((resolve, reject) => {
      execFile('taskkill', ['/PID', String(pid), '/F'], { windowsHide: true }, (error) => {
        if (error && isPidAlive(pid)) {
          reject(error)
        } else {
          resolve()
        }
      })
    })
    return
  }
  process.kill(pid, 'SIGKILL')
}

// `expectedIdentityMarker` + `verifyIdentity(pid) -> boolean` let a caller
// prove the live PID is still the SAME process it thinks it is (e.g. the
// test fixture writes its own PID+marker to a file this function re-reads)
// before any signal is sent -- refuses with TSF_CLEANUP_IDENTITY_MISMATCH
// rather than silently signaling a PID-reused stranger process.
export async function retireSessionGracefully({ pid, verifyIdentity, send, graceMs = 3000 }) {
  if (!Number.isInteger(pid) || pid <= 0) {
    throw new Error('retireSessionGracefully requires a positive integer pid')
  }
  if (!isPidAlive(pid)) {
    return { ok: true, alreadyStopped: true, escalatedToForce: false }
  }
  if (typeof verifyIdentity === 'function' && !(await verifyIdentity(pid))) {
    const error = new Error(`refusing to retire pid ${pid}: identity verification failed (likely PID reuse)`)
    error.code = 'TSF_CLEANUP_IDENTITY_MISMATCH'
    throw error
  }

  if (typeof send === 'function') {
    try {
      send({ type: 'TSF_CLEANUP_GRACEFUL_RETIRE' })
    } catch {
      // IPC channel already gone -- fall through to the signal-based path.
    }
  } else if (process.platform !== 'win32') {
    process.kill(pid, 'SIGTERM')
  }

  const exitedGracefully = await waitForExit(pid, graceMs)
  if (exitedGracefully) {
    return { ok: true, alreadyStopped: false, escalatedToForce: false }
  }

  await forceStop(pid)
  const exitedAfterForce = await waitForExit(pid, 5000)
  if (!exitedAfterForce) {
    const error = new Error(`pid ${pid} did not exit even after forceful stop`)
    error.code = 'TSF_CLEANUP_RETIREMENT_FAILED'
    throw error
  }
  return { ok: true, alreadyStopped: false, escalatedToForce: true }
}

// Read-only `git count-objects -vH` collector for the Resource Auditor's
// disk-usage evidence. Same honest-failure convention as
// repository-identity.mjs: never throws, returns {ok:false, reason} on any
// failure. Runs exactly one read-only git command via execFile's args
// array (no shell, no command-string construction -- so no injection
// surface regardless of what worktreePath contains) -- no gc, no prune, no
// mutation of any kind. Path-scope authority (which paths this may even be
// called for) is enforced by the caller (resource-auditor-http-routes.mjs),
// not here -- this module only knows how to run the command safely once it
// has already been authorized.
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { existsSync } from 'node:fs'
import path from 'node:path'
import {
  parseGitCountObjectsVerbose,
  classifyGitObjectStoreDiskUsage
} from '../domain/resource-auditor-evidence.mjs'

const exec = promisify(execFile)
const GIT_TIMEOUT_MS = 15000
const COMMAND = 'git count-objects -vH'

// Bounded concurrency: this is a diagnostic tool for RAM/CPU pressure, so it
// must never itself become a source of unbounded concurrent git
// subprocesses under load. Mirrors Orca core's own
// WORKTREE_SCAN_CONCURRENCY=3 pattern (workspace-cleanup-scan-primitives.ts).
const MAX_CONCURRENT_SCANS = 2
let activeScans = 0
const waitQueue = []

function acquireSlot() {
  if (activeScans < MAX_CONCURRENT_SCANS) {
    activeScans++
    return Promise.resolve()
  }
  return new Promise((resolve) => waitQueue.push(resolve))
}

function releaseSlot() {
  const next = waitQueue.shift()
  if (next) {
    next()
  } else {
    activeScans--
  }
}

function slash(value) {
  return String(value || '').replaceAll('\\', '/')
}

export async function collectGitObjectStoreEvidence(worktreePath, clock) {
  const worktree = path.resolve(String(worktreePath ?? ''))
  if (!worktreePath || !existsSync(worktree)) {
    return {
      ok: false,
      reason: 'REPOSITORY_UNAVAILABLE',
      detail: `path does not exist: ${worktree}`
    }
  }
  const observedAt = clock ? clock().toISOString() : new Date().toISOString()
  await acquireSlot()
  let stdout
  try {
    ;({ stdout } = await exec(
      'git',
      ['-c', `safe.directory=${slash(worktree)}`, '-C', worktree, 'count-objects', '-v', '-H'],
      { timeout: GIT_TIMEOUT_MS, windowsHide: true, maxBuffer: 1024 * 1024, encoding: 'utf8' }
    ))
  } catch (error) {
    const reason = error.killed || error.signal ? 'GIT_COMMAND_TIMEOUT' : 'GIT_COMMAND_FAILED'
    return { ok: false, reason, detail: error.message }
  } finally {
    releaseSlot()
  }
  const fields = parseGitCountObjectsVerbose(stdout)
  const evidence = classifyGitObjectStoreDiskUsage(fields, {
    command: COMMAND,
    observedAt,
    worktreePath: worktree
  })
  return { ok: true, evidence, raw: stdout }
}

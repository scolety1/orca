// Reversible quarantine: moves (or, for a worktree about to be removed by
// git itself, copies) an artifact to a durable holding area BEFORE any
// permanent deletion happens, with a manifest written to disk before the
// risky filesystem step, updated after -- so an interruption mid-operation
// leaves enough evidence for recoverIncompleteQuarantine to reach a
// coherent state rather than silent data loss. `quarantineRoot` and `env`
// are injected so tests never touch a real machine's quarantine area.
import { randomUUID } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { isoNow } from '../domain/canonical.mjs'
import { getStateFilePath } from './data-store.mjs'

export function defaultQuarantineRoot(env = process.env) {
  return env?.TSF_CLEANUP_QUARANTINE_DIR || path.join(path.dirname(getStateFilePath()), 'cleanup-quarantine')
}

// Same bounded-backoff EPERM/EACCES/EBUSY retry as data-store.mjs's own
// withWindowsRenameRetry and cross-process-file-lock.mjs's withWindowsRetry
// -- a directory/file handle release (antivirus, indexer, or a just-killed
// process's OS-level handle teardown) can lag the process actually exiting
// by a few tens of ms on Windows; retrying briefly is the established
// pattern in this codebase for exactly this transient class, not a
// papered-over flake.
const WINDOWS_FS_RETRY_DELAYS_MS = [20, 40, 80, 160, 320]

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

function withWindowsFsRetry(fn) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return fn()
    } catch (error) {
      const retryable = error.code === 'EPERM' || error.code === 'EACCES' || error.code === 'EBUSY'
      if (process.platform !== 'win32' || !retryable || attempt >= WINDOWS_FS_RETRY_DELAYS_MS.length) {
        throw error
      }
      sleepSync(WINDOWS_FS_RETRY_DELAYS_MS[attempt])
    }
  }
}

function manifestPath(quarantineRoot, quarantineId) {
  return path.join(quarantineRoot, quarantineId, 'manifest.json')
}

function writeManifest(quarantineRoot, manifest) {
  const dir = path.join(quarantineRoot, manifest.quarantineId)
  mkdirSync(dir, { recursive: true })
  writeFileSync(manifestPath(quarantineRoot, manifest.quarantineId), JSON.stringify(manifest, null, 2), 'utf8')
}

export function readQuarantineManifest(quarantineRoot, quarantineId) {
  try {
    return JSON.parse(readFileSync(manifestPath(quarantineRoot, quarantineId), 'utf8'))
  } catch {
    return null
  }
}

// Same-volume rename first (atomic); EXDEV (cross-device) falls back to a
// verified copy-then-delete. Returns { ok, movedByRename } -- callers use
// `ok` for success and never need to know which strategy ran.
function moveDirOrFile(source, destination) {
  try {
    withWindowsFsRetry(() => renameSync(source, destination))
    return { ok: true, movedByRename: true }
  } catch (error) {
    if (error.code !== 'EXDEV') {
      throw error
    }
    cpSync(source, destination, { recursive: true, errorOnExist: false })
    verifyCopyIntegrity(source, destination)
    withWindowsFsRetry(() => rmSync(source, { recursive: true, force: true }))
    return { ok: true, movedByRename: false }
  }
}

// Cheap, real integrity check: recursive file count + total byte size must
// match between source and destination before the source is ever deleted.
// Not a hash (would be expensive for a large worktree copy) but catches a
// truncated/partial cpSync, which is the failure mode that matters here.
function directorySignature(targetPath) {
  const stat = statSync(targetPath)
  if (!stat.isDirectory()) {
    return { files: 1, bytes: stat.size }
  }
  let files = 0
  let bytes = 0
  const stack = [targetPath]
  while (stack.length) {
    const current = stack.pop()
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) {
        stack.push(full)
      } else {
        files += 1
        bytes += statSync(full).size
      }
    }
  }
  return { files, bytes }
}

function verifyCopyIntegrity(source, destination) {
  const a = directorySignature(source)
  const b = directorySignature(destination)
  if (a.files !== b.files || a.bytes !== b.bytes) {
    const error = new Error(`quarantine copy integrity check failed: source ${JSON.stringify(a)} vs destination ${JSON.stringify(b)}`)
    error.code = 'TSF_CLEANUP_QUARANTINE_COPY_INTEGRITY_FAILED'
    throw error
  }
}

// mode 'MOVE': the artifact leaves its original location for good (used by
// QUARANTINE_ARTIFACT). mode 'COPY': a safety copy is made but the
// original is deliberately left in place (used by REMOVE_DISPOSABLE_
// WORKTREE, whose next real step -- `git worktree remove` -- is what
// actually deletes the original; git, not this function, owns that step).
export function moveToQuarantine({ requestId, actionClass, originalPath, mode = 'MOVE' }, { quarantineRoot = defaultQuarantineRoot(), clock } = {}) {
  if (!existsSync(originalPath)) {
    const error = new Error(`cannot quarantine: path does not exist: ${originalPath}`)
    error.code = 'TSF_CLEANUP_QUARANTINE_SOURCE_MISSING'
    throw error
  }
  const quarantineId = randomUUID()
  const kind = statSync(originalPath).isDirectory() ? 'DIRECTORY' : 'FILE'
  const quarantinedPath = path.join(quarantineRoot, quarantineId, path.basename(originalPath))
  const baseManifest = {
    schemaVersion: 'TSF_CLEANUP_QUARANTINE_MANIFEST_V1',
    quarantineId,
    requestId,
    actionClass,
    mode,
    kind,
    originalPath,
    quarantinedPath,
    quarantinedAt: null,
    status: 'QUARANTINE_IN_PROGRESS'
  }
  writeManifest(quarantineRoot, baseManifest) // written BEFORE the risky step, on purpose
  mkdirSync(path.dirname(quarantinedPath), { recursive: true })

  if (mode === 'COPY') {
    cpSync(originalPath, quarantinedPath, { recursive: true })
    verifyCopyIntegrity(originalPath, quarantinedPath)
    const manifest = { ...baseManifest, quarantinedAt: isoNow(clock), status: 'COPIED_ORIGINAL_STILL_PRESENT' }
    writeManifest(quarantineRoot, manifest)
    return manifest
  }

  moveDirOrFile(originalPath, quarantinedPath)
  const manifest = { ...baseManifest, quarantinedAt: isoNow(clock), status: 'QUARANTINED' }
  writeManifest(quarantineRoot, manifest)
  return manifest
}

// Idempotent: a manifest already RESTORED returns the same success outcome
// rather than erroring on a repeat call. Fails closed (never overwrites) if
// something already occupies the destination.
export function restoreFromQuarantine(quarantineId, destinationPath, { quarantineRoot = defaultQuarantineRoot(), clock } = {}) {
  const manifest = readQuarantineManifest(quarantineRoot, quarantineId)
  if (!manifest) {
    const error = new Error(`no quarantine manifest found for ${quarantineId}`)
    error.code = 'TSF_CLEANUP_QUARANTINE_NOT_FOUND'
    throw error
  }
  if (manifest.status === 'RESTORED') {
    return { ok: true, alreadyRestored: true, restoredPath: manifest.restoredPath }
  }
  if (manifest.status !== 'QUARANTINED' && manifest.status !== 'COPIED_ORIGINAL_STILL_PRESENT') {
    const error = new Error(`cannot restore quarantine in status ${manifest.status}`)
    error.code = 'TSF_CLEANUP_QUARANTINE_NOT_RESTORABLE'
    throw error
  }
  if (existsSync(destinationPath)) {
    const error = new Error(`restore destination already exists: ${destinationPath} -- refusing to overwrite`)
    error.code = 'TSF_CLEANUP_RESTORE_DESTINATION_CONFLICT'
    throw error
  }
  moveDirOrFile(manifest.quarantinedPath, destinationPath)
  const updated = { ...manifest, status: 'RESTORED', restoredPath: destinationPath, restoredAt: isoNow(clock) }
  writeManifest(quarantineRoot, updated)
  return { ok: true, alreadyRestored: false, restoredPath: destinationPath }
}

// Inspects a manifest left in a non-terminal status against REAL filesystem
// state and reaches a coherent conclusion -- never guesses. Called both
// explicitly (a recovery tool) and automatically at the start of any new
// action against the same requestId (server/cleanup-executor.mjs).
export function recoverIncompleteQuarantine(quarantineId, { quarantineRoot = defaultQuarantineRoot() } = {}) {
  const manifest = readQuarantineManifest(quarantineRoot, quarantineId)
  if (!manifest) {
    return { status: 'NO_MANIFEST', requiresOwnerReview: false }
  }
  if (manifest.status !== 'QUARANTINE_IN_PROGRESS') {
    return { status: manifest.status, requiresOwnerReview: false }
  }
  const quarantinedExists = existsSync(manifest.quarantinedPath)
  const originalExists = existsSync(manifest.originalPath)
  if (quarantinedExists && !originalExists) {
    // The move completed but the manifest update after it did not persist
    // (crash between the two writes) -- filesystem state is already
    // correct; just reconcile the manifest.
    writeManifest(quarantineRoot, { ...manifest, status: 'QUARANTINED' })
    return { status: 'RECONCILED_TO_QUARANTINED', requiresOwnerReview: false }
  }
  if (!quarantinedExists && originalExists) {
    // Nothing was actually moved yet -- safe to say the quarantine attempt
    // never really started; the caller can retry moveToQuarantine cleanly.
    writeManifest(quarantineRoot, { ...manifest, status: 'FAILED_NEVER_STARTED' })
    return { status: 'FAILED_NEVER_STARTED', requiresOwnerReview: false }
  }
  if (quarantinedExists && originalExists) {
    // Copy step (or a partial rename fallback) finished but the original
    // removal did not -- data is safe in both places, nothing lost, but
    // this needs an explicit decision, not an automatic guess at intent.
    writeManifest(quarantineRoot, { ...manifest, status: 'QUARANTINE_SOURCE_STILL_PRESENT' })
    return { status: 'QUARANTINE_SOURCE_STILL_PRESENT', requiresOwnerReview: true }
  }
  // Neither path exists -- genuinely ambiguous; do not fabricate a
  // conclusion.
  writeManifest(quarantineRoot, { ...manifest, status: 'INCONSISTENT_REQUIRES_OWNER_REVIEW' })
  return { status: 'INCONSISTENT_REQUIRES_OWNER_REVIEW', requiresOwnerReview: true }
}

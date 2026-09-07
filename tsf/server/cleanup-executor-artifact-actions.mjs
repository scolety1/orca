// Real mutating implementations for the artifact/cache/temp-state action
// classes. Same { steps, result } / throw-with-code contract as
// cleanup-executor-worktree-actions.mjs.
import { existsSync, rmSync, statSync } from 'node:fs'
import path from 'node:path'
import { moveToQuarantine, restoreFromQuarantine } from './cleanup-quarantine-store.mjs'

export async function executeQuarantineArtifact(resolvedRealPath, { requestId }, { clock } = {}) {
  const manifest = moveToQuarantine(
    { requestId, actionClass: 'QUARANTINE_ARTIFACT', originalPath: resolvedRealPath, mode: 'MOVE' },
    { clock }
  )
  return {
    steps: [{ name: 'QUARANTINE_MOVE', status: 'COMPLETED', detail: { quarantineId: manifest.quarantineId } }],
    result: { quarantineId: manifest.quarantineId }
  }
}

export async function executeRestoreQuarantine(resolvedRealPath, { quarantineId, destinationPath }, { clock } = {}) {
  if (!quarantineId) {
    const error = new Error('RESTORE_QUARANTINE requires quarantineId')
    error.code = 'TSF_CLEANUP_MISSING_QUARANTINE_ID'
    throw error
  }
  const outcome = restoreFromQuarantine(quarantineId, destinationPath ?? resolvedRealPath, { clock })
  return {
    steps: [{ name: 'QUARANTINE_RESTORE', status: 'COMPLETED', detail: outcome }],
    result: outcome
  }
}

// Only an exact-name allowlisted, always-regenerable cache directory can be
// targeted -- the caller supplies the exact directory PATH (already run
// through protected-path revalidation) but this function independently
// re-checks the basename against the allowlist itself, so a caller cannot
// widen what "safe cache" means just by asserting it.
const ALLOWLISTED_CACHE_DIR_NAMES = Object.freeze(['.cache', '.turbo', '.parcel-cache', '.eslintcache', '.vite'])

export async function executeClearSafeGeneratedCache(resolvedRealPath) {
  const name = path.basename(resolvedRealPath)
  if (!ALLOWLISTED_CACHE_DIR_NAMES.includes(name)) {
    const error = new Error(`refusing to clear non-allowlisted cache directory name: ${name}`)
    error.code = 'TSF_CLEANUP_CACHE_NAME_NOT_ALLOWLISTED'
    throw error
  }
  if (!existsSync(resolvedRealPath)) {
    return { steps: [{ name: 'CACHE_ALREADY_ABSENT', status: 'COMPLETED' }], result: { alreadyAbsent: true } }
  }
  rmSync(resolvedRealPath, { recursive: true, force: true })
  return { steps: [{ name: 'CACHE_DELETE', status: 'COMPLETED' }], result: { deletedPath: resolvedRealPath } }
}

// Only a path whose basename matches a known temp-state pattern, AND is
// older than `olderThanMs`, is eligible -- bounds this from becoming
// arbitrary filesystem deletion (that is its own separate, NOT_IMPLEMENTED_
// V0 ELEVATED class).
const STALE_TEMP_STATE_PATTERN = /(^|[-_.])(tmp|temp)([-_.]|$)/i

export async function executeRemoveStaleTemporaryState(resolvedRealPath, { olderThanMs = 24 * 60 * 60 * 1000 } = {}) {
  const name = path.basename(resolvedRealPath)
  if (!STALE_TEMP_STATE_PATTERN.test(name)) {
    const error = new Error(`refusing: ${name} does not match the allowlisted temp-state naming pattern`)
    error.code = 'TSF_CLEANUP_NOT_TEMP_STATE_SHAPED'
    throw error
  }
  if (!existsSync(resolvedRealPath)) {
    return { steps: [{ name: 'TEMP_STATE_ALREADY_ABSENT', status: 'COMPLETED' }], result: { alreadyAbsent: true } }
  }
  const stat = statSync(resolvedRealPath)
  const ageMs = Date.now() - stat.mtimeMs
  if (ageMs < olderThanMs) {
    const error = new Error(`refusing: ${name} is only ${ageMs}ms old, below the ${olderThanMs}ms staleness threshold`)
    error.code = 'TSF_CLEANUP_NOT_STALE_ENOUGH'
    throw error
  }
  rmSync(resolvedRealPath, { recursive: true, force: true })
  return { steps: [{ name: 'TEMP_STATE_DELETE', status: 'COMPLETED' }], result: { deletedPath: resolvedRealPath, ageMs } }
}

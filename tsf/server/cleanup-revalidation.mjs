// Fresh, real, immediate pre-mutation revalidation. NEVER trusts anything
// carried from an earlier RECOMMENDATION/PLAN -- every field here is
// re-collected from the live filesystem/git/durable-store state right now,
// which is what makes the "race between audit and execution" test
// meaningful: a state change that happened after the plan was built is
// only caught because this function re-reads reality instead of reusing
// the plan's snapshot. Composes into the exact SafetyContext shape
// domain/cleanup-safety-blockers.mjs's evaluateCleanupBlockers consumes.
import { closeSync, existsSync, openSync } from 'node:fs'
import { isoNow } from '../domain/canonical.mjs'
import { isProtectedBranch, isProtectedPath, mergeProtectedRegistry } from '../domain/cleanup-protected-registry.mjs'
import { resolveCanonicalPath } from './resource-auditor-path-identity.mjs'
import { isWorktreeClean } from './cleanup-git-worktree-inventory.mjs'
import { checkActiveMissionReference } from './cleanup-active-mission-check.mjs'
import { defaultProtectedRegistry } from './cleanup-protected-registry-defaults.mjs'

// Real, best-effort Windows/POSIX file-handle-lock probe: opening an
// already-open-elsewhere file for read+write fails with EBUSY/EPERM/EACCES
// on the platforms this program targets. Never a guess -- absence of a
// throw means genuinely openable right now (still re-checked again by the
// eventual mutating call itself, which is the real, final word).
export function probeFileLock(filePath) {
  if (!existsSync(filePath)) {
    return false
  }
  try {
    const fd = openSync(filePath, 'r+')
    closeSync(fd)
    return false
  } catch (error) {
    if (error.code === 'EBUSY' || error.code === 'EPERM' || error.code === 'EACCES') {
      return true
    }
    if (error.code === 'EISDIR') {
      return false // a directory -- not a single-handle file lock concern here
    }
    return null // genuinely unverifiable (unexpected error) -- fail closed via UNKNOWN, never false
  }
}

// `checkGit`/`checkFileLock` are booleans the caller sets per action class
// (e.g. worktree-removal checks git cleanliness; a plain artifact quarantine
// checks the file lock instead) -- a field is only included in the returned
// context when relevant, matching the optional-field convention
// classifyWorkspaceResource/evaluateCleanupBlockers already use ("absent
// means not checked for this resource, not unknown").
export async function collectFreshSafetyContext(
  { targetIdentity, checkGit = false, checkFileLock = false, sessionLive, callerProtectedRegistry },
  clock
) {
  const realPath = (await resolveCanonicalPath(targetIdentity.realPath)) ?? targetIdentity.realPath
  const registry = mergeProtectedRegistry(defaultProtectedRegistry(), callerProtectedRegistry)

  const context = {
    evidenceObservedAt: isoNow(clock),
    protectedPath: isProtectedPath(realPath, registry),
    protectedBranch: isProtectedBranch(targetIdentity.branch, registry)
  }

  if (targetIdentity.isMainWorktree !== undefined) {
    context.isMainWorktree = targetIdentity.isMainWorktree
  }

  const activeMission = checkActiveMissionReference({
    branch: targetIdentity.branch,
    worktreePath: realPath
  })
  context.activeMissionReferenced = activeMission.referenced
  context.referencingMissions = activeMission.referencingMissions

  if (checkGit) {
    context.git = { clean: await isWorktreeClean(realPath) }
  }

  if (sessionLive !== undefined) {
    context.sessionLive = sessionLive
  }

  if (checkFileLock) {
    context.fileLocked = probeFileLock(realPath)
  }

  return { context, resolvedRealPath: realPath }
}

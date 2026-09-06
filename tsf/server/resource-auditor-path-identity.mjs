// Real, read-only Windows path-identity resolution for the Resource
// Auditor. This IS possible without any Orca-core change: Node's
// `fs.realpath` natively follows symlinks AND Windows junctions/reparse
// points (via GetFinalPathNameByHandle), so a junction alias resolves to
// its true target here, not just a documented gap. Never throws -- every
// function returns null (unknown) on any resolution failure, matching this
// codebase's honest-failure convention; a failed resolution must reach the
// classifier as UNKNOWN, never as a silently-accepted match.
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const exec = promisify(execFile)
const GIT_TIMEOUT_MS = 10000

function normalize(value) {
  return String(value).replaceAll('\\', '/').replace(/\/+$/, '')
}

// The canonical, OS-resolved real path for `candidatePath` -- follows
// symlinks and (on Windows) junctions/reparse points to their true target.
// Returns null if the path does not exist or cannot be resolved (permission
// error, dangling reparse point, etc.) -- callers must treat null as
// unknown, never as "no alias, use the literal path".
export async function resolveCanonicalPath(candidatePath) {
  if (!candidatePath) {
    return null
  }
  try {
    const real = await fs.realpath(candidatePath)
    return normalize(real)
  } catch {
    return null
  }
}

// Verifies a candidate path's real identity against an expected path,
// case-insensitively on Windows. Every output field defaults to null
// (unknown) on any resolution failure -- never defaults to "matches".
export async function verifyWorkspacePathIdentity(candidatePath, expectedPath) {
  const [candidateReal, expectedReal] = await Promise.all([
    resolveCanonicalPath(candidatePath),
    resolveCanonicalPath(expectedPath)
  ])
  if (candidateReal === null || expectedReal === null) {
    return {
      matchesExpected: null,
      resolvedPath: candidateReal,
      expectedResolvedPath: expectedReal,
      reason: candidateReal === null ? 'CANDIDATE_PATH_UNRESOLVABLE' : 'EXPECTED_PATH_UNRESOLVABLE'
    }
  }
  const caseInsensitive = process.platform === 'win32'
  const matches = caseInsensitive
    ? candidateReal.toLowerCase() === expectedReal.toLowerCase()
    : candidateReal === expectedReal
  return {
    matchesExpected: matches,
    resolvedPath: candidateReal,
    expectedResolvedPath: expectedReal,
    reason: null
  }
}

// Real, read-only `git rev-parse --git-common-dir` -- the shared .git
// directory identity for a worktree. Two worktrees sharing the same common
// dir belong to the same repository; a mismatch against an expected common
// dir is a genuine unexpected-root signal, not a cosmetic difference.
export async function resolveGitCommonDir(worktreePath) {
  if (!worktreePath) {
    return null
  }
  try {
    const { stdout } = await exec(
      'git',
      [
        '-c',
        `safe.directory=${normalize(worktreePath)}`,
        '-C',
        worktreePath,
        'rev-parse',
        '--git-common-dir'
      ],
      { timeout: GIT_TIMEOUT_MS, windowsHide: true, maxBuffer: 1024 * 1024, encoding: 'utf8' }
    )
    const resolved = await resolveCanonicalPath(path.resolve(worktreePath, stdout.trim()))
    return resolved
  } catch {
    return null
  }
}

// Composes the full pathIdentity evidence block classifyWorkspaceResource
// expects: real-path identity, real-path containment against a registered-
// worktree list, and (when an expected common dir is supplied) real
// git-common-dir identity. Every sub-check independently defaults to null
// (unknown) on its own failure -- one failed check never masks another.
export async function collectPathIdentityEvidence(
  { candidatePath, expectedPath, registeredWorktreePaths = [], expectedGitCommonDir = undefined },
  clock
) {
  const observedAt = (clock ? clock() : new Date()).toISOString()
  const identity = await verifyWorkspacePathIdentity(candidatePath, expectedPath ?? candidatePath)

  let containsOtherRegisteredWorktree = null
  if (
    identity.resolvedPath &&
    Array.isArray(registeredWorktreePaths) &&
    registeredWorktreePaths.length > 0
  ) {
    const others = await Promise.all(registeredWorktreePaths.map((p) => resolveCanonicalPath(p)))
    const known = others.filter((p) => p !== null)
    if (known.length > 0) {
      const candidateKey = identity.resolvedPath.toLowerCase()
      containsOtherRegisteredWorktree = known.some((other) => {
        const otherKey = other.toLowerCase()
        return otherKey !== candidateKey && otherKey.startsWith(`${candidateKey}/`)
      })
    }
  }

  const result = {
    expectedPath: identity.expectedResolvedPath ?? expectedPath ?? null,
    resolvedPath: identity.resolvedPath ?? null,
    matchesExpected: identity.matchesExpected,
    containsOtherRegisteredWorktree,
    observedAt,
    unresolvedReason: identity.reason
  }

  if (expectedGitCommonDir !== undefined) {
    const observedGitCommonDir = await resolveGitCommonDir(candidatePath)
    const expectedResolved = await resolveCanonicalPath(expectedGitCommonDir)
    result.observedGitCommonDir = observedGitCommonDir
    result.gitCommonDirMatches =
      observedGitCommonDir === null || expectedResolved === null
        ? null
        : observedGitCommonDir.toLowerCase() === expectedResolved.toLowerCase()
  }

  return result
}

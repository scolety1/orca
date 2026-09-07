// Explicit protected-path/branch denylist -- "protection is an allowlisted
// mechanism, not a hope" (Phase 4 spec). Pure string/path logic only; no I/O.
// mergeProtectedRegistry is ADDITIVE-ONLY (defaults can never be removed by
// a caller-supplied registry -- see server/cleanup-protected-registry-
// defaults.mjs, which seeds real-world defaults the server always merges
// in, tests never able to weaken).
export const CANONICAL_PROTECTED_BRANCH_NAMES = Object.freeze(['main', 'master', 'tsf/main'])

function normalize(value) {
  return String(value ?? '').replaceAll('\\', '/').replace(/\/+$/, '')
}

export function isCanonicalProtectedBranch(branchName) {
  if (!branchName) {
    return false
  }
  return CANONICAL_PROTECTED_BRANCH_NAMES.includes(String(branchName))
}

export function emptyProtectedRegistry() {
  return { paths: [], branches: [] }
}

// Additive merge -- never drops an entry either side already had. Case
// preserved as supplied; comparison is case-insensitive on win32 at
// match-time (isProtectedPath below), not at merge-time.
export function mergeProtectedRegistry(a, b) {
  const paths = new Set([...(a?.paths ?? []), ...(b?.paths ?? [])])
  const branches = new Set([...(a?.branches ?? []), ...(b?.branches ?? [])])
  return { paths: [...paths], branches: [...branches] }
}

// True if `realPath` IS, or is nested under, any registered protected path.
// `realPath` must already be the OS-resolved real path (server's job, via
// resource-auditor-path-identity.mjs's resolveCanonicalPath) so a junction/
// case alias cannot dodge this check -- and (Phase 14 security finding)
// `registry.paths` must ALSO already be OS-resolved by the same caller
// (server/cleanup-revalidation.mjs's canonicalizeRegistryPaths) before
// reaching here: this function only does the cheap string normalize()
// below, which cannot see through a registry entry that is itself a
// junction/symlink/short-name alias of the real protected directory. A
// caller that skips that resolution silently under-protects.
export function isProtectedPath(realPath, registry, { caseInsensitiveFs = process.platform === 'win32' } = {}) {
  if (!realPath || !Array.isArray(registry?.paths) || registry.paths.length === 0) {
    return false
  }
  const candidate = normalize(realPath)
  const candidateKey = caseInsensitiveFs ? candidate.toLowerCase() : candidate
  return registry.paths.some((entry) => {
    const entryNormalized = normalize(entry)
    const entryKey = caseInsensitiveFs ? entryNormalized.toLowerCase() : entryNormalized
    return candidateKey === entryKey || candidateKey.startsWith(`${entryKey}/`)
  })
}

export function isProtectedBranch(branchName, registry) {
  if (isCanonicalProtectedBranch(branchName)) {
    return true
  }
  if (!branchName || !Array.isArray(registry?.branches)) {
    return false
  }
  return registry.branches.includes(String(branchName))
}

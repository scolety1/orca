// Real-world default protected paths for THIS program's own explicit
// authorization-scope boundary (never touch C:\TSF_ORCA, the dataset-
// research-engine-v0 worktree, or anything under C:\NWR /
// C:\NWR_HISTORICAL_DATA). These are ADDITIVE defaults --
// domain/cleanup-protected-registry.mjs's mergeProtectedRegistry can only
// grow a registry, never shrink one, so no caller-supplied registry can
// remove these. `env` is injected (default process.env) purely so tests can
// prove the merge behavior without depending on this exact machine's real
// paths existing.
export function defaultProtectedPaths(env = process.env) {
  const paths = ['C:\\TSF_ORCA', 'C:\\NWR', 'C:\\NWR_HISTORICAL_DATA']
  // TSF_CLEANUP_EXTRA_PROTECTED_PATHS: ';'-separated additional real paths
  // an owner wants defense-in-depth protection for, without a code change.
  const extra = String(env?.TSF_CLEANUP_EXTRA_PROTECTED_PATHS ?? '')
    .split(';')
    .map((p) => p.trim())
    .filter(Boolean)
  return [...paths, ...extra]
}

export function defaultProtectedRegistry(env = process.env) {
  return { paths: defaultProtectedPaths(env), branches: [] }
}

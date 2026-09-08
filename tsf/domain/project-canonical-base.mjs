// Fleet Dispatch Readiness + Explicit Command Adoption V1, Part C: generic
// canonical base-ref resolution. Pure decision function -- no I/O. Reused by
// two callers: chat-dispatch-bridge.mjs's ensureWorktreeForDispatch (a real
// `--base-branch` for the general dispatch path, closing "Could not resolve
// a default base ref") and command-adoption-execution.mjs (the branch a real
// adoption merge lands on).
//
// Never a lexical/recency guess among work/*-style branches -- explicitly
// forbidden by this mission. An operator's own explicit designation always
// wins; otherwise only a real, confirmed main/master default is trusted;
// anything else fails closed and honest.
export function resolveCanonicalBaseRef({ explicitConfiguredRef, repoDefaultBranch, repoHasStandardDefault }) {
  if (explicitConfiguredRef) {
    return { resolved: true, ref: explicitConfiguredRef, source: 'EXPLICIT_CONFIGURED' }
  }
  if (repoHasStandardDefault && (repoDefaultBranch === 'main' || repoDefaultBranch === 'master')) {
    return { resolved: true, ref: repoDefaultBranch, source: 'REPO_STANDARD_DEFAULT' }
  }
  return {
    resolved: false,
    reason: 'NO_RESOLVABLE_CANONICAL_BASE',
    detail:
      'no explicit canonical base is configured for this project and the repository has no standard main/master default -- refusing to guess among other branches'
  }
}

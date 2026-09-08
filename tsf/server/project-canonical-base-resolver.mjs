// Fleet Dispatch Readiness + Explicit Command Adoption V1, Part C: the real
// server-layer resolver -- composes the durable explicit-config store, a
// real git probe of the repo, and the pure domain decision function. This is
// what closes "Could not resolve a default base ref": every general (non-
// self-repair) dispatch/adoption caller resolves a real base ref through
// here BEFORE calling Orca's own --base-branch-consuming CLI, instead of
// letting `fromBranch: undefined` reach an opaque CLI failure.
import { resolveCanonicalBaseRef } from '../domain/project-canonical-base.mjs'
import { readProjectCanonicalBase } from './project-canonical-base-store.mjs'
import { branchExistsLocally, detectRepoDefaultBranch } from './repository-identity.mjs'

// `project` needs only { id, root }. Never throws -- every failure mode
// (repo unreachable, git probe fails, no resolvable base, a stale
// configured base) returns an honest { resolved: false, ... } shape, same
// convention as every other gate in this codebase.
export async function resolveProjectCanonicalBase(project, deps = {}) {
  const readExplicit = deps.readProjectCanonicalBase ?? readProjectCanonicalBase
  const checkExists = deps.branchExistsLocally ?? branchExistsLocally

  const explicit = readExplicit(project.id)
  // An operator's own explicit designation always wins (highest priority)
  // -- but it is not blindly trusted: a stale config (points at a branch
  // that no longer exists locally) fails closed and honest here rather
  // than being handed to Orca's CLI as a `--base-branch` that would itself
  // fail opaquely, and never silently falls through to a guessed repo
  // default instead.
  if (explicit?.ref) {
    const existence = await checkExists(project.root, explicit.ref)
    if (!existence.ok) {
      return { resolved: false, reason: 'CANONICAL_BASE_PROBE_FAILED', detail: existence.detail }
    }
    if (!existence.exists) {
      return {
        resolved: false,
        reason: 'STALE_CONFIGURED_CANONICAL_BASE',
        detail: `the configured canonical base "${explicit.ref}" (set by ${explicit.setBy}) no longer exists as a local branch in this repository -- refusing to silently fall back to a guessed default`
      }
    }
    return { resolved: true, ref: explicit.ref, source: 'EXPLICIT_CONFIGURED' }
  }

  const detectDefault = deps.detectRepoDefaultBranch ?? detectRepoDefaultBranch
  const probe = await detectDefault(project.root)
  if (!probe.ok) {
    return { resolved: false, reason: 'CANONICAL_BASE_PROBE_FAILED', detail: probe.detail }
  }
  return resolveCanonicalBaseRef({
    explicitConfiguredRef: null,
    repoDefaultBranch: probe.defaultBranch,
    repoHasStandardDefault: probe.hasStandardDefault
  })
}

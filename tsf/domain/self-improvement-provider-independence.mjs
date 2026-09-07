// Native Self-Improvement Loop V1, Phase 5: the REAL runtime enforcement of
// VERIFIER_INDEPENDENT's mustDifferFromWorkerWhenAvailable flag
// (provider-role-mappings.v1.json). ZERO_RELAY_PLANNER_WORKER_ARCHITECTURE.md
// (Phase 6 of its own proposed sequencing) explicitly names this as an
// unfixed gap: the flag is today checked only by a static regression eval
// (routing-eval-runner.mjs's verifierDiffersFromWorker), never live. This
// module is the live version: given the worker's ACTUAL resolved provider,
// resolve VERIFIER_INDEPENDENT and, if it collides with the worker's
// provider and a genuinely different fallback profile exists, resolve the
// fallback instead -- never silently accept a same-provider "independent"
// verifier when a real alternative was available. Pure: takes resolveRole
// and the same mappings/profiles resolveRole already reads, does no I/O.
export function resolveIndependentVerifierRole({ resolveRole, mappings, profiles, workerProviderId }) {
  const primary = resolveRole({ role: 'VERIFIER_INDEPENDENT', mappings, profiles })
  const mustDiffer = mappings.roles.VERIFIER_INDEPENDENT?.mustDifferFromWorkerWhenAvailable === true
  if (!mustDiffer || primary.requested.providerId !== workerProviderId) {
    return { resolution: primary, divergent: primary.requested.providerId !== workerProviderId, usedFallback: false, requiredIndependence: mustDiffer }
  }
  // Collision: the preferred verifier profile happens to share the
  // worker's provider. Only a genuinely different fallback profile fixes
  // this -- a fallback that ALSO resolves to the same provider is not a
  // real alternative and is reported honestly as still non-divergent
  // rather than fabricating independence.
  const fallbackProfileId = primary.fallbackProfile
  const fallbackProfile = fallbackProfileId ? profiles.profiles[fallbackProfileId] : null
  if (!fallbackProfile || fallbackProfile.providerId === workerProviderId) {
    return { resolution: primary, divergent: false, usedFallback: false, requiredIndependence: true }
  }
  const fallbackResolution = {
    ...primary,
    requested: {
      profileId: fallbackProfileId,
      providerId: fallbackProfile.providerId,
      agentId: fallbackProfile.agentId,
      modelClass: primary.requested.modelClass,
      effortClass: primary.requested.effortClass
    },
    selectionAssurance: 'RECOMMENDED_ONLY'
  }
  return { resolution: fallbackResolution, divergent: true, usedFallback: true, requiredIndependence: true }
}

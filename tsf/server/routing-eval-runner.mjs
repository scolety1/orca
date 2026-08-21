// M9 wave 5: turns one ROUTING eval case into a real actual output by
// ACTUALLY calling routing.mjs's real resolveRole against the real,
// committed config -- never a fabricated resolution.
import { resolveRole } from '../domain/routing.mjs'
import providerRoles from '../routing/provider-role-mappings.v1.json' with { type: 'json' }
import launchProfiles from '../providers/launch-profiles.v1.json' with { type: 'json' }

const REAL_PROFILES = { profiles: launchProfiles.profiles }

// mappings/profiles default to the real, committed config -- overridable
// so a candidate (hypothetical, in-memory-only) routing config can be
// evaluated the exact same way, without ever writing to the real
// provider-role-mappings.v1.json/launch-profiles.v1.json files.
export function runRoutingEvalCase(
  evalCase,
  { mappings = providerRoles, profiles = REAL_PROFILES } = {}
) {
  const { input } = evalCase
  if (input.checkIndependence) {
    const verifier = resolveRole({ role: 'VERIFIER_INDEPENDENT', mappings, profiles })
    const worker = resolveRole({ role: 'WORKER_BALANCED', mappings, profiles })
    return {
      verifierDiffersFromWorker: verifier.requested.providerId !== worker.requested.providerId
    }
  }
  try {
    const resolution = resolveRole({ role: input.role, mappings, profiles })
    return { providerId: resolution.requested.providerId, threwOnUnknownRole: false }
  } catch (error) {
    // Distinguishes the real "unknown stable execution role" failure
    // (resolveRole's own message, see routing.mjs) from any other
    // resolveRole error (e.g. a role pointing at a missing launch
    // profile) -- a review finding: a bare catch here would mislabel
    // every resolveRole failure as threwOnUnknownRole, overpromising
    // specificity this field's name claims.
    return { threwOnUnknownRole: /unknown stable execution role/.test(error.message) }
  }
}

export function runRoutingEvalPack(pack, configOverride = {}) {
  const actualOutputsByCaseId = {}
  for (const evalCase of pack.cases) {
    actualOutputsByCaseId[evalCase.id] = runRoutingEvalCase(evalCase, configOverride)
  }
  return actualOutputsByCaseId
}

const ROLE_IDS = Object.freeze([
  'PLANNER_DEEP',
  'PLANNER_BALANCED',
  'WORKER_CHEAP',
  'WORKER_BALANCED',
  'WORKER_DEEP',
  'VERIFIER_INDEPENDENT'
])

export const TSF_EXECUTION_ROLES = ROLE_IDS

export function assertRoutingConfiguration(mappings, modes, profiles) {
  const configured = Object.keys(mappings.roles).sort()
  const expected = [...ROLE_IDS].sort()
  if (JSON.stringify(configured) !== JSON.stringify(expected)) {
    throw new Error('provider role registry does not define the complete stable role set')
  }
  for (const [mode, config] of Object.entries(modes.modes)) {
    for (const role of [config.plannerTier, config.workerTier]) {
      if (!mappings.roles[role]) throw new Error(`${mode} references unknown role ${role}`)
    }
  }
  for (const [role, config] of Object.entries(mappings.roles)) {
    if (!profiles.profiles[config.preferredProfile]) {
      throw new Error(`${role} references unknown profile ${config.preferredProfile}`)
    }
  }
  return true
}

export function resolveRole({ role, mappings, profiles, observed = null }) {
  const mapping = mappings.roles[role]
  if (!mapping) throw new Error(`unknown stable execution role: ${role}`)
  const preferred = profiles.profiles[mapping.preferredProfile]
  if (!preferred) throw new Error(`missing launch profile: ${mapping.preferredProfile}`)
  return {
    schemaVersion: 'TSF_ROLE_RESOLUTION_V1',
    role,
    requested: {
      profileId: mapping.preferredProfile,
      providerId: preferred.providerId,
      agentId: preferred.agentId,
      modelClass: mapping.modelClass,
      effortClass: mapping.effortClass
    },
    observed: observed ?? {
      providerId: null,
      agentId: null,
      model: null,
      effort: null,
      assurance: 'UNOBSERVED'
    },
    fallbackProfile: mapping.fallbackProfile,
    selectionAssurance: observed ? 'OBSERVED' : 'RECOMMENDED_ONLY'
  }
}

export function resolveUsageMode({ mode, mappings, modes, profiles }) {
  const config = modes.modes[mode]
  if (!config) throw new Error(`unknown usage mode: ${mode}`)
  return {
    schemaVersion: 'TSF_USAGE_MODE_RESOLUTION_V1',
    mode,
    policy: structuredClone(config),
    planner: resolveRole({ role: config.plannerTier, mappings, profiles }),
    worker: resolveRole({ role: config.workerTier, mappings, profiles }),
    verifier: resolveRole({ role: 'VERIFIER_INDEPENDENT', mappings, profiles })
  }
}

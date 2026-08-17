import { isoNow, sha256 } from './canonical.mjs'

export function createSessionBinding(input, clock) {
  for (const key of ['role', 'providerId', 'agentId', 'orcaSessionId']) {
    if (!input[key]) throw new Error(`session binding requires ${key}`)
  }
  const binding = {
    schemaVersion: 'TSF_SESSION_BINDING_V1',
    role: input.role,
    scope: input.scope ?? (input.role.startsWith('PLANNER_') ? 'PLANNING_EPISODE' : 'IMPLEMENTATION_MISSION'),
    providerId: input.providerId,
    agentId: input.agentId,
    modelClass: input.modelClass ?? null,
    modelObserved: input.modelObserved ?? null,
    orcaSessionId: input.orcaSessionId,
    providerConversationId: input.providerConversationId ?? null,
    worktreeId: input.worktreeId ?? null,
    createdAt: isoNow(clock)
  }
  return { ...binding, identity: sha256(binding) }
}

export function assertAffinity(binding, observed) {
  for (const key of ['providerId', 'agentId', 'orcaSessionId']) {
    if (binding[key] !== observed[key]) {
      const error = new Error(`session affinity changed inside ${binding.scope}: ${key}`)
      error.code = 'TSF_SESSION_AFFINITY_VIOLATION'
      throw error
    }
  }
  if (binding.worktreeId && binding.worktreeId !== observed.worktreeId) {
    const error = new Error('worker worktree changed inside implementation mission')
    error.code = 'TSF_SESSION_AFFINITY_VIOLATION'
    throw error
  }
  return true
}

export function replaceSessionBinding(oldBinding, nextInput, { boundary, reason, checkpointRef, unresolvedWork = [] }, clock) {
  const allowed = new Set(['MISSION_BOUNDARY', 'RECOVERY_CHECKPOINT', 'PROVIDER_FAILURE', 'EXPLICIT_ESCALATION', 'SAFETY_RECOVERY'])
  if (!allowed.has(boundary)) throw new Error(`invalid session replacement boundary: ${boundary}`)
  const newBinding = createSessionBinding({ ...nextInput, role: oldBinding.role, scope: oldBinding.scope }, clock)
  return {
    binding: newBinding,
    receipt: {
      schemaVersion: 'TSF_SESSION_REPLACEMENT_RECEIPT_V1',
      oldIdentity: oldBinding.identity,
      newIdentity: newBinding.identity,
      boundary,
      reason,
      checkpointRef: checkpointRef ?? null,
      unresolvedWork,
      timestamp: isoNow(clock)
    }
  }
}

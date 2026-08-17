import { projectOrcaRuntimeState } from '../domain/mission-state.mjs'

export function createOrcaDispatch({ planCapsule, roleResolution, sessionBinding, usageMode }) {
  if (planCapsule.repository.worktree !== sessionBinding.worktreeId && planCapsule.repository.worktree !== sessionBinding.worktreePath) {
    throw new Error('plan capsule worktree does not match the sticky worker session')
  }
  return {
    schemaVersion: 'TSF_ORCA_DISPATCH_V1',
    ownership: {
      commodityRuntime: 'ORCA',
      missionGovernance: 'TSF'
    },
    missionId: planCapsule.missionId,
    orca: {
      sessionId: sessionBinding.orcaSessionId,
      worktreeId: sessionBinding.worktreeId,
      agentId: roleResolution.requested.agentId,
      providerId: roleResolution.requested.providerId,
      modelClass: roleResolution.requested.modelClass,
      effortClass: roleResolution.requested.effortClass
    },
    usageMode,
    capsule: planCapsule
  }
}

export function mapOrcaFacts(facts) {
  return {
    tsfState: projectOrcaRuntimeState(facts),
    runtimeFacts: structuredClone(facts),
    ownership: 'ORCA_RUNTIME_FACTS_TSF_HIGH_LEVEL_PROJECTION'
  }
}

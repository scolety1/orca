import { projectOrcaRuntimeState } from '../domain/mission-state.mjs'
import { validateResultCapsule } from '../contracts/validate-capsules.mjs'

export function createOrcaDispatch({ planCapsule, roleResolution, sessionBinding, usageMode }) {
  if (
    planCapsule.repository.worktree !== sessionBinding.worktreeId &&
    planCapsule.repository.worktree !== sessionBinding.worktreePath
  ) {
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

function orchestrationRows(facts, listKey, rowsKey) {
  const source = facts?.[listKey]?.result ?? facts?.[listKey] ?? facts?.result ?? facts
  return Array.isArray(source?.[rowsKey]) ? source[rowsKey] : []
}

function parseJson(value) {
  if (typeof value !== 'string') {
    return value
  }
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

function projectResultCapsule(task) {
  const capsule = parseJson(task.result)
  try {
    validateResultCapsule(capsule)
    return structuredClone(capsule)
  } catch {
    // Raw Orca worker reports are not upgraded into TSF result capsules without required evidence.
    return null
  }
}

export function mapOrchestrationFacts(facts = {}) {
  const workers = orchestrationRows(facts, 'workerList', 'workers')
  const tasks = orchestrationRows(facts, 'taskList', 'tasks')
  const gates = orchestrationRows(facts, 'gateList', 'gates')
  return {
    workerHeartbeats: workers.map((worker) => ({
      dispatchId: worker.dispatchId,
      taskId: worker.taskId,
      // Current worker-list output exposes no real heartbeat or last-activity timestamp.
      lastHeartbeatAt: null
    })),
    resultCapsules: tasks.map(projectResultCapsule).filter((capsule) => capsule !== null),
    openGates: gates
      .filter((gate) => gate.status === 'pending')
      .map((gate) => ({
        id: gate.id,
        runId: gate.run_id,
        taskId: gate.task_id,
        question: gate.question,
        options: parseJson(gate.options),
        status: gate.status,
        createdAt: gate.created_at
      }))
  }
}

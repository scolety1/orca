import { deepClone, isoNow, sha256 } from './canonical.mjs'
import { transitionMission } from './mission-state.mjs'
import { validatePlanCapsule, validateResultCapsule } from '../contracts/validate-capsules.mjs'

export function setMissionPlan(mission, planCapsules, clock) {
  if (mission.state !== 'PLANNING') throw new Error('mission must be PLANNING before work decomposition')
  if (!Array.isArray(planCapsules) || planCapsules.length === 0) throw new Error('planner must create at least one bounded work item')
  for (const capsule of planCapsules) {
    validatePlanCapsule(capsule)
    if (capsule.projectId !== mission.projectId) throw new Error('work item project differs from mission project')
  }
  const next = deepClone(mission)
  next.workItems = planCapsules.map((capsule) => ({
    id: capsule.missionId,
    capsule,
    state: 'READY',
    resultId: null
  }))
  next.updatedAt = isoNow(clock)
  return transitionMission(next, 'READY', { reason: 'PLANNER_DECOMPOSITION_COMPLETE' }, clock)
}

export function startMissionWork(mission, clock) {
  const next = transitionMission(mission, 'ACTIVE', { reason: 'ORCA_DISPATCH_ACCEPTED' }, clock)
  next.workItems = next.workItems.map((item) => ({ ...item, state: 'ACTIVE' }))
  return next
}

export function registerWorkerResult(mission, result, clock) {
  validateResultCapsule(result)
  const itemIndex = mission.workItems.findIndex((item) => item.id === result.missionId)
  if (itemIndex === -1) throw new Error(`result is not bound to a planned work item: ${result.missionId}`)
  const digest = sha256(result)
  if (mission.results.some((entry) => entry.digest === digest)) return deepClone(mission)
  const next = deepClone(mission)
  next.results.push({ digest, capsule: result, admittedAt: isoNow(clock) })
  next.workItems[itemIndex].resultId = digest
  next.workItems[itemIndex].state = result.outcome === 'SUCCEEDED' ? 'COMPLETED' : result.outcome
  next.updatedAt = isoNow(clock)
  if (next.workItems.every((item) => item.state === 'COMPLETED')) {
    return transitionMission(next, 'REVIEW', { reason: 'ALL_WORKER_RESULTS_ADMITTED' }, clock)
  }
  if (['FAILED', 'BLOCKED'].includes(result.outcome)) {
    return transitionMission(next, 'BLOCKED', { reason: 'WORKER_RESULT_NOT_GREEN', evidence: [digest] }, clock)
  }
  return next
}

export function registerVerifierResult(mission, verifierResult, clock) {
  if (mission.state !== 'REVIEW') throw new Error('verifier result is only accepted during REVIEW')
  if (!['GREEN', 'YELLOW', 'RED'].includes(verifierResult.verdict)) throw new Error('invalid verifier verdict')
  if (!verifierResult.verifierIdentity?.orcaSessionId) throw new Error('verifier identity is required')
  const workerSessions = new Set(mission.results.map((entry) => entry.capsule.workerIdentity.orcaSessionId))
  if (workerSessions.has(verifierResult.verifierIdentity.orcaSessionId)) {
    throw new Error('independent verifier must not reuse an implementation session')
  }
  const next = deepClone(mission)
  next.verifierResults.push({ ...verifierResult, digest: sha256(verifierResult), admittedAt: isoNow(clock) })
  next.updatedAt = isoNow(clock)
  return verifierResult.verdict === 'GREEN'
    ? transitionMission(next, 'READY_FOR_ADOPTION', { reason: 'INDEPENDENT_VERIFIER_GREEN' }, clock)
    : transitionMission(next, 'BLOCKED', { reason: 'VERIFIER_NOT_GREEN' }, clock)
}

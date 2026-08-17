import { assertExpectedRevision, deepClone, isoNow } from './canonical.mjs'

export const TSF_MISSION_STATES = Object.freeze([
  'DRAFT',
  'PLANNING',
  'READY',
  'ACTIVE',
  'NEEDS_INPUT',
  'REVIEW',
  'READY_FOR_ADOPTION',
  'ADOPTED',
  'REJECTED',
  'PAUSED',
  'COMPLETED',
  'BLOCKED'
])

const ALLOWED = Object.freeze({
  DRAFT: ['PLANNING', 'PAUSED', 'REJECTED'],
  PLANNING: ['READY', 'NEEDS_INPUT', 'BLOCKED', 'PAUSED', 'REJECTED'],
  READY: ['ACTIVE', 'PAUSED', 'REJECTED'],
  ACTIVE: ['REVIEW', 'NEEDS_INPUT', 'BLOCKED', 'PAUSED'],
  NEEDS_INPUT: ['PLANNING', 'READY', 'ACTIVE', 'PAUSED', 'REJECTED'],
  REVIEW: ['READY_FOR_ADOPTION', 'ACTIVE', 'BLOCKED', 'REJECTED'],
  READY_FOR_ADOPTION: ['ADOPTED', 'ACTIVE', 'PAUSED', 'REJECTED'],
  ADOPTED: ['COMPLETED'],
  REJECTED: [],
  PAUSED: ['PLANNING', 'READY', 'ACTIVE', 'REJECTED'],
  COMPLETED: [],
  BLOCKED: ['PLANNING', 'ACTIVE', 'NEEDS_INPUT', 'PAUSED', 'REJECTED']
})

export function createMission({ id, projectId, objective, usageMode, plannerIdentity }, clock) {
  if (!id || !projectId || !objective) throw new Error('mission id, project id, and objective are required')
  const createdAt = isoNow(clock)
  return {
    schemaVersion: 'TSF_MISSION_V1',
    id,
    projectId,
    objective,
    usageMode,
    state: 'DRAFT',
    revision: 0,
    plannerIdentity: plannerIdentity ?? null,
    workItems: [],
    results: [],
    verifierResults: [],
    unresolvedQuestions: [],
    transitions: [{ from: null, to: 'DRAFT', reason: 'MISSION_CREATED', at: createdAt }],
    createdAt,
    updatedAt: createdAt
  }
}

export function transitionMission(mission, to, { reason, expectedRevision, evidence = [] } = {}, clock) {
  if (!TSF_MISSION_STATES.includes(to)) throw new Error(`unknown TSF mission state: ${to}`)
  assertExpectedRevision(mission, expectedRevision)
  if (!ALLOWED[mission.state]?.includes(to)) {
    const error = new Error(`invalid mission transition: ${mission.state} -> ${to}`)
    error.code = 'TSF_INVALID_MISSION_TRANSITION'
    throw error
  }
  const next = deepClone(mission)
  const at = isoNow(clock)
  next.transitions.push({ from: next.state, to, reason: reason ?? 'UNSPECIFIED', evidence, at })
  next.state = to
  next.revision += 1
  next.updatedAt = at
  return next
}

export function projectOrcaRuntimeState(facts) {
  if (!facts) return 'BLOCKED'
  if (facts.needsInput || facts.gate === 'NEEDS_INPUT') return 'NEEDS_INPUT'
  if (facts.paused || facts.state === 'paused') return 'PAUSED'
  if (facts.state === 'queued' || facts.state === 'ready') return 'READY'
  if (facts.state === 'running' || facts.agentState === 'running') return 'ACTIVE'
  if (facts.state === 'failed' || facts.exitCode > 0 || facts.providerAvailable === false) return 'BLOCKED'
  if (facts.state === 'completed' || facts.exitCode === 0) return 'REVIEW'
  return 'BLOCKED'
}

export function allowedMissionTransitions(state) {
  return [...(ALLOWED[state] ?? [])]
}

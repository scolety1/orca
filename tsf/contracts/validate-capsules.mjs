const SHA = /^[0-9a-f]{40}$/

function assertObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`)
}

function assertString(value, label) {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${label} must be a non-empty string`)
}

function assertArray(value, label) {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`)
}

export function validatePlanCapsule(value) {
  assertObject(value, 'plan capsule')
  if (value.schemaVersion !== 'TSF_PLAN_CAPSULE_V1') throw new Error('invalid plan capsule schemaVersion')
  for (const key of ['missionId', 'projectId', 'objective']) assertString(value[key], key)
  for (const key of ['decisions', 'allowedScope', 'constraints', 'prohibitedActions', 'relevantComponents', 'acceptanceCriteria', 'requiredTests', 'stopConditions']) assertArray(value[key], key)
  if (value.allowedScope.length === 0 || value.prohibitedActions.length === 0 || value.acceptanceCriteria.length === 0 || value.stopConditions.length === 0) {
    throw new Error('plan capsule safety and completion arrays may not be empty')
  }
  assertObject(value.repository, 'repository')
  for (const key of ['root', 'worktree', 'branch']) assertString(value.repository[key], `repository.${key}`)
  if (!SHA.test(value.repository.head) || !SHA.test(value.repository.tree)) throw new Error('repository head/tree must be 40-character lowercase Git hashes')
  if (value.expectedResultFormat !== 'TSF_RESULT_CAPSULE_V1') throw new Error('unexpected result contract')
  return true
}

export function validateResultCapsule(value) {
  assertObject(value, 'result capsule')
  if (value.schemaVersion !== 'TSF_RESULT_CAPSULE_V1') throw new Error('invalid result capsule schemaVersion')
  assertString(value.missionId, 'missionId')
  assertObject(value.workerIdentity, 'workerIdentity')
  for (const key of ['role', 'providerId', 'agentId', 'orcaSessionId', 'worktreeId']) assertString(value.workerIdentity[key], `workerIdentity.${key}`)
  if (!['SUCCEEDED', 'FAILED', 'BLOCKED', 'NEEDS_INPUT', 'PARTIAL'].includes(value.outcome)) throw new Error('invalid result outcome')
  assertObject(value.repository, 'repository')
  if (!SHA.test(value.repository.head) || !SHA.test(value.repository.tree)) throw new Error('result repository head/tree must be 40-character lowercase Git hashes')
  for (const key of ['filesChanged', 'testsRun', 'evidence', 'blockers', 'unresolvedQuestions']) assertArray(value[key], key)
  assertString(value.implementationSummary, 'implementationSummary')
  assertString(value.recommendedNextStep, 'recommendedNextStep')
  if (value.outcome === 'SUCCEEDED' && value.evidence.length === 0) throw new Error('successful result requires evidence')
  return true
}

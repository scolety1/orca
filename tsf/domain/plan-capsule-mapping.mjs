// M3: bridges a chat-triggered "bounded implementation plan" into the
// existing, already-designed TSF_PLAN_CAPSULE_V1 contract, and from there
// into Keep Going's candidateWorkItems shape -- so the chat dispatch bridge
// (chat-dispatch-bridge.mjs) never invents its own plan/work-item format.
//
// The LLM call (invokeLiveStructuredAnalysis, live-planner.mjs) is only ever
// asked to fill the "planning judgment" fields (see
// chat-work-plan-request.schema.v1.json) -- objective, decisions, scope,
// constraints, acceptance criteria, etc. It never supplies missionId,
// projectId, or the repository binding: a zero-tool model has no way to
// know the real exact HEAD/tree, and trusting it to guess would be exactly
// the kind of fabrication this whole program refuses elsewhere. Those
// identity/repository fields are always supplied by the caller from real,
// already-verified project state (buildPlanCapsule's `identity` argument).
import { validatePlanCapsule } from '../contracts/validate-capsules.mjs'

// The same forbidden-action vocabulary the authority gate (chat-
// responder.mjs's TIM_REQUIRED_PATTERNS) and M3's own design doc use.
// Always present in the merged capsule's prohibitedActions regardless of
// what the model returned -- a defense-in-depth floor, not a ceiling: the
// model may add more (e.g. project-specific prohibitions), it may never
// remove or replace this baseline.
export const MANDATORY_PROHIBITED_ACTIONS = Object.freeze([
  'adoption',
  'push/merge',
  'deploy/publication',
  'credentials',
  'money/paid services',
  'destructive operations',
  'major product-direction decisions'
])

// Merges a model-produced work-plan request (chat-work-plan-request.schema
// .v1.json-shaped) with caller-supplied, real identity/repository facts
// into a full TSF_PLAN_CAPSULE_V1 object, then validates it with the same
// validator the rest of the codebase already uses for this contract --
// never trusting the merge itself to have produced a legal capsule.
export function buildPlanCapsule(workPlanRequest, identity) {
  if (!identity?.missionId || !identity?.projectId || !identity?.repository) {
    throw new Error('buildPlanCapsule requires a real missionId, projectId, and repository binding')
  }
  const prohibitedActions = [
    ...new Set([...MANDATORY_PROHIBITED_ACTIONS, ...(workPlanRequest.prohibitedActions ?? [])])
  ]
  const capsule = {
    schemaVersion: 'TSF_PLAN_CAPSULE_V1',
    missionId: identity.missionId,
    projectId: identity.projectId,
    objective: workPlanRequest.objective,
    decisions: workPlanRequest.decisions ?? [],
    repository: identity.repository,
    allowedScope: workPlanRequest.allowedScope,
    constraints: workPlanRequest.constraints ?? [],
    prohibitedActions,
    relevantComponents: workPlanRequest.relevantComponents ?? [],
    acceptanceCriteria: workPlanRequest.acceptanceCriteria,
    requiredTests: workPlanRequest.requiredTests ?? [],
    stopConditions: workPlanRequest.stopConditions,
    expectedResultFormat: 'TSF_RESULT_CAPSULE_V1'
  }
  validatePlanCapsule(capsule)
  return capsule
}

// Maps a validated plan capsule into exactly one Keep Going
// candidateWorkItem (tsf/domain/keep-going.mjs's planWave/dispatchStep
// input shape). One capsule -> one bounded work item, matching the plan
// capsule's own "one mission" scope -- a caller wanting several independent
// work items calls this once per capsule, same as any other candidateWorkItems
// array the rest of M2 already accepts.
//
// `placement` must supply an explicit worktree or workerTerminal -- there is
// no safe default (the exact same invariant keep-going-dispatch-loop.mjs's
// hasExplicitPlacement/requireExplicitPlacement already enforce; this
// function does not silently default either, it just fails fast with the
// same honesty).
export function planCapsuleToCandidateWorkItem(planCapsule, placement) {
  if (!placement?.worktree && !placement?.workerTerminal) {
    const error = new Error(
      'planCapsuleToCandidateWorkItem requires an explicit worktree or workerTerminal -- there is no safe default'
    )
    error.code = 'TSF_MISSING_PLACEMENT'
    throw error
  }
  const specLines = [
    planCapsule.objective,
    ...(planCapsule.constraints.length
      ? [`Constraints: ${planCapsule.constraints.join('; ')}`]
      : []),
    ...(planCapsule.acceptanceCriteria.length
      ? [`Acceptance criteria: ${planCapsule.acceptanceCriteria.join('; ')}`]
      : []),
    `Do not: ${planCapsule.prohibitedActions.join('; ')}.`
  ]
  return {
    id: planCapsule.missionId,
    scope: planCapsule.allowedScope,
    spec: specLines.join('\n'),
    ...(placement.workerTerminal
      ? { workerTerminal: placement.workerTerminal }
      : { worktree: placement.worktree }),
    ...(placement.agent ? { agent: placement.agent } : {})
  }
}

import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildPlanCapsule,
  MANDATORY_PROHIBITED_ACTIONS,
  planCapsuleToCandidateWorkItem
} from '../domain/plan-capsule-mapping.mjs'

const REAL_SHA_A = 'a'.repeat(40)
const REAL_SHA_B = 'b'.repeat(40)

function identity(overrides = {}) {
  return {
    missionId: 'chat-mission-1',
    projectId: 'tsf-ui-capability-check',
    repository: {
      root: 'C:/repo',
      worktree: 'C:/repo',
      branch: 'main',
      head: REAL_SHA_A,
      tree: REAL_SHA_B
    },
    ...overrides
  }
}

function workPlanRequest(overrides = {}) {
  return {
    schemaVersion: 'TSF_CHAT_WORK_PLAN_REQUEST_V1',
    objective: 'Add a one-line doc note.',
    decisions: [],
    allowedScope: ['docs/x.md'],
    constraints: [],
    prohibitedActions: [],
    relevantComponents: [],
    acceptanceCriteria: ['docs/x.md contains the note'],
    requiredTests: [],
    stopConditions: ['if the file already contains conflicting content'],
    ...overrides
  }
}

test('buildPlanCapsule requires real identity -- it never fabricates missionId/projectId/repository', () => {
  assert.throws(() => buildPlanCapsule(workPlanRequest(), {}), /requires a real missionId/)
  assert.throws(
    () => buildPlanCapsule(workPlanRequest(), { missionId: 'm1' }),
    /requires a real missionId/
  )
})

test('buildPlanCapsule produces a capsule that passes the shared validator', () => {
  const capsule = buildPlanCapsule(workPlanRequest(), identity())
  assert.equal(capsule.schemaVersion, 'TSF_PLAN_CAPSULE_V1')
  assert.equal(capsule.missionId, 'chat-mission-1')
  assert.equal(capsule.projectId, 'tsf-ui-capability-check')
  assert.deepEqual(capsule.repository, identity().repository)
  assert.equal(capsule.expectedResultFormat, 'TSF_RESULT_CAPSULE_V1')
})

test('the mandatory prohibited-action floor is always present, even if the model returned none', () => {
  const capsule = buildPlanCapsule(workPlanRequest({ prohibitedActions: [] }), identity())
  for (const action of MANDATORY_PROHIBITED_ACTIONS) {
    assert.ok(
      capsule.prohibitedActions.includes(action),
      `missing mandatory prohibition: ${action}`
    )
  }
})

test('a model-supplied extra prohibited action is additive, not a replacement for the mandatory floor', () => {
  const capsule = buildPlanCapsule(
    workPlanRequest({ prohibitedActions: ['editing files outside docs/'] }),
    identity()
  )
  assert.ok(capsule.prohibitedActions.includes('editing files outside docs/'))
  for (const action of MANDATORY_PROHIBITED_ACTIONS) {
    assert.ok(capsule.prohibitedActions.includes(action))
  }
})

test('a model that tries to smuggle a duplicate of a mandatory prohibition does not double it up', () => {
  const capsule = buildPlanCapsule(
    workPlanRequest({ prohibitedActions: ['push/merge'] }),
    identity()
  )
  assert.equal(capsule.prohibitedActions.filter((a) => a === 'push/merge').length, 1)
})

test('a model omitting acceptanceCriteria or allowedScope fails validation rather than silently proceeding', () => {
  assert.throws(() => buildPlanCapsule(workPlanRequest({ acceptanceCriteria: [] }), identity()))
  assert.throws(() => buildPlanCapsule(workPlanRequest({ allowedScope: [] }), identity()))
})

test('planCapsuleToCandidateWorkItem requires an explicit worktree or workerTerminal -- no silent default', () => {
  const capsule = buildPlanCapsule(workPlanRequest(), identity())
  assert.throws(
    () => planCapsuleToCandidateWorkItem(capsule, {}),
    (error) => error.code === 'TSF_MISSING_PLACEMENT'
  )
})

test('planCapsuleToCandidateWorkItem maps a capsule into a real Keep Going candidateWorkItem shape', () => {
  const capsule = buildPlanCapsule(workPlanRequest(), identity())
  const item = planCapsuleToCandidateWorkItem(capsule, { worktree: 'C:/repo/wt1', agent: 'codex' })
  assert.equal(item.id, 'chat-mission-1')
  assert.deepEqual(item.scope, ['docs/x.md'])
  assert.equal(item.worktree, 'C:/repo/wt1')
  assert.equal(item.agent, 'codex')
  assert.match(item.spec, /Add a one-line doc note\./)
  assert.match(item.spec, /docs\/x\.md contains the note/)
  assert.match(item.spec, /push\/merge/)
})

test('planCapsuleToCandidateWorkItem accepts a workerTerminal instead of a worktree', () => {
  const capsule = buildPlanCapsule(workPlanRequest(), identity())
  const item = planCapsuleToCandidateWorkItem(capsule, { workerTerminal: 'term-123' })
  assert.equal(item.workerTerminal, 'term-123')
  assert.equal(item.worktree, undefined)
})

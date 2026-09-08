// Multi-Project Command + Real Fleet Orchestration Overnight V1, Part B.
// Pure domain-layer coverage of the durable execution-hold record itself.
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createProjectExecutionHold,
  releaseProjectExecutionHold,
  isProjectExecutionHoldActive,
  HOLD_REASONS
} from '../domain/project-execution-hold.mjs'

const clock = () => new Date('2026-09-07T10:00:00.000Z')
const later = () => new Date('2026-09-07T11:00:00.000Z')

test('createProjectExecutionHold: real, active record with a real audit trail', () => {
  const hold = createProjectExecutionHold(
    { projectId: 'niners-war-room', reason: 'EXTERNAL_WORK_ACTIVE', setBy: 'OPERATOR_CHAT', note: 'another AI is actively working this repo' },
    clock
  )
  assert.equal(hold.schemaVersion, 'TSF_PROJECT_EXECUTION_HOLD_V1')
  assert.equal(hold.projectId, 'niners-war-room')
  assert.equal(hold.status, 'ACTIVE')
  assert.equal(hold.reason, 'EXTERNAL_WORK_ACTIVE')
  assert.equal(hold.setBy, 'OPERATOR_CHAT')
  assert.equal(hold.setAt, clock().toISOString())
  assert.equal(hold.releasedAt, null)
  assert.equal(hold.history.length, 1)
  assert.equal(hold.history[0].action, 'SET')
  assert.equal(isProjectExecutionHoldActive(hold), true)
})

test('createProjectExecutionHold: requires a real projectId, a known reason, and a real setBy', () => {
  assert.throws(() => createProjectExecutionHold({ reason: 'EXTERNAL_WORK_ACTIVE', setBy: 'x' }, clock))
  assert.throws(() => createProjectExecutionHold({ projectId: 'p', reason: 'NOT_A_REAL_REASON', setBy: 'x' }, clock))
  assert.throws(() => createProjectExecutionHold({ projectId: 'p', reason: 'EXTERNAL_WORK_ACTIVE' }, clock))
})

test('HOLD_REASONS is a real, closed, non-empty set', () => {
  assert.ok(HOLD_REASONS.includes('EXTERNAL_WORK_ACTIVE'))
  assert.ok(HOLD_REASONS.length > 0)
})

test('releaseProjectExecutionHold: flips status, records who/why/when, keeps the SET history', () => {
  const hold = createProjectExecutionHold({ projectId: 'p', reason: 'EXTERNAL_WORK_ACTIVE', setBy: 'OPERATOR_CHAT' }, clock)
  const released = releaseProjectExecutionHold(hold, { releasedBy: 'OPERATOR_CHAT', reason: 'external work finished' }, later)
  assert.equal(released.status, 'RELEASED')
  assert.equal(released.releasedBy, 'OPERATOR_CHAT')
  assert.equal(released.releasedAt, later().toISOString())
  assert.equal(released.releaseReason, 'external work finished')
  assert.equal(released.history.length, 2)
  assert.equal(released.history[0].action, 'SET')
  assert.equal(released.history[1].action, 'RELEASE')
  assert.equal(isProjectExecutionHoldActive(released), false)
})

test('releaseProjectExecutionHold: refuses to release what is not an active hold', () => {
  assert.throws(() => releaseProjectExecutionHold(null, { releasedBy: 'x' }, clock), (error) => error.code === 'TSF_NO_ACTIVE_PROJECT_EXECUTION_HOLD')
  const hold = createProjectExecutionHold({ projectId: 'p', reason: 'EXTERNAL_WORK_ACTIVE', setBy: 'x' }, clock)
  const released = releaseProjectExecutionHold(hold, { releasedBy: 'x' }, clock)
  assert.throws(() => releaseProjectExecutionHold(released, { releasedBy: 'x' }, clock), (error) => error.code === 'TSF_NO_ACTIVE_PROJECT_EXECUTION_HOLD')
})

test('releaseProjectExecutionHold: requires a real releasedBy', () => {
  const hold = createProjectExecutionHold({ projectId: 'p', reason: 'EXTERNAL_WORK_ACTIVE', setBy: 'x' }, clock)
  assert.throws(() => releaseProjectExecutionHold(hold, {}, clock))
})

test('isProjectExecutionHoldActive: honest for null/undefined and non-ACTIVE statuses', () => {
  assert.equal(isProjectExecutionHoldActive(null), false)
  assert.equal(isProjectExecutionHoldActive(undefined), false)
  assert.equal(isProjectExecutionHoldActive({ status: 'RELEASED' }), false)
})

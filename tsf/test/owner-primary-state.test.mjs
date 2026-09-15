// TSF UI FINDINGS #2-#16 RECONCILE & UPGRADE, Finding #5/#6/#7.
import assert from 'node:assert/strict'
import test from 'node:test'
import { ownerPrimaryState, OWNER_PRIMARY_STATES } from '../domain/owner-primary-state.mjs'
import { createProjectExecutionHold } from '../domain/project-execution-hold.mjs'

const clock = () => new Date('2026-09-16T00:00:00.000Z')

test('OWNER_PRIMARY_STATES is exactly the settled 4-word model', () => {
  assert.deepEqual(OWNER_PRIMARY_STATES, ['WORKING', 'WAITING', 'NEEDS_YOU', 'DONE'])
})

test('WORKING passes through as WORKING with no secondary label', () => {
  assert.deepEqual(ownerPrimaryState('WORKING', { reason: 'a wave is in flight' }), {
    primary: 'WORKING',
    reasonLabel: null,
    reason: 'a wave is in flight'
  })
})

test('PAUSED maps to WAITING / Paused -- the exact Finding #5/#7 fix', () => {
  const result = ownerPrimaryState('PAUSED', { reason: 'run state is PAUSED' })
  assert.equal(result.primary, 'WAITING')
  assert.equal(result.reasonLabel, 'Paused')
})

test('an ACTIVE execution hold always wins WAITING/Execution hold, regardless of underlying owner state (except DONE -- see its own dedicated test)', () => {
  const hold = createProjectExecutionHold(
    {
      projectId: 'p1',
      reason: 'EXTERNAL_WORK_ACTIVE',
      setBy: 'test',
      note: 'another AI is on this'
    },
    clock
  )
  for (const ownerState of ['WORKING', 'PLANNING', 'NEEDS_YOU', 'READY']) {
    const result = ownerPrimaryState(ownerState, { hold })
    assert.equal(result.primary, 'WAITING', `${ownerState} + active hold must be WAITING`)
    assert.equal(result.reasonLabel, 'Execution hold')
    assert.equal(result.reason, 'another AI is on this')
  }
})

test('a RELEASED hold does not override the underlying owner state', () => {
  const hold = createProjectExecutionHold(
    { projectId: 'p1', reason: 'EXTERNAL_WORK_ACTIVE', setBy: 'test' },
    clock
  )
  const released = { ...hold, status: 'RELEASED' }
  const result = ownerPrimaryState('WORKING', { hold: released, reason: 'a wave is in flight' })
  assert.equal(result.primary, 'WORKING')
})

test('a null hold does not override the underlying owner state', () => {
  const result = ownerPrimaryState('WORKING', { hold: null, reason: 'a wave is in flight' })
  assert.equal(result.primary, 'WORKING')
})

test('a hold never overrides DONE -- a finished/adopted item stays DONE even if a hold outlives the run', () => {
  const hold = createProjectExecutionHold(
    { projectId: 'p1', reason: 'EXTERNAL_WORK_ACTIVE', setBy: 'test' },
    clock
  )
  const result = ownerPrimaryState('DONE', { hold, reason: 'adopted' })
  assert.equal(result.primary, 'DONE')
})

test('READY maps to NEEDS_YOU / Ready for adoption', () => {
  assert.deepEqual(ownerPrimaryState('READY'), {
    primary: 'NEEDS_YOU',
    reasonLabel: 'Ready for adoption',
    reason: null
  })
})

test('FAILED maps to NEEDS_YOU / Stalled -- FAILED means an operator decision is needed', () => {
  assert.deepEqual(ownerPrimaryState('FAILED'), {
    primary: 'NEEDS_YOU',
    reasonLabel: 'Stalled',
    reason: null
  })
})

test('VERIFYING and PLANNING never claim WORKING -- neither describes live, currently-executing work', () => {
  assert.equal(ownerPrimaryState('VERIFYING').primary, 'WAITING')
  assert.equal(ownerPrimaryState('PLANNING').primary, 'WAITING')
})

test('NEEDS_YOU and DONE pass through unchanged', () => {
  assert.equal(ownerPrimaryState('NEEDS_YOU').primary, 'NEEDS_YOU')
  assert.equal(ownerPrimaryState('DONE').primary, 'DONE')
})

test('an unmapped owner state throws rather than silently guessing', () => {
  assert.throws(() => ownerPrimaryState('NOT_A_REAL_STATE'), /no primary-state mapping/)
})

test('every real OWNER_WORK_STATES value has a mapping (no silent gaps)', async () => {
  const { OWNER_WORK_STATES } = await import('../domain/owner-work-model.mjs')
  for (const state of OWNER_WORK_STATES) {
    assert.doesNotThrow(() => ownerPrimaryState(state), `${state} must have a real mapping`)
  }
})

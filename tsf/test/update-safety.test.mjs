import assert from 'node:assert/strict'
import test from 'node:test'
import { classifyUpdateSafety } from '../domain/update-safety.mjs'

function status(projectId, hasRun, state) {
  return {
    projectId,
    displayName: projectId,
    hasRun,
    feed: hasRun ? { state, reason: state } : null,
    runId: hasRun ? 'run-1' : null
  }
}

test('no real work anywhere is SAFE_NOW', () => {
  const result = classifyUpdateSafety([status('a', false, null), status('b', true, 'PLANNING')])
  assert.equal(result.state, 'SAFE_NOW')
  assert.deepEqual(result.blockingProjectIds, [])
})

test('a project with a worker genuinely WORKING blocks an update -- WAIT_FOR_ACTIVE_WORK', () => {
  const result = classifyUpdateSafety([status('a', true, 'WORKING')])
  assert.equal(result.state, 'WAIT_FOR_ACTIVE_WORK')
  assert.deepEqual(result.blockingProjectIds, ['a'])
})

test('VERIFYING, REVISION, and WAITING are also real active work, not just WORKING', () => {
  assert.equal(classifyUpdateSafety([status('a', true, 'VERIFYING')]).state, 'WAIT_FOR_ACTIVE_WORK')
  // Adversarial-review finding: REVISION was missing and would have
  // wrongly classified this mid-cycle state as safe to restart through.
  assert.equal(classifyUpdateSafety([status('a', true, 'REVISION')]).state, 'WAIT_FOR_ACTIVE_WORK')
  assert.equal(classifyUpdateSafety([status('a', true, 'WAITING')]).state, 'WAIT_FOR_ACTIVE_WORK')
})

test('an open Needs You question escalates to TIM_REQUIRED, outranking a merely-active project', () => {
  const result = classifyUpdateSafety([
    status('a', true, 'NEEDS_YOU'),
    status('b', true, 'WORKING')
  ])
  assert.equal(result.state, 'TIM_REQUIRED')
  assert.deepEqual(result.blockingProjectIds, ['a'])
})

test('undeterminable fleet state escalates to TIM_REQUIRED rather than guessing safe', () => {
  const result = classifyUpdateSafety(null)
  assert.equal(result.state, 'TIM_REQUIRED')
})

test('PLANNING (a run that exists but has not dispatched a wave) does not block an update', () => {
  const result = classifyUpdateSafety([status('a', true, 'PLANNING')])
  assert.equal(result.state, 'SAFE_NOW')
})

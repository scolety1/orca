import assert from 'node:assert/strict'
import test from 'node:test'
import { withBuildActionState, UI_BUILD_ACTION_STATES } from '../domain/ui-build-state.mjs'

const STALE = { state: 'UI_BUNDLE_STALE', reason: 'stale bundle', runningCommit: 'a', diskCommit: 'a' }
const UP_TO_DATE = { state: 'UP_TO_DATE', reason: 'matches', runningCommit: 'a', diskCommit: 'a' }
const LIVE_STALE = { state: 'LIVE_RUNTIME_STALE', reason: 'restart needed', runningCommit: 'a', diskCommit: 'b' }

test('UI_BUILD_ACTION_STATES lists exactly the four build-action states', () => {
  assert.deepEqual(UI_BUILD_ACTION_STATES, [
    'UI_BUILDING',
    'BUILD_FAILED',
    'UI_INSTALLING',
    'UI_DEPENDENCIES_MISSING'
  ])
})

test('withBuildActionState passes identity through unchanged when there is no build action', () => {
  assert.deepEqual(withBuildActionState(STALE, null), STALE)
  assert.deepEqual(withBuildActionState(STALE, { status: 'IDLE', reason: null }), STALE)
})

test('withBuildActionState overlays UI_BUILDING only on top of a genuinely stale identity', () => {
  const result = withBuildActionState(STALE, { status: 'BUILDING', reason: null })
  assert.equal(result.state, 'UI_BUILDING')
  assert.match(result.reason, /rebuild is currently in progress/)
  // Real commit fields are preserved, not dropped by the overlay.
  assert.equal(result.runningCommit, 'a')
  assert.equal(result.diskCommit, 'a')
})

test('withBuildActionState overlays BUILD_FAILED with the real captured reason', () => {
  const result = withBuildActionState(STALE, {
    status: 'FAILED',
    reason: 'npm run build exited with code 1 -- some real stderr'
  })
  assert.equal(result.state, 'BUILD_FAILED')
  assert.equal(result.reason, 'npm run build exited with code 1 -- some real stderr')
})

test('withBuildActionState never overrides UP_TO_DATE or LIVE_RUNTIME_STALE, even with a stale in-memory build action', () => {
  const buildAction = { status: 'FAILED', reason: 'a previous failure' }
  assert.deepEqual(withBuildActionState(UP_TO_DATE, buildAction), UP_TO_DATE)
  assert.deepEqual(withBuildActionState(LIVE_STALE, buildAction), LIVE_STALE)
})

// Pre-UI Productization V1, Priority 4 gap 2.
test('withBuildActionState overlays UI_INSTALLING while a real dependency install is running', () => {
  const result = withBuildActionState(STALE, { status: 'INSTALLING', reason: null })
  assert.equal(result.state, 'UI_INSTALLING')
  assert.match(result.reason, /installing tsf\/ui dependencies/)
})

test('withBuildActionState overlays UI_DEPENDENCIES_MISSING with the real captured reason, kept distinct from BUILD_FAILED', () => {
  const result = withBuildActionState(STALE, {
    status: 'DEPENDENCIES_MISSING',
    reason: 'tsf/ui/node_modules is missing -- click "Set up TSF" to install it automatically'
  })
  assert.equal(result.state, 'UI_DEPENDENCIES_MISSING')
  assert.equal(
    result.reason,
    'tsf/ui/node_modules is missing -- click "Set up TSF" to install it automatically'
  )
  // A genuine BUILD_FAILED must never be conflated with this state -- a
  // real build failure needs a code fix, not another install attempt.
  assert.notEqual(result.state, 'BUILD_FAILED')
})

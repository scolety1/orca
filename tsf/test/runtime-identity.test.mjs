import assert from 'node:assert/strict'
import test from 'node:test'
import { classifyLiveRuntimeState } from '../domain/runtime-identity.mjs'

const A = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const B = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'

test('everything matching is UP_TO_DATE', () => {
  const result = classifyLiveRuntimeState({ runningCommit: A, diskCommit: A, uiBundleCommit: A })
  assert.equal(result.state, 'UP_TO_DATE')
})

test('the running backend predating disk state is LIVE_RUNTIME_STALE -- a restart is needed', () => {
  const result = classifyLiveRuntimeState({ runningCommit: A, diskCommit: B, uiBundleCommit: A })
  assert.equal(result.state, 'LIVE_RUNTIME_STALE')
})

test('the backend matching disk but the UI bundle not is UI_BUNDLE_STALE, distinct from a full restart', () => {
  const result = classifyLiveRuntimeState({ runningCommit: A, diskCommit: A, uiBundleCommit: B })
  assert.equal(result.state, 'UI_BUNDLE_STALE')
})

test('a missing UI bundle identity (never built) is honestly UI_BUNDLE_STALE, not fabricated as up to date', () => {
  const result = classifyLiveRuntimeState({ runningCommit: A, diskCommit: A, uiBundleCommit: null })
  assert.equal(result.state, 'UI_BUNDLE_STALE')
})

test('missing commit identity is honestly UNKNOWN, never guessed as UP_TO_DATE', () => {
  assert.equal(
    classifyLiveRuntimeState({ runningCommit: null, diskCommit: A, uiBundleCommit: A }).state,
    'UNKNOWN'
  )
  assert.equal(
    classifyLiveRuntimeState({ runningCommit: A, diskCommit: null, uiBundleCommit: A }).state,
    'UNKNOWN'
  )
})

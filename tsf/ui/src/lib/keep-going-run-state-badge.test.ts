import assert from 'node:assert/strict'
import test from 'node:test'
import { keepGoingRunStateBadgeVariant } from './keep-going-run-state-badge.ts'

test('every real KeepGoingRunState maps to a real badge variant', () => {
  assert.equal(keepGoingRunStateBadgeVariant('ACTIVE'), 'primary')
  assert.equal(keepGoingRunStateBadgeVariant('STALLED'), 'degraded')
  assert.equal(keepGoingRunStateBadgeVariant('COMPLETE'), 'healthy')
  assert.equal(keepGoingRunStateBadgeVariant('BLOCKED'), 'blocked')
})

test('an unrecognized state falls back to neutral, never throws', () => {
  assert.equal(keepGoingRunStateBadgeVariant('SOMETHING_NEW'), 'neutral')
})

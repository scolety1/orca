import assert from 'node:assert/strict'
import test from 'node:test'
import { shouldShowGapDecisionBadge } from './keep-going-gap-display.ts'

// Real reproduction (BUG-11): a STALLED run's gap.decision is still
// literally "CONTINUE" -- rendering it as a Badge here is what read as a
// non-interactive, misleading control.
test('STALLED -> the CONTINUE-looking decision badge is not shown', () => {
  assert.equal(shouldShowGapDecisionBadge('STALLED'), false)
})

test('PAUSED -> not shown (same misleading-CONTINUE risk while paused)', () => {
  assert.equal(shouldShowGapDecisionBadge('PAUSED'), false)
})

test('NEEDS_YOU -> not shown', () => {
  assert.equal(shouldShowGapDecisionBadge('NEEDS_YOU'), false)
})

test('BLOCKED -> not shown', () => {
  assert.equal(shouldShowGapDecisionBadge('BLOCKED'), false)
})

test('ACTIVE -> shown (the only state where the decision reflects real in-progress judgment)', () => {
  assert.equal(shouldShowGapDecisionBadge('ACTIVE'), true)
})

test('COMPLETE -> not shown (STOP_COMPLETE is already conveyed by the state badge)', () => {
  assert.equal(shouldShowGapDecisionBadge('COMPLETE'), false)
})

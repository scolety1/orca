// Real, mechanical "detector" for the Phase 9 golden proof (Wave D): the
// exact reproduction/regression command a real finding's reproduction.command
// and candidateFixScope.filesHint point at.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { clampToUnitInterval } from '../fixtures/self-improvement-golden-proof-target.mjs'

test('clampToUnitInterval clamps values above 1 down to 1', () => {
  assert.equal(clampToUnitInterval(5), 1)
})

test('clampToUnitInterval clamps values below 0 up to 0', () => {
  assert.equal(clampToUnitInterval(-3), 0)
})

test('clampToUnitInterval passes values already in range through unchanged', () => {
  assert.equal(clampToUnitInterval(0.42), 0.42)
})

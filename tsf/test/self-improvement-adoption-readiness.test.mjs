import assert from 'node:assert/strict'
import test from 'node:test'
import { assessRepairAdoptionReadiness } from '../domain/self-improvement-adoption-readiness.mjs'

function readyInput(overrides = {}) {
  return { findingStatus: 'READY_FOR_ADOPTION', verifierVerdict: 'VERIFIED_PASS', candidateIsFastForward: true, candidateWorktreeClean: true, canonicalClean: true, gateOpen: true, ...overrides }
}

test('every condition true -> ready with zero blockers', () => {
  assert.deepEqual(assessRepairAdoptionReadiness(readyInput()), { ready: true, blockers: [] })
})

test('each individual failing condition contributes its own named blocker', () => {
  assert.match(assessRepairAdoptionReadiness(readyInput({ findingStatus: 'NEEDS_OWNER' })).blockers[0], /READY_FOR_ADOPTION/)
  assert.match(assessRepairAdoptionReadiness(readyInput({ verifierVerdict: 'VERIFIED_FAIL' })).blockers[0], /VERIFIED_PASS/)
  assert.match(assessRepairAdoptionReadiness(readyInput({ candidateIsFastForward: false })).blockers[0], /fast-forward/)
  assert.match(assessRepairAdoptionReadiness(readyInput({ candidateWorktreeClean: false })).blockers[0], /candidate worktree is not clean/)
  assert.match(assessRepairAdoptionReadiness(readyInput({ canonicalClean: false })).blockers[0], /canonical tsf\/main is not clean/)
  assert.match(assessRepairAdoptionReadiness(readyInput({ gateOpen: false })).blockers[0], /gate is closed/)
})

test('multiple simultaneous failures all appear, none silently swallowed', () => {
  const result = assessRepairAdoptionReadiness(readyInput({ gateOpen: false, canonicalClean: false }))
  assert.equal(result.ready, false)
  assert.equal(result.blockers.length, 2)
})
